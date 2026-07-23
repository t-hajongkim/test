import type { WorkspaceSource } from "../../workspace-ingestion/application/workspace-source.js";

export interface StageLocalZipArchiveRequest {
  readonly content: AsyncIterable<Uint8Array>;
  readonly expectedBytes: number;
  readonly declaredBytes?: number;
  readonly signal: AbortSignal;
}

export interface StagedZipArchive {
  readonly source: WorkspaceSource;
  dispose(): Promise<void>;
}

export interface LocalZipArchiveStager {
  stage(request: StageLocalZipArchiveRequest): Promise<StagedZipArchive>;
}

export class LocalZipStagingCancelledError extends Error {
  public constructor() {
    super("The local ZIP staging operation was cancelled.");
    this.name = "LocalZipStagingCancelledError";
  }
}

export class LocalZipStagingCleanupError extends Error {
  public constructor(
    private readonly retry: () => Promise<void>,
  ) {
    super("The local ZIP temporary file could not be deleted.");
    this.name = "LocalZipStagingCleanupError";
  }

  public async retryCleanup(): Promise<void> {
    await this.retry();
  }
}
