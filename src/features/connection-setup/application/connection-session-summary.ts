import type {
  ConnectionConfiguration,
  ConnectionSourceConfiguration,
  MicrosoftTarget,
} from "../domain/connection-setup.js";
import type { ConnectionSessionRecord } from "./connection-session-store.js";

export interface ConnectionSessionSummary {
  readonly status: "collecting_configuration" | "configuration_ready";
  readonly configured: boolean;
  readonly notionTokenPresent: boolean;
  readonly source?: ConnectionSourceConfiguration;
  readonly microsoft?: ConnectionConfiguration["microsoft"];
  readonly targets?: readonly MicrosoftTarget[];
  readonly workflow: {
    readonly analysis: "not_started";
    readonly reviewApproval: "not_started";
    readonly deployment: "disabled";
  };
}

export function summarizeConnectionSession(
  session: ConnectionSessionRecord,
): ConnectionSessionSummary {
  const notionTokenPresent = session.notionToken !== undefined;
  const configured =
    session.configuration !== undefined &&
    (session.configuration.source.kind === "zip" || notionTokenPresent);

  return {
    status: configured ? "configuration_ready" : "collecting_configuration",
    configured,
    notionTokenPresent,
    ...(session.configuration
      ? {
          source: session.configuration.source,
          microsoft: session.configuration.microsoft,
          targets: session.configuration.targets,
        }
      : {}),
    workflow: {
      analysis: "not_started",
      reviewApproval: "not_started",
      deployment: "disabled",
    },
  };
}
