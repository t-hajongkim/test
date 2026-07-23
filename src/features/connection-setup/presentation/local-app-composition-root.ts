import type { Server } from "node:http";

import { ClearNotionToken } from "../application/clear-notion-token.js";
import { AnalyzeLocalZip } from "../application/analyze-local-zip.js";
import type { ConnectionSessionStore } from "../application/connection-session-store.js";
import { EndConnectionSession } from "../application/end-connection-session.js";
import { GetConnectionSessionSummary } from "../application/get-connection-session-summary.js";
import { SaveConnectionSetup } from "../application/save-connection-setup.js";
import { StartConnectionSession } from "../application/start-connection-session.js";
import { InMemoryConnectionSessionStore } from "../infrastructure/in-memory-connection-session-store.js";
import type { LocalZipArchiveStager } from "../application/local-zip-archive-stager.js";
import { FileSystemLocalZipArchiveStager } from "../infrastructure/file-system-local-zip-archive-stager.js";
import { IngestWorkspace } from "../../workspace-ingestion/application/ingest-workspace.js";
import { NotionExportParser } from "../../workspace-ingestion/infrastructure/notion-export-parser.js";
import { AnalyzeWorkspace } from "../../compatibility-analysis/application/analyze-workspace.js";
import { DeterministicCompatibilityPolicy } from "../../compatibility-analysis/infrastructure/deterministic-compatibility-policy.js";
import {
  startLocalConnectionHttpServer,
  type LocalConnectionAppLogger,
} from "./local-connection-app-server.js";

export interface StartLocalConnectionAppOptions {
  readonly port: number;
  readonly store?: ConnectionSessionStore;
  readonly zipArchiveStager?: LocalZipArchiveStager;
  readonly logger?: LocalConnectionAppLogger;
}

export interface LocalConnectionApp {
  readonly server: Server;
  readonly origin: string;
  close(): Promise<void>;
}

const defaultLogger: LocalConnectionAppLogger = {
  error(message) {
    process.stderr.write(`${message}\n`);
  },
};

export async function startLocalConnectionApp(
  options: StartLocalConnectionAppOptions,
): Promise<LocalConnectionApp> {
  const store = options.store ?? new InMemoryConnectionSessionStore();
  const analyzeLocalZip = new AnalyzeLocalZip(
    store,
    options.zipArchiveStager ?? new FileSystemLocalZipArchiveStager(),
    new IngestWorkspace(new NotionExportParser()),
    new AnalyzeWorkspace(new DeterministicCompatibilityPolicy()),
  );
  const runtime = await startLocalConnectionHttpServer(
    {
      store,
      startSession: new StartConnectionSession(store),
      saveSetup: new SaveConnectionSetup(store),
      getSummary: new GetConnectionSessionSummary(store),
      clearNotionToken: new ClearNotionToken(store),
      endSession: new EndConnectionSession(store, analyzeLocalZip),
      analyzeLocalZip,
    },
    options.port,
    options.logger ?? defaultLogger,
  );
  let closed = false;
  let closeAttempt: Promise<void> | undefined;
  let serverClose: Promise<void> | undefined;

  return {
    server: runtime.server,
    origin: runtime.origin,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      if (closeAttempt) {
        return closeAttempt;
      }
      closeAttempt = closeApplication();
      try {
        await closeAttempt;
        closed = true;
      } finally {
        closeAttempt = undefined;
      }
    },
  };

  async function closeApplication(): Promise<void> {
    analyzeLocalZip.stopAccepting();
    serverClose ??= closeServer(runtime.server);
    let cancellationFailure: unknown;
    try {
      await analyzeLocalZip.cancelAll();
    } catch (error) {
      cancellationFailure = error;
    }
    await serverClose;
    if (cancellationFailure) {
      throw cancellationFailure;
    }
    await store.clearAll();
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
