import type {
  ConnectionConfiguration,
  NotionToken,
} from "../domain/connection-setup.js";

export interface ConnectionSessionRecord {
  readonly id: string;
  readonly configuration?: ConnectionConfiguration;
  readonly notionToken?: NotionToken;
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
  deleteById(sessionId: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class ConnectionSessionNotFoundError extends Error {
  public constructor() {
    super("Connection session was not found.");
    this.name = "ConnectionSessionNotFoundError";
  }
}
