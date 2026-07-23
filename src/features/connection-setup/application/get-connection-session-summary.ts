import {
  summarizeConnectionSession,
  type ConnectionSessionSummary,
} from "./connection-session-summary.js";
import {
  ConnectionSessionNotFoundError,
  type ConnectionSessionStore,
} from "./connection-session-store.js";

export interface GetConnectionSessionSummaryRequest {
  readonly sessionId: string;
}

export class GetConnectionSessionSummary {
  public constructor(private readonly store: ConnectionSessionStore) {}

  public async execute(
    request: GetConnectionSessionSummaryRequest,
  ): Promise<ConnectionSessionSummary> {
    const session = await this.store.findById(request.sessionId);
    if (!session) {
      throw new ConnectionSessionNotFoundError();
    }
    return summarizeConnectionSession(session);
  }
}
