import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function startDashboardServer(
  directory: string,
  port: number,
): Promise<Server> {
  const requestedRootDirectory = path.resolve(directory);
  const rootStat = await stat(requestedRootDirectory);
  if (!rootStat.isDirectory()) {
    throw new Error(
      `Dashboard directory does not exist: ${requestedRootDirectory}`,
    );
  }
  const rootDirectory = await realpath(requestedRootDirectory);

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          Allow: "GET, HEAD",
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Method not allowed");
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const relativeRequestPath =
        decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
      let filePath = path.resolve(rootDirectory, relativeRequestPath);

      if (!isWithinRoot(rootDirectory, filePath)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      const resolvedFilePath = await realpath(filePath);
      if (!isWithinRoot(rootDirectory, resolvedFilePath)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const resolvedFileStat = await stat(resolvedFilePath);
      if (!resolvedFileStat.isFile()) {
        response.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type":
          MIME_TYPES[path.extname(resolvedFilePath).toLowerCase()] ??
          "application/octet-stream",
        "Content-Length": String(resolvedFileStat.size),
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      await pipeline(createReadStream(resolvedFilePath), response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
          ? 404
          : 500;
      if (code === 500) {
        const message = error instanceof Error ? error.stack : String(error);
        process.stderr.write(`Dashboard server error: ${message}\n`);
      }
      response.writeHead(code, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(code === 404 ? "Not found" : "Server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return server;
}

function isWithinRoot(rootDirectory: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootDirectory, candidatePath);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}
