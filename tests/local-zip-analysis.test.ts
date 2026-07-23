import { request as httpRequest } from "node:http";
import {
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Zip, ZipDeflate, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import type {
  LocalZipArchiveStager,
  StagedZipArchive,
} from "../src/features/connection-setup/application/local-zip-archive-stager.js";
import { LocalZipStagingCleanupError } from "../src/features/connection-setup/application/local-zip-archive-stager.js";
import { InMemoryConnectionSessionStore } from "../src/features/connection-setup/infrastructure/in-memory-connection-session-store.js";
import { FileSystemLocalZipArchiveStager } from "../src/features/connection-setup/infrastructure/file-system-local-zip-archive-stager.js";
import {
  startLocalConnectionApp,
  type LocalConnectionApp,
} from "../src/features/connection-setup/presentation/local-app-composition-root.js";
import type { WorkspaceSource } from "../src/features/workspace-ingestion/application/workspace-source.js";
import { DirectoryWorkspaceSource } from "../src/features/workspace-ingestion/infrastructure/directory-workspace-source.js";
import type { SourceReadLimits } from "../src/features/workspace-ingestion/infrastructure/source-limits.js";

const tenantId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const clientId = "4c56f8e1-21d7-4b45-82a3-dcb5c91c8954";
const textEncoder = new TextEncoder();
const runningApps: LocalConnectionApp[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(runningApps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("local ZIP analysis", () => {
  it("streams a real ZIP through ingestion and analysis while returning only a safe summary", async () => {
    const tempDirectory = await createTemporaryDirectory();
    const store = new InMemoryConnectionSessionStore();
    const logs: string[] = [];
    const app = await startApp({
      store,
      stager: new FileSystemLocalZipArchiveStager({ tempDirectory }),
      logs,
    });
    const archive = await createFixtureArchive({
      "Private Marker 0123456789abcdef0123456789abcdef.md":
        textEncoder.encode(
          "# Private Marker\nraw-private-content-marker-9842",
        ),
    });
    const session = await startConfiguredSession(app, archive.byteLength);

    const response = await uploadZip(app, session.cookie, archive);
    const responseText = await response.text();
    const summary = JSON.parse(responseText) as {
      status: string;
      workflow: { analysis: string };
      analysis: {
        graph: { nodeCount: number; edgeCount: number; warningCount: number };
        plan: {
          fidelityScore: number;
          totalItems: number;
          native: number;
          transformed: number;
          manual: number;
          blocked: number;
          issueCount: number;
          agentTaskCount: number;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(summary).toMatchObject({
      status: "analysis_ready",
      workflow: {
        analysis: "ready",
        reviewApproval: "not_started",
        deployment: "disabled",
      },
      analysis: {
        graph: {
          nodeCount: expect.any(Number),
          edgeCount: expect.any(Number),
          warningCount: expect.any(Number),
        },
        plan: {
          fidelityScore: expect.any(Number),
          totalItems: expect.any(Number),
          native: expect.any(Number),
          transformed: expect.any(Number),
          manual: expect.any(Number),
          blocked: expect.any(Number),
          issueCount: expect.any(Number),
          agentTaskCount: expect.any(Number),
        },
      },
    });
    expect(summary.analysis.graph.nodeCount).toBeGreaterThan(1);
    expect(summary.analysis.plan.totalItems).toBeGreaterThan(0);
    expect(responseText).not.toContain("raw-private-content-marker-9842");
    expect(responseText).not.toContain(tempDirectory);
    expect(responseText).not.toMatch(/[A-Za-z]:\\|\/(?:Users|home|tmp)\//u);
    expect(logs.join("\n")).not.toContain("raw-private-content-marker-9842");
    expect(logs.join("\n")).not.toContain(tempDirectory);
    expect(await readdir(tempDirectory)).toEqual([]);

    const record = await store.findById(session.id);
    const graph = record?.analysis?.graph;
    const plan = record?.analysis?.plan;
    if (!graph || !plan) {
      throw new Error("The completed analysis was not retained in memory.");
    }
    expect(graph.title).toBe("Notion2Loop Demo");
    expect(graph.sourceDescription).toBe(
      "local-upload:notion-zip",
    );
    expect(
      graph.nodes.some((node) =>
        node.content?.includes("raw-private-content-marker-9842"),
      ),
    ).toBe(true);
    expect(plan.summary).toEqual(summary.analysis.plan);

    const endResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: session.cookie, Origin: app.origin },
      },
    );
    expect(endResponse.status).toBe(204);
    expect(await store.findById(session.id)).toBeUndefined();
  });

  it("rejects declared and chunked compressed-byte overflow and cleans partial temp files", async () => {
    const limits = strictLimits({ maxArchiveBytes: 64 });
    const declaredTemp = await createTemporaryDirectory();
    const declaredApp = await startApp({
      stager: new FileSystemLocalZipArchiveStager({
        tempDirectory: declaredTemp,
        limits,
      }),
    });
    const declaredSession = await startConfiguredSession(declaredApp, 65);

    const declaredResponse = await rawRequest(
      `${declaredApp.origin}/api/v1/connection-session/local-zip-analysis`,
      {
        Cookie: declaredSession.cookie,
        Origin: declaredApp.origin,
        "Content-Type": "application/zip",
        "Content-Length": "65",
      },
    );
    expect(declaredResponse.status).toBe(413);
    expect(JSON.parse(declaredResponse.body)).toMatchObject({
      error: { code: "ZIP_COMPRESSED_LIMIT_EXCEEDED" },
    });
    expect(await readdir(declaredTemp)).toEqual([]);

    const chunkedTemp = await createTemporaryDirectory();
    const chunkedApp = await startApp({
      stager: new FileSystemLocalZipArchiveStager({
        tempDirectory: chunkedTemp,
        limits,
      }),
    });
    const chunkedSession = await startConfiguredSession(chunkedApp, 80);
    const chunkedResponse = await rawRequest(
      `${chunkedApp.origin}/api/v1/connection-session/local-zip-analysis`,
      {
        Cookie: chunkedSession.cookie,
        Origin: chunkedApp.origin,
        "Content-Type": "application/zip",
      },
      [Buffer.alloc(40, 1), Buffer.alloc(40, 2)],
    );

    expect(chunkedResponse.status).toBe(413);
    expect(JSON.parse(chunkedResponse.body)).toMatchObject({
      error: { code: "ZIP_COMPRESSED_LIMIT_EXCEEDED" },
    });
    expect(await readdir(chunkedTemp)).toEqual([]);
    await expectSessionStatus(
      chunkedApp,
      chunkedSession.cookie,
      "failed",
      "failed",
    );
  });

  it.each([
    {
      name: "an empty file",
      archive: new Uint8Array(),
      code: "ZIP_EMPTY",
      message: "비어",
    },
    {
      name: "a non-ZIP file",
      archive: textEncoder.encode("this is not a zip"),
      code: "ZIP_INVALID",
      message: "올바른 Notion ZIP",
    },
    {
      name: "a traversal path",
      archive: zipSync({
        "../escape.md": textEncoder.encode("# unsafe"),
      }),
      code: "ZIP_UNSAFE_PATH",
      message: "안전하지 않은 경로",
    },
  ])("rejects $name with a clear 4xx error", async (testCase) => {
    const tempDirectory = await createTemporaryDirectory();
    const logs: string[] = [];
    const app = await startApp({
      stager: new FileSystemLocalZipArchiveStager({ tempDirectory }),
      logs,
    });
    const session = await startConfiguredSession(
      app,
      testCase.archive.byteLength,
      { allowEmptyMetadata: testCase.archive.byteLength === 0 },
    );

    const response = await uploadZip(app, session.cookie, testCase.archive);
    const body = await response.text();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(JSON.parse(body)).toMatchObject({
      error: {
        code: testCase.code,
        message: expect.stringContaining(testCase.message),
      },
    });
    expect(body).not.toContain(tempDirectory);
    expect(logs.join("\n")).not.toContain(tempDirectory);
    expect(await readdir(tempDirectory)).toEqual([]);
    await expectSessionStatus(app, session.cookie, "failed", "failed");
  });

  it("rejects duplicate paths and decompressed size and file-count violations", async () => {
    const duplicateArchive = await createDuplicatePathArchive();
    await expectArchiveFailure({
      archive: duplicateArchive,
      limits: strictLimits(),
      expectedCode: "ZIP_DUPLICATE_PATH",
      expectedMessage: "같은 경로",
    });

    await expectArchiveFailure({
      archive: zipSync({
        "large.md": textEncoder.encode("12345"),
      }),
      limits: strictLimits({ maxTotalBytes: 4 }),
      expectedCode: "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED",
      expectedMessage: "압축을 푼 크기",
      expectedStatus: 413,
    });

    await expectArchiveFailure({
      archive: zipSync({
        "one.md": textEncoder.encode("1"),
        "two.md": textEncoder.encode("2"),
      }),
      limits: strictLimits({ maxFileCount: 1 }),
      expectedCode: "ZIP_FILE_COUNT_LIMIT_EXCEEDED",
      expectedMessage: "파일 수",
      expectedStatus: 413,
    });

    await expectArchiveFailure({
      archive: forgeUncompressedSize(
        zipSync({
          "forged.md": textEncoder.encode("x".repeat(1_024)),
        }),
        1,
      ),
      limits: strictLimits({ maxTotalBytes: 4 }),
      expectedCode: "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED",
      expectedMessage: "압축을 푼 크기",
      expectedStatus: 413,
    });

    await expectArchiveFailure({
      archive: corruptCentralDirectoryCrc(
        zipSync({
          "crc.md": textEncoder.encode("content"),
        }),
      ),
      limits: strictLimits(),
      expectedCode: "ZIP_INVALID",
      expectedMessage: "올바른 Notion ZIP",
    });
  });

  it("returns a safe 4xx error for malformed exported JSON", async () => {
    const tempDirectory = await createTemporaryDirectory();
    const app = await startApp({
      stager: new FileSystemLocalZipArchiveStager({ tempDirectory }),
    });
    const archive = zipSync({
      "notion-api-snapshot.json": textEncoder.encode("{not-json"),
    });
    const session = await startConfiguredSession(app, archive.byteLength);

    const response = await uploadZip(app, session.cookie, archive);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "ZIP_INVALID",
        message: expect.stringContaining("올바른 Notion ZIP"),
      },
    });
    expect(await readdir(tempDirectory)).toEqual([]);
    await expectSessionStatus(app, session.cookie, "failed", "failed");
  });

  it("closes an incomplete rejected upload so application shutdown cannot hang", async () => {
    const limits = strictLimits({ maxArchiveBytes: 64 });
    const app = await startApp({
      stager: new FileSystemLocalZipArchiveStager({ limits }),
    });
    const session = await startConfiguredSession(app, 100);
    const activeUpload = openChunkedUpload(app, session.cookie, 100);
    const uploadCompletion = activeUpload.response.catch(() => undefined);
    activeUpload.request.write(Buffer.alloc(32, 1));
    await uploadCompletion;

    const closePromise = app.close();
    const closedWithoutClientCleanup = await Promise.race([
      closePromise.then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), 500),
      ),
    ]);
    if (!closedWithoutClientCleanup) {
      activeUpload.request.destroy();
    }
    await closePromise;
    runningApps.splice(runningApps.indexOf(app), 1);
    expect(closedWithoutClientCleanup).toBe(true);
  });

  it("keeps analysis isolated between sessions and removes graph and plan when a session ends", async () => {
    const store = new InMemoryConnectionSessionStore();
    const app = await startApp({ store });
    const archive = await createFixtureArchive();
    const first = await startConfiguredSession(app, archive.byteLength);
    const second = await startConfiguredSession(app, archive.byteLength);

    expect((await uploadZip(app, first.cookie, archive)).status).toBe(200);
    await expectSessionStatus(
      app,
      first.cookie,
      "analysis_ready",
      "ready",
    );
    await expectSessionStatus(
      app,
      second.cookie,
      "configuration_ready",
      "not_started",
    );
    expect((await store.findById(first.id))?.analysis).toBeDefined();
    expect((await store.findById(second.id))?.analysis).toBeUndefined();

    await fetch(`${app.origin}/api/v1/connection-session`, {
      method: "DELETE",
      headers: { Cookie: first.cookie, Origin: app.origin },
    });
    expect(await store.findById(first.id)).toBeUndefined();
    expect(await store.findById(second.id)).toBeDefined();
  });

  it("reports uploading and analyzing transitions and rejects a duplicate in-flight request", async () => {
    const stageGate = deferred<StagedZipArchive>();
    const readGate = deferred<readonly {
      path: string;
      content: Uint8Array;
    }[]>();
    const stageStarted = deferred<void>();
    const readStarted = deferred<void>();
    let disposeCount = 0;
    const source: WorkspaceSource = {
      description: "local-upload:notion-zip",
      async readFiles() {
        readStarted.resolve();
        return readGate.promise;
      },
    };
    const stager: LocalZipArchiveStager = {
      async stage() {
        stageStarted.resolve();
        return stageGate.promise;
      },
    };
    const app = await startApp({ stager });
    const archive = textEncoder.encode("controlled-body");
    const session = await startConfiguredSession(app, archive.byteLength);

    const firstRequest = uploadZip(app, session.cookie, archive);
    await stageStarted.promise;
    await expectSessionStatus(app, session.cookie, "uploading", "uploading");

    const configurationResponse = await fetch(
      `${app.origin}/api/v1/connection-session/configuration`,
      {
        method: "PUT",
        headers: {
          Cookie: session.cookie,
          Origin: app.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: {
            kind: "zip",
            file: {
              name: "replacement.zip",
              sizeBytes: archive.byteLength,
            },
          },
          microsoft: { tenantId, clientId },
          targets: ["planner"],
        }),
      },
    );
    expect(configurationResponse.status).toBe(409);
    expect(await configurationResponse.json()).toMatchObject({
      error: { code: "ZIP_ANALYSIS_IN_PROGRESS" },
    });

    const duplicateResponse = await uploadZip(
      app,
      session.cookie,
      archive,
    );
    expect(duplicateResponse.status).toBe(409);
    expect(await duplicateResponse.json()).toMatchObject({
      error: { code: "ZIP_ANALYSIS_IN_PROGRESS" },
    });

    stageGate.resolve({
      source,
      async dispose() {
        disposeCount += 1;
      },
    });
    await readStarted.promise;
    await expectSessionStatus(app, session.cookie, "analyzing", "analyzing");
    readGate.resolve([
      {
        path: "Local Page 0123456789abcdef0123456789abcdef.md",
        content: textEncoder.encode("# Local Page"),
      },
    ]);

    expect((await firstRequest).status).toBe(200);
    await expectSessionStatus(
      app,
      session.cookie,
      "analysis_ready",
      "ready",
    );
    expect(disposeCount).toBe(1);
  });

  it("cancels an active upload and deletes its partial temp file before ending the session", async () => {
    const tempDirectory = await createTemporaryDirectory();
    const store = new InMemoryConnectionSessionStore();
    const app = await startApp({
      store,
      stager: new FileSystemLocalZipArchiveStager({ tempDirectory }),
    });
    const session = await startConfiguredSession(app, 128);
    const activeUpload = openChunkedUpload(app, session.cookie);
    const uploadCompletion = activeUpload.response.catch(() => undefined);
    activeUpload.request.write(Buffer.alloc(32, 1));

    await waitFor(
      async () => (await readdir(tempDirectory)).length === 1,
    );
    await expectSessionStatus(app, session.cookie, "uploading", "uploading");

    const endResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: session.cookie, Origin: app.origin },
      },
    );

    const tempFilesAfterEnd = await readdir(tempDirectory);
    activeUpload.request.destroy();
    await uploadCompletion;
    expect(endResponse.status).toBe(204);
    expect(tempFilesAfterEnd).toEqual([]);
    expect(await store.findById(session.id)).toBeUndefined();
  });

  it("registers cancellation before awaiting session state so deletion cannot miss a new upload", async () => {
    const beginStarted = deferred<void>();
    const releaseBegin = deferred<void>();
    const store = new DelayedBeginConnectionSessionStore(
      beginStarted,
      releaseBegin,
    );
    const tempDirectory = await createTemporaryDirectory();
    const app = await startApp({
      store,
      stager: new FileSystemLocalZipArchiveStager({ tempDirectory }),
    });
    const session = await startConfiguredSession(app, 32);
    const uploadCompletion = uploadZip(
      app,
      session.cookie,
      Buffer.alloc(32, 1),
    ).catch(() => undefined);
    await beginStarted.promise;

    let deletionSettled = false;
    const deletion = fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: session.cookie, Origin: app.origin },
      },
    ).then((response) => {
      deletionSettled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(deletionSettled).toBe(false);

    releaseBegin.resolve();
    const deleteResponse = await deletion;
    await uploadCompletion;
    expect(deleteResponse.status).toBe(204);
    expect(await readdir(tempDirectory)).toEqual([]);
    expect(await store.findById(session.id)).toBeUndefined();
  });

  it("does not report session deletion success when temp cleanup fails", async () => {
    const stageStarted = deferred<void>();
    const store = new InMemoryConnectionSessionStore();
    const stager: LocalZipArchiveStager = {
      async stage(request) {
        stageStarted.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        throw new LocalZipStagingCleanupError(async () => {
          throw new Error("cleanup remains unavailable");
        });
      },
    };
    const app = await startApp({ store, stager });
    const session = await startConfiguredSession(app, 32);
    const uploadCompletion = uploadZip(
      app,
      session.cookie,
      Buffer.alloc(32, 1),
    ).catch(() => undefined);
    await stageStarted.promise;

    const endResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: session.cookie, Origin: app.origin },
      },
    );
    await uploadCompletion;

    expect(endResponse.status).toBe(500);
    expect(await store.findById(session.id)).toMatchObject({
      analysis: { state: "failed" },
    });
    runningApps.splice(runningApps.indexOf(app), 1);
    await expect(app.close()).rejects.toThrow(
      "temporary file could not be deleted",
    );
  });

  it("retries a transient temp cleanup failure before deleting the session", async () => {
    const stageStarted = deferred<void>();
    let cleanupRetries = 0;
    const store = new InMemoryConnectionSessionStore();
    const stager: LocalZipArchiveStager = {
      async stage(request) {
        stageStarted.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        throw new LocalZipStagingCleanupError(async () => {
          cleanupRetries += 1;
        });
      },
    };
    const app = await startApp({ store, stager });
    const session = await startConfiguredSession(app, 32);
    const uploadCompletion = uploadZip(
      app,
      session.cookie,
      Buffer.alloc(32, 1),
    ).catch(() => undefined);
    await stageStarted.promise;

    const endResponse = await fetch(
      `${app.origin}/api/v1/connection-session`,
      {
        method: "DELETE",
        headers: { Cookie: session.cookie, Origin: app.origin },
      },
    );
    await uploadCompletion;

    expect(endResponse.status).toBe(204);
    expect(cleanupRetries).toBe(1);
    expect(await store.findById(session.id)).toBeUndefined();
  });

  it("allows application shutdown to retry a transient cleanup failure", async () => {
    const stageStarted = deferred<void>();
    let cleanupRetries = 0;
    const stager: LocalZipArchiveStager = {
      async stage(request) {
        stageStarted.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        throw new LocalZipStagingCleanupError(async () => {
          cleanupRetries += 1;
          if (cleanupRetries === 1) {
            throw new Error("transient cleanup failure");
          }
        });
      },
    };
    const app = await startApp({ stager });
    const session = await startConfiguredSession(app, 32);
    const uploadCompletion = uploadZip(
      app,
      session.cookie,
      Buffer.alloc(32, 1),
    ).catch(() => undefined);
    await stageStarted.promise;

    await expect(app.close()).rejects.toThrow(
      "temporary file could not be deleted",
    );
    await uploadCompletion;
    await expect(app.close()).resolves.toBeUndefined();
    expect(cleanupRetries).toBe(2);
    runningApps.splice(runningApps.indexOf(app), 1);
  });
});

interface StartAppOptions {
  readonly store?: InMemoryConnectionSessionStore;
  readonly stager?: LocalZipArchiveStager;
  readonly logs?: string[];
}

async function startApp(
  options: StartAppOptions = {},
): Promise<LocalConnectionApp> {
  const app = await startLocalConnectionApp({
    port: 0,
    ...(options.store ? { store: options.store } : {}),
    ...(options.stager ? { zipArchiveStager: options.stager } : {}),
    logger: {
      error(message) {
        options.logs?.push(message);
      },
    },
  });
  runningApps.push(app);
  return app;
}

async function startConfiguredSession(
  app: LocalConnectionApp,
  sizeBytes: number,
  options: { readonly allowEmptyMetadata?: boolean } = {},
): Promise<{ readonly id: string; readonly cookie: string }> {
  const startResponse = await fetch(
    `${app.origin}/api/v1/connection-session`,
    {
      method: "POST",
      headers: { Origin: app.origin },
    },
  );
  const cookie = readSessionCookie(startResponse);
  const id = cookie.slice(cookie.indexOf("=") + 1);
  const metadataSize =
    sizeBytes === 0 && options.allowEmptyMetadata ? 1 : sizeBytes;
  const configurationResponse = await fetch(
    `${app.origin}/api/v1/connection-session/configuration`,
    {
      method: "PUT",
      headers: {
        Cookie: cookie,
        Origin: app.origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: {
          kind: "zip",
          file: { name: "workspace.zip", sizeBytes: metadataSize },
        },
        microsoft: { tenantId, clientId },
        targets: ["lists", "sharepoint"],
      }),
    },
  );
  expect(configurationResponse.status).toBe(200);
  return { id, cookie };
}

async function uploadZip(
  app: LocalConnectionApp,
  cookie: string,
  archive: Uint8Array,
): Promise<Response> {
  return fetch(
    `${app.origin}/api/v1/connection-session/local-zip-analysis`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: app.origin,
        "Content-Type": "application/zip",
      },
      body: Buffer.from(archive),
    },
  );
}

async function expectSessionStatus(
  app: LocalConnectionApp,
  cookie: string,
  status: string,
  analysis: string,
): Promise<void> {
  const response = await fetch(
    `${app.origin}/api/v1/connection-session`,
    { headers: { Cookie: cookie } },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status,
    workflow: { analysis },
  });
}

async function expectArchiveFailure(options: {
  readonly archive: Uint8Array;
  readonly limits: SourceReadLimits;
  readonly expectedCode: string;
  readonly expectedMessage: string;
  readonly expectedStatus?: number;
}): Promise<void> {
  const tempDirectory = await createTemporaryDirectory();
  const app = await startApp({
    stager: new FileSystemLocalZipArchiveStager({
      tempDirectory,
      limits: options.limits,
    }),
  });
  const session = await startConfiguredSession(
    app,
    options.archive.byteLength,
  );
  const response = await uploadZip(app, session.cookie, options.archive);
  expect(response.status).toBe(options.expectedStatus ?? 422);
  expect(await response.json()).toMatchObject({
    error: {
      code: options.expectedCode,
      message: expect.stringContaining(options.expectedMessage),
    },
  });
  expect(await readdir(tempDirectory)).toEqual([]);
}

async function createFixtureArchive(
  additionalFiles: Readonly<Record<string, Uint8Array>> = {},
): Promise<Uint8Array> {
  const sourceFiles = await new DirectoryWorkspaceSource(
    path.resolve("fixtures/notion-export"),
  ).readFiles();
  const archiveContent: Record<string, Uint8Array> = { ...additionalFiles };
  for (const file of sourceFiles) {
    archiveContent[file.path] = file.content;
  }
  return zipSync(archiveContent);
}

async function createDuplicatePathArchive(): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(chunk);
      if (final) {
        resolve(concatenate(chunks));
      }
    });
    const first = new ZipDeflate("duplicate.md");
    archive.add(first);
    first.push(textEncoder.encode("first"), true);
    const second = new ZipDeflate("duplicate.md");
    archive.add(second);
    second.push(textEncoder.encode("second"), true);
    archive.end();
  });
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const totalBytes = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function forgeUncompressedSize(
  archive: Uint8Array,
  forgedSize: number,
): Uint8Array {
  const forged = Buffer.from(archive);
  const localHeader = forged.indexOf(
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  );
  const centralHeader = forged.indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  if (localHeader < 0 || centralHeader < 0) {
    throw new Error("The ZIP fixture does not contain expected headers.");
  }
  forged.writeUInt32LE(forgedSize, localHeader + 22);
  forged.writeUInt32LE(forgedSize, centralHeader + 24);
  return forged;
}

function corruptCentralDirectoryCrc(archive: Uint8Array): Uint8Array {
  const corrupted = Buffer.from(archive);
  const centralHeader = corrupted.indexOf(
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
  );
  if (centralHeader < 0) {
    throw new Error("The ZIP fixture does not contain a central header.");
  }
  corrupted.writeUInt32LE(0, centralHeader + 16);
  return corrupted;
}

function strictLimits(
  overrides: Partial<SourceReadLimits> = {},
): SourceReadLimits {
  return {
    maxArchiveBytes: 1_024 * 1_024,
    maxTotalBytes: 1_024 * 1_024,
    maxFileCount: 100,
    ...overrides,
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "notion2loop-upload-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function readSessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("The local app did not set a session cookie.");
  }
  return setCookie.split(";", 1)[0] ?? "";
}

interface RawResponse {
  readonly status: number;
  readonly body: string;
}

interface ActiveUpload {
  readonly request: ReturnType<typeof httpRequest>;
  readonly response: Promise<RawResponse>;
}

function openChunkedUpload(
  app: LocalConnectionApp,
  cookie: string,
  declaredBytes?: number,
): ActiveUpload {
  let requestReference: ReturnType<typeof httpRequest> | undefined;
  const response = new Promise<RawResponse>((resolve, reject) => {
    const request = httpRequest(
      `${app.origin}/api/v1/connection-session/local-zip-analysis`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: app.origin,
          "Content-Type": "application/zip",
          ...(declaredBytes !== undefined
            ? { "Content-Length": String(declaredBytes) }
            : {}),
        },
      },
      (incomingResponse) => {
        const chunks: Buffer[] = [];
        incomingResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
        incomingResponse.once("end", () => {
          resolve({
            status: incomingResponse.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    request.once("error", reject);
    requestReference = request;
  });
  if (!requestReference) {
    throw new Error("The active upload request was not initialized.");
  }
  return { request: requestReference, response };
}

async function rawRequest(
  url: string,
  headers: Readonly<Record<string, string>>,
  chunks: readonly Uint8Array[] = [],
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: "POST", headers },
      (response) => {
        const responseChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => responseChunks.push(chunk));
        response.once("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString("utf-8"),
          });
        });
      },
    );
    request.once("error", reject);
    for (const chunk of chunks) {
      request.write(chunk);
    }
    request.end();
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

class DelayedBeginConnectionSessionStore extends InMemoryConnectionSessionStore {
  public constructor(
    private readonly beginStarted: Deferred<void>,
    private readonly releaseBegin: Deferred<void>,
  ) {
    super();
  }

  public override async beginZipAnalysis(sessionId: string) {
    this.beginStarted.resolve();
    await this.releaseBegin.promise;
    return super.beginZipAnalysis(sessionId);
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) {
        throw new Error("Deferred promise was not initialized.");
      }
      resolvePromise(value);
    },
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the expected state.");
}
