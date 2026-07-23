import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryConnectionSessionStore } from "../src/features/connection-setup/infrastructure/in-memory-connection-session-store.js";
import {
  startLocalConnectionApp,
  type LocalConnectionApp,
} from "../src/features/connection-setup/presentation/local-app-composition-root.js";

const tenantId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const clientId = "4c56f8e1-21d7-4b45-82a3-dcb5c91c8954";
const runningApps: LocalConnectionApp[] = [];

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()));
});

describe("local connection app", () => {
  it("renders the start-first guided flow and stores only redacted session summaries", async () => {
    const logs: string[] = [];
    const app = await startApp(logs);
    const pageResponse = await fetch(app.origin);
    const page = await pageResponse.text();
    const scriptResponse = await fetch(`${app.origin}/assets/local-app.js`);
    const script = await scriptResponse.text();

    expect(page).toContain('data-action="start-session"');
    expect(page).toContain("시작");
    expect(page).toContain('data-step="source"');
    expect(page).toContain('type="file"');
    expect(page).toContain('type="password"');
    expect(page).toContain("Tenant ID");
    expect(page).toContain("Client ID");
    expect(page).toContain("Microsoft Graph");
    expect(page).toContain("권한 동의");
    expect(page).toContain("분석");
    expect(page).toContain("검토·승인");
    expect(page).toContain("배포");
    expect(script).toContain("/api/v1/connection-session");
    expect(script).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(script).not.toMatch(/FileReader|arrayBuffer|FormData/);

    const startResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "POST",
        headers: { Origin: app.origin },
      },
    );
    const cookie = readSessionCookie(startResponse);
    expect(startResponse.status).toBe(201);
    expect(startResponse.headers.get("set-cookie")).toMatch(
      /HttpOnly; SameSite=Strict; Path=\//,
    );

    const invalidResponse = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: jsonHeaders(app.origin, cookie),
        body: JSON.stringify({
          source: {
            kind: "notion_api",
            notionToken: "short",
            root: { kind: "page", id: "invalid" },
          },
          microsoft: { tenantId: "invalid", clientId },
          targets: [],
        }),
      },
    );
    expect(invalidResponse.status).toBe(422);
    expect(await invalidResponse.json()).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fields: expect.any(Array),
      },
    });

    const marker = "ntn_http_secret_marker_123";
    const saveResponse = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: jsonHeaders(app.origin, cookie),
        body: JSON.stringify({
          source: {
            kind: "notion_api",
            notionToken: marker,
            root: {
              kind: "page",
              id: "1234567890abcdef1234567890abcdef",
            },
          },
          microsoft: { tenantId, clientId },
          targets: ["lists", "sharepoint"],
        }),
      },
    );
    const saveBody = await saveResponse.text();
    expect(saveResponse.status).toBe(200);
    expect(saveBody).not.toContain(marker);
    expect(JSON.parse(saveBody)).toMatchObject({
      status: "ready_for_analysis",
      configured: true,
      notionTokenPresent: true,
    });

    const summaryResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      { headers: { Cookie: cookie } },
    );
    expect(await summaryResponse.text()).not.toContain(marker);

    const clearResponse = await fetch(
      `${app.origin}/api/v1/connection-session/notion-token`,
      {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: app.origin },
      },
    );
    expect(await clearResponse.json()).toMatchObject({
      status: "collecting_configuration",
      configured: false,
      notionTokenPresent: false,
    });

    const endResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: app.origin },
      },
    );
    expect(endResponse.status).toBe(204);
    expect(endResponse.headers.get("set-cookie")).toContain("Max-Age=0");

    const deletedResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      { headers: { Cookie: cookie } },
    );
    expect(deletedResponse.status).toBe(404);
    expect(logs.join("\n")).not.toContain(marker);
  });

  it("accepts ZIP name and size metadata without receiving ZIP bytes", async () => {
    const app = await startApp();
    const startResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "POST",
        headers: { Origin: app.origin },
      },
    );
    const cookie = readSessionCookie(startResponse);

    const response = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: jsonHeaders(app.origin, cookie),
        body: JSON.stringify({
          source: {
            kind: "zip",
            file: { name: "workspace.zip", sizeBytes: 4_096 },
          },
          microsoft: { tenantId, clientId },
          targets: ["planner"],
        }),
      },
    );

    expect(await response.json()).toMatchObject({
      status: "ready_for_analysis",
      source: {
        kind: "zip",
        file: { name: "workspace.zip", sizeBytes: 4_096 },
      },
      notionTokenPresent: false,
    });
  });

  it("enforces loopback, same-origin, request-size, and response-header boundaries", async () => {
    const store = new InMemoryConnectionSessionStore();
    const app = await startLocalConnectionApp({ port: 0, store });
    runningApps.push(app);
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("The local app did not expose a TCP address.");
    }
    expect(address.address).toBe("127.0.0.1");

    const pageResponse = await fetch(app.origin);
    expectSecurityHeaders(pageResponse);
    expect(pageResponse.headers.get("access-control-allow-origin")).toBeNull();

    const wrongOrigin = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      },
    );
    expect(wrongOrigin.status).toBe(403);
    expectSecurityHeaders(wrongOrigin);

    const wrongHostStatus = await requestStatus(
      `${app.origin}/api/v1/connection-session`,
      {
        Host: `localhost:${address.port}`,
        Origin: app.origin,
      },
    );
    expect(wrongHostStatus).toBe(403);

    const startResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "POST",
        headers: { Origin: app.origin },
      },
    );
    const cookie = readSessionCookie(startResponse);

    const wrongContentType = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: app.origin,
          "Content-Type": "text/plain",
        },
        body: "{}",
      },
    );
    expect(wrongContentType.status).toBe(415);

    const oversizedResponse = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: jsonHeaders(app.origin, cookie),
        body: JSON.stringify({ padding: "x".repeat(17 * 1_024) }),
      },
    );
    expect(oversizedResponse.status).toBe(413);
    expectSecurityHeaders(oversizedResponse);

    const chunkedOversizedStatus = await requestStatus(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        Cookie: cookie,
        Origin: app.origin,
        "Content-Type": "application/json",
      },
      "PUT",
      ["x".repeat(9 * 1_024), "x".repeat(9 * 1_024)],
    );
    expect(chunkedOversizedStatus).toBe(413);

    const methodResponse = await fetch(app.origin, {
      method: "POST",
      headers: { Origin: app.origin },
    });
    expect(methodResponse.status).toBe(405);

    expect(store.size).toBe(1);
    await app.close();
    runningApps.splice(runningApps.indexOf(app), 1);
    expect(store.size).toBe(0);
  });
});

async function startApp(logs: string[] = []): Promise<LocalConnectionApp> {
  const app = await startLocalConnectionApp({
    port: 0,
    logger: {
      error(message) {
        logs.push(message);
      },
    },
  });
  runningApps.push(app);
  return app;
}

function readSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("The local app did not set a session cookie.");
  }
  return setCookie.split(";", 1)[0] ?? "";
}

function jsonHeaders(origin: string, cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    Origin: origin,
    "Content-Type": "application/json",
  };
}

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain(
    "default-src 'none'",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  expect(response.headers.get("cross-origin-resource-policy")).toBe(
    "same-origin",
  );
}

async function requestStatus(
  url: string,
  headers: Readonly<Record<string, string>>,
  method = "POST",
  chunks: readonly string[] = [],
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(url, { method, headers }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    for (const chunk of chunks) {
      request.write(chunk);
    }
    request.end();
  });
}
