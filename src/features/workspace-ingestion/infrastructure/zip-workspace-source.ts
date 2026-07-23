import path from "node:path";

import type { SourceFile, WorkspaceSource } from "../application/workspace-source.js";
import { DEFAULT_SOURCE_READ_LIMITS, type SourceReadLimits } from "./source-limits.js";
import { readValidatedZipEntries } from "./validated-zip-reader.js";

export class ZipWorkspaceSource implements WorkspaceSource {
  public readonly description: string;

  public constructor(
    private readonly archivePath: string,
    private readonly limits: SourceReadLimits = DEFAULT_SOURCE_READ_LIMITS,
    description?: string,
    private readonly signal?: AbortSignal,
  ) {
    this.description = description ?? `zip:${path.resolve(archivePath)}`;
  }

  public readFiles(): AsyncIterable<SourceFile> {
    return readValidatedZipEntries(
      this.archivePath,
      this.limits,
      this.description,
      this.signal,
    );
  }
}
