import type {
  ConnectionConfiguration,
  NotionToken,
} from "../domain/connection-setup.js";
import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";

export type ConnectionAnalysisState =
  | "uploading"
  | "analyzing"
  | "ready"
  | "failed";

export interface ConnectionSessionAnalysis {
  readonly state: ConnectionAnalysisState;
  readonly graph?: CanonicalWorkspaceGraph;
  readonly plan?: MigrationPlan;
}

export interface ConnectionSessionRecord {
  readonly id: string;
  readonly configuration?: ConnectionConfiguration;
  readonly notionToken?: NotionToken;
  readonly analysis?: ConnectionSessionAnalysis;
}

export interface ConnectionSessionStore {
  create(): Promise<ConnectionSessionRecord>;
  findById(sessionId: string): Promise<ConnectionSessionRecord | undefined>;
  saveConfiguration(
    sessionId: string,
    configuration: ConnectionConfiguration,
    notionToken?: NotionToken,
  ): Promise<ConnectionSessionRecord>;
  clearNotionToken(sessionId: string): Promise<ConnectionSessionRecord>;
  beginZipAnalysis(sessionId: string): Promise<ConnectionSessionRecord>;
  markZipAnalysisRunning(sessionId: string): Promise<ConnectionSessionRecord>;
  completeZipAnalysis(
    sessionId: string,
    graph: CanonicalWorkspaceGraph,
    plan: MigrationPlan,
  ): Promise<ConnectionSessionRecord>;
  failZipAnalysis(sessionId: string): Promise<ConnectionSessionRecord>;
  deleteById(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class ConnectionSessionNotFoundError extends Error {
  public constructor() {
    super("Connection session was not found.");
    this.name = "ConnectionSessionNotFoundError";
  }
}

export class ConnectionZipConfigurationRequiredError extends Error {
  public constructor() {
    super("A ZIP source configuration is required.");
    this.name = "ConnectionZipConfigurationRequiredError";
  }
}

export class ConnectionAnalysisInProgressError extends Error {
  public constructor() {
    super("A ZIP analysis is already in progress.");
    this.name = "ConnectionAnalysisInProgressError";
  }
}

export class ConnectionAnalysisStateError extends Error {
  public constructor() {
    super("The ZIP analysis state transition is invalid.");
    this.name = "ConnectionAnalysisStateError";
  }
}
