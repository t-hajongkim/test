import type { ConnectionSessionStore } from "./connection-session-store.js";
import type { LocalZipAnalysisLifecycle } from "./local-zip-analysis-lifecycle.js";

export interface EndConnectionSessionRequest {
  readonly sessionId: string;
}

export class EndConnectionSession {
  public constructor(
    private readonly store: ConnectionSessionStore,
    private readonly zipAnalysisLifecycle: LocalZipAnalysisLifecycle,
  ) {}

  public async execute(request: EndConnectionSessionRequest): Promise<void> {
    await this.zipAnalysisLifecycle.cancel(request.sessionId);
    await this.store.deleteById(request.sessionId);
  }
}
