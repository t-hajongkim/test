import {
  summarizeConnectionSession,
  type ConnectionSessionSummary,
} from "./connection-session-summary.js";
import type { ConnectionSessionStore } from "./connection-session-store.js";

export interface StartConnectionSessionResult {
  readonly sessionId: string;
  readonly summary: ConnectionSessionSummary;
}

export class StartConnectionSession {
  public constructor(private readonly store: ConnectionSessionStore) {}

  public async execute(): Promise<StartConnectionSessionResult> {
    const session = await this.store.create();
    return {
      sessionId: session.id,
      summary: summarizeConnectionSession(session),
    };
  }
}
