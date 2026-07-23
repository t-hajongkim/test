import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import { ZodError } from "zod";

import type { ClearNotionToken } from "../application/clear-notion-token.js";
import {
  ConnectionSessionNotFoundError,
  type ConnectionSessionStore,
} from "../application/connection-session-store.js";
import type { EndConnectionSession } from "../application/end-connection-session.js";
import type { GetConnectionSessionSummary } from "../application/get-connection-session-summary.js";
import type { SaveConnectionSetup } from "../application/save-connection-setup.js";
import type { StartConnectionSession } from "../application/start-connection-session.js";
import {
  LOCAL_APP_CSS,
  LOCAL_APP_HTML,
  LOCAL_APP_SCRIPT,
} from "./local-app-assets.js";

const SESSION_COOKIE_NAME = "notion2loop_session";
export const MAX_LOCAL_APP_JSON_BYTES = 16 * 1024;

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export interface LocalConnectionAppLogger {
  error(message: string): void;
}

export interface LocalConnectionAppServices {
  readonly store: ConnectionSessionStore;
  readonly startSession: StartConnectionSession;
  readonly saveSetup: SaveConnectionSetup;
  readonly getSummary: GetConnectionSessionSummary;
  readonly clearNotionToken: ClearNotionToken;
  readonly endSession: EndConnectionSession;
}

export interface LocalConnectionHttpServer {
  readonly server: Server;
  readonly origin: string;
}

export async function startLocalConnectionHttpServer(
  services: LocalConnectionAppServices,
  port: number,
  logger: LocalConnectionAppLogger,
): Promise<LocalConnectionHttpServer> {
  let origin = "";
  const server = createServer((request, response) => {
    void handleRequest(request, response, services, origin).catch(
      (error: unknown) => {
        handleRequestFailure(error, response, logger);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    const handleStartupError = (error: Error): void => reject(error);
    server.once("error", handleStartupError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", handleStartupError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The local connection app did not expose a TCP port.");
  }
  origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  services: LocalConnectionAppServices,
  origin: string,
): Promise<void> {
  setSecurityHeaders(response);
  assertHost(request, origin);

  const requestUrl = new URL(request.url ?? "/", origin);
  if (requestUrl.search || requestUrl.hash) {
    throw new HttpRequestError(
      400,
      "URL_PARAMETERS_NOT_ALLOWED",
      "URL parameters are not accepted.",
    );
  }
  const method = request.method ?? "";
  if (!["GET", "HEAD"].includes(method)) {
    assertOrigin(request, origin);
  }

  if (requestUrl.pathname === "/") {
    assertMethod(method, ["GET"]);
    sendText(response, 200, LOCAL_APP_HTML, "text/html; charset=utf-8");
    return;
  }
  if (requestUrl.pathname === "/assets/local-app.css") {
    assertMethod(method, ["GET"]);
    sendText(response, 200, LOCAL_APP_CSS, "text/css; charset=utf-8");
    return;
  }
  if (requestUrl.pathname === "/assets/local-app.js") {
    assertMethod(method, ["GET"]);
    sendText(
      response,
      200,
      LOCAL_APP_SCRIPT,
      "text/javascript; charset=utf-8",
    );
    return;
  }

  if (requestUrl.pathname === "/api/v1/connection-session") {
    await handleSessionRoute(request, response, services, method);
    return;
  }
  if (
    requestUrl.pathname ===
    "/api/v1/connection-session/configuration"
  ) {
    assertMethod(method, ["PUT"]);
    const sessionId = requireSessionId(request);
    assertJsonContentType(request);
    const configuration = await readJsonBody(request);
    const summary = await services.saveSetup.execute({
      sessionId,
      configuration,
    });
    sendJson(response, 200, summary);
    return;
  }
  if (
    requestUrl.pathname === "/api/v1/connection-session/notion-token"
  ) {
    assertMethod(method, ["DELETE"]);
    await assertEmptyBody(request);
    const summary = await services.clearNotionToken.execute({
      sessionId: requireSessionId(request),
    });
    sendJson(response, 200, summary);
    return;
  }

  throw new HttpRequestError(404, "NOT_FOUND", "Route not found.");
}

async function handleSessionRoute(
  request: IncomingMessage,
  response: ServerResponse,
  services: LocalConnectionAppServices,
  method: string,
): Promise<void> {
  if (method === "POST") {
    await assertEmptyBody(request);
    const result = await services.startSession.execute();
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=${result.sessionId}; HttpOnly; SameSite=Strict; Path=/`,
    );
    sendJson(response, 201, result.summary);
    return;
  }
  if (method === "GET") {
    const summary = await services.getSummary.execute({
      sessionId: requireSessionId(request),
    });
    sendJson(response, 200, summary);
    return;
  }
  if (method === "DELETE") {
    await assertEmptyBody(request);
    await services.endSession.execute({
      sessionId: requireSessionId(request),
    });
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    );
    response.writeHead(204);
    response.end();
    return;
  }
  assertMethod(method, ["GET", "POST", "DELETE"]);
}

function assertHost(request: IncomingMessage, origin: string): void {
  const expectedHost = new URL(origin).host;
  if (request.headers.host !== expectedHost) {
    throw new HttpRequestError(
      403,
      "HOST_FORBIDDEN",
      "The request host is not allowed.",
    );
  }
}

function assertOrigin(request: IncomingMessage, origin: string): void {
  if (request.headers.origin !== origin) {
    throw new HttpRequestError(
      403,
      "ORIGIN_FORBIDDEN",
      "The request origin is not allowed.",
    );
  }
}

function assertMethod(method: string, allowed: readonly string[]): void {
  if (!allowed.includes(method)) {
    throw new HttpRequestError(
      405,
      "METHOD_NOT_ALLOWED",
      "Method not allowed.",
      undefined,
      allowed.join(", "),
    );
  }
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new HttpRequestError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
    );
  }
}

async function assertEmptyBody(request: IncomingMessage): Promise<void> {
  const body = await readBody(request, 1);
  if (body.byteLength !== 0) {
    throw new HttpRequestError(
      400,
      "BODY_NOT_ALLOWED",
      "This endpoint does not accept a request body.",
    );
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request, MAX_LOCAL_APP_JSON_BYTES);
  if (body.byteLength === 0) {
    throw new HttpRequestError(
      400,
      "INVALID_JSON",
      "A JSON request body is required.",
    );
  }
  try {
    return JSON.parse(body.toString("utf-8"));
  } catch {
    throw new HttpRequestError(
      400,
      "INVALID_JSON",
      "The request body must contain valid JSON.",
    );
  }
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      request.resume();
      throw new HttpRequestError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Content-Length is invalid.",
      );
    }
    if (parsedLength > maxBytes) {
      request.resume();
      throw payloadTooLarge();
    }
  }

  let byteCount = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteCount += buffer.byteLength;
    if (byteCount > maxBytes) {
      request.resume();
      throw payloadTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, byteCount);
}

function payloadTooLarge(): HttpRequestError {
  return new HttpRequestError(
    413,
    "PAYLOAD_TOO_LARGE",
    `The request body must not exceed ${MAX_LOCAL_APP_JSON_BYTES} bytes.`,
  );
}

function requireSessionId(request: IncomingMessage): string {
  const cookieHeader = request.headers.cookie ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  const sessionId = sessionCookie?.slice(SESSION_COOKIE_NAME.length + 1);
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/u.test(sessionId)) {
    throw new ConnectionSessionNotFoundError();
  }
  return sessionId;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  sendText(
    response,
    status,
    JSON.stringify(value),
    "application/json; charset=utf-8",
  );
}

function sendText(
  response: ServerResponse,
  status: number,
  value: string,
  contentType: string,
): void {
  const content = Buffer.from(value, "utf-8");
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(content.byteLength),
  });
  response.end(content);
}

function handleRequestFailure(
  error: unknown,
  response: ServerResponse,
  logger: LocalConnectionAppLogger,
): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }

  const requestError = mapRequestError(error);
  if (!requestError) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    logger.error(
      `Local connection app request failed [UNEXPECTED_ERROR:${errorName}].`,
    );
    sendJson(response, 500, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "The local connection app encountered an unexpected error.",
      },
    });
    return;
  }

  if (requestError.allow) {
    response.setHeader("Allow", requestError.allow);
  }
  sendJson(response, requestError.status, {
    error: {
      code: requestError.code,
      message: requestError.message,
      ...(requestError.fields ? { fields: requestError.fields } : {}),
    },
  });
}

function mapRequestError(error: unknown): HttpRequestError | undefined {
  if (error instanceof HttpRequestError) {
    return error;
  }
  if (error instanceof ConnectionSessionNotFoundError) {
    return new HttpRequestError(
      404,
      "SESSION_NOT_FOUND",
      "Connection session was not found.",
    );
  }
  if (error instanceof ZodError) {
    return new HttpRequestError(
      422,
      "VALIDATION_FAILED",
      "Check the highlighted connection information.",
      error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return undefined;
}

interface ValidationField {
  readonly path: string;
  readonly message: string;
}

class HttpRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: readonly ValidationField[],
    public readonly allow?: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}
