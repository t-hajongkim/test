import type { ConnectionSessionStore } from "./connection-session-store.js";

export interface EndConnectionSessionRequest {
  readonly sessionId: string;
}

export class EndConnectionSession {
  public constructor(private readonly store: ConnectionSessionStore) {}

  public async execute(request: EndConnectionSessionRequest): Promise<void> {
    await this.store.deleteById(request.sessionId);
  }
}
