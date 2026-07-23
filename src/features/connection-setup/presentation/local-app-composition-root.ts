import type { Server } from "node:http";

import { ClearNotionToken } from "../application/clear-notion-token.js";
import type { ConnectionSessionStore } from "../application/connection-session-store.js";
import { EndConnectionSession } from "../application/end-connection-session.js";
import { GetConnectionSessionSummary } from "../application/get-connection-session-summary.js";
import { SaveConnectionSetup } from "../application/save-connection-setup.js";
import { StartConnectionSession } from "../application/start-connection-session.js";
import { InMemoryConnectionSessionStore } from "../infrastructure/in-memory-connection-session-store.js";
import {
  startLocalConnectionHttpServer,
  type LocalConnectionAppLogger,
} from "./local-connection-app-server.js";

export interface StartLocalConnectionAppOptions {
  readonly port: number;
  readonly store?: ConnectionSessionStore;
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
  const runtime = await startLocalConnectionHttpServer(
    {
      store,
      startSession: new StartConnectionSession(store),
      saveSetup: new SaveConnectionSetup(store),
      getSummary: new GetConnectionSessionSummary(store),
      clearNotionToken: new ClearNotionToken(store),
      endSession: new EndConnectionSession(store),
    },
    options.port,
    options.logger ?? defaultLogger,
  );
  let closed = false;

  return {
    server: runtime.server,
    origin: runtime.origin,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      try {
        await closeServer(runtime.server);
      } finally {
        await store.clearAll();
      }
    },
  };
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
