import {
  ConnectionSetupRequestSchema,
  NotionToken,
  type ConnectionConfiguration,
} from "../domain/connection-setup.js";
import {
  summarizeConnectionSession,
  type ConnectionSessionSummary,
} from "./connection-session-summary.js";
import type { ConnectionSessionStore } from "./connection-session-store.js";

export interface SaveConnectionSetupRequest {
  readonly sessionId: string;
  readonly configuration: unknown;
}

export class SaveConnectionSetup {
  public constructor(private readonly store: ConnectionSessionStore) {}

  public async execute(
    request: SaveConnectionSetupRequest,
  ): Promise<ConnectionSessionSummary> {
    const parsed = ConnectionSetupRequestSchema.parse(request.configuration);

    if (parsed.source.kind === "notion_api") {
      const configuration: ConnectionConfiguration = {
        source: {
          kind: parsed.source.kind,
          root: parsed.source.root,
        },
        microsoft: parsed.microsoft,
        targets: parsed.targets,
      };
      const session = await this.store.saveConfiguration(
        request.sessionId,
        configuration,
        NotionToken.create(parsed.source.notionToken),
      );
      return summarizeConnectionSession(session);
    }

    const session = await this.store.saveConfiguration(request.sessionId, {
      source: parsed.source,
      microsoft: parsed.microsoft,
      targets: parsed.targets,
    });
    return summarizeConnectionSession(session);
  }
}
