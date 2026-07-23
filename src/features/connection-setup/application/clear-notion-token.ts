import {
  summarizeConnectionSession,
  type ConnectionSessionSummary,
} from "./connection-session-summary.js";
import type { ConnectionSessionStore } from "./connection-session-store.js";

export interface ClearNotionTokenRequest {
  readonly sessionId: string;
}

export class ClearNotionToken {
  public constructor(private readonly store: ConnectionSessionStore) {}

  public async execute(
    request: ClearNotionTokenRequest,
  ): Promise<ConnectionSessionSummary> {
    const session = await this.store.clearNotionToken(request.sessionId);
    return summarizeConnectionSession(session);
  }
}
