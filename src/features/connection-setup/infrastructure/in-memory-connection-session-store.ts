import { randomBytes } from "node:crypto";

import {
  ConnectionAnalysisInProgressError,
  ConnectionAnalysisStateError,
  ConnectionSessionNotFoundError,
  ConnectionZipConfigurationRequiredError,
  type ConnectionSessionRecord,
  type ConnectionSessionStore,
} from "../application/connection-session-store.js";
import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";
import type {
  ConnectionConfiguration,
  NotionToken,
} from "../domain/connection-setup.js";

export class InMemoryConnectionSessionStore implements ConnectionSessionStore {
  readonly #sessions = new Map<string, ConnectionSessionRecord>();

  public get size(): number {
    return this.#sessions.size;
  }

  public async create(): Promise<ConnectionSessionRecord> {
    let id: string;
    do {
      id = randomBytes(32).toString("base64url");
    } while (this.#sessions.has(id));

    const session = { id };
    this.#sessions.set(id, session);
    return session;
  }

  public async findById(
    sessionId: string,
  ): Promise<ConnectionSessionRecord | undefined> {
    return this.#sessions.get(sessionId);
  }

  public async saveConfiguration(
    sessionId: string,
    configuration: ConnectionConfiguration,
    notionToken?: NotionToken,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    if (
      current.analysis?.state === "uploading" ||
      current.analysis?.state === "analyzing"
    ) {
      throw new ConnectionAnalysisInProgressError();
    }
    const session: ConnectionSessionRecord = {
      id: sessionId,
      configuration,
      ...(notionToken ? { notionToken } : {}),
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async clearNotionToken(
    sessionId: string,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    const session: ConnectionSessionRecord = {
      id: current.id,
      ...(current.configuration
        ? { configuration: current.configuration }
        : {}),
      ...(current.analysis ? { analysis: current.analysis } : {}),
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async beginZipAnalysis(
    sessionId: string,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    if (current.configuration?.source.kind !== "zip") {
      throw new ConnectionZipConfigurationRequiredError();
    }
    if (
      current.analysis?.state === "uploading" ||
      current.analysis?.state === "analyzing"
    ) {
      throw new ConnectionAnalysisInProgressError();
    }
    const session: ConnectionSessionRecord = {
      ...current,
      analysis: { state: "uploading" },
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async markZipAnalysisRunning(
    sessionId: string,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    if (current.analysis?.state !== "uploading") {
      throw new ConnectionAnalysisStateError();
    }
    const session: ConnectionSessionRecord = {
      ...current,
      analysis: { state: "analyzing" },
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async completeZipAnalysis(
    sessionId: string,
    graph: CanonicalWorkspaceGraph,
    plan: MigrationPlan,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    if (current.analysis?.state !== "analyzing") {
      throw new ConnectionAnalysisStateError();
    }
    const session: ConnectionSessionRecord = {
      ...current,
      analysis: { state: "ready", graph, plan },
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async failZipAnalysis(
    sessionId: string,
  ): Promise<ConnectionSessionRecord> {
    const current = this.requireSession(sessionId);
    if (
      current.analysis?.state !== "uploading" &&
      current.analysis?.state !== "analyzing"
    ) {
      throw new ConnectionAnalysisStateError();
    }
    const session: ConnectionSessionRecord = {
      ...current,
      analysis: { state: "failed" },
    };
    this.#sessions.set(sessionId, session);
    return session;
  }

  public async deleteById(sessionId: string): Promise<void> {
    if (!this.#sessions.delete(sessionId)) {
      throw new ConnectionSessionNotFoundError();
    }
  }

  public async clearAll(): Promise<void> {
    this.#sessions.clear();
  }

  private requireSession(sessionId: string): ConnectionSessionRecord {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new ConnectionSessionNotFoundError();
    }
    return session;
  }
}
