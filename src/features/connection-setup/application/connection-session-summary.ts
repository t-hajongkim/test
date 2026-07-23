import type {
  ConnectionConfiguration,
  ConnectionSourceConfiguration,
  MicrosoftTarget,
} from "../domain/connection-setup.js";
import type { ConnectionSessionRecord } from "./connection-session-store.js";

export interface ConnectionSessionSummary {
  readonly status:
    | "collecting_configuration"
    | "configuration_ready"
    | "uploading"
    | "analyzing"
    | "analysis_ready"
    | "failed";
  readonly configured: boolean;
  readonly notionTokenPresent: boolean;
  readonly source?: ConnectionSourceConfiguration;
  readonly microsoft?: ConnectionConfiguration["microsoft"];
  readonly targets?: readonly MicrosoftTarget[];
  readonly workflow: {
    readonly analysis:
      | "not_started"
      | "uploading"
      | "analyzing"
      | "ready"
      | "failed";
    readonly reviewApproval: "not_started";
    readonly deployment: "disabled";
  };
  readonly analysis?: {
    readonly graph: {
      readonly nodeCount: number;
      readonly edgeCount: number;
      readonly warningCount: number;
    };
    readonly plan: {
      readonly fidelityScore: number;
      readonly totalItems: number;
      readonly native: number;
      readonly transformed: number;
      readonly manual: number;
      readonly blocked: number;
      readonly issueCount: number;
      readonly agentTaskCount: number;
    };
  };
}

export function summarizeConnectionSession(
  session: ConnectionSessionRecord,
): ConnectionSessionSummary {
  const notionTokenPresent = session.notionToken !== undefined;
  const configured =
    session.configuration !== undefined &&
    (session.configuration.source.kind === "zip" || notionTokenPresent);

  const analysisStatus = session.analysis?.state ?? "not_started";
  const status =
    analysisStatus === "ready"
      ? "analysis_ready"
      : analysisStatus === "not_started"
        ? configured
          ? "configuration_ready"
          : "collecting_configuration"
        : analysisStatus;
  const completedAnalysis =
    session.analysis?.state === "ready" &&
    session.analysis.graph &&
    session.analysis.plan
      ? {
          graph: {
            nodeCount: session.analysis.graph.nodes.length,
            edgeCount: session.analysis.graph.edges.length,
            warningCount: session.analysis.graph.warnings.length,
          },
          plan: session.analysis.plan.summary,
        }
      : undefined;

  return {
    status,
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
      analysis: analysisStatus,
      reviewApproval: "not_started",
      deployment: "disabled",
    },
    ...(completedAnalysis ? { analysis: completedAnalysis } : {}),
  };
}
