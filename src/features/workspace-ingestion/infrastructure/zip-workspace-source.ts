import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  SourceFile,
  WorkspaceSource,
} from "../application/workspace-source.js";
import {
  assertArchiveByteCount,
  DEFAULT_SOURCE_READ_LIMITS,
  type SourceReadLimits,
} from "./source-limits.js";
import { readValidatedZipEntries } from "./validated-zip-reader.js";

export class ZipWorkspaceSource implements WorkspaceSource {
  public readonly description: string;

  public constructor(
    private readonly archivePath: string,
    private readonly limits: SourceReadLimits = DEFAULT_SOURCE_READ_LIMITS,
    description?: string,
  ) {
    this.description = description ?? `zip:${path.resolve(archivePath)}`;
  }

  public async readFiles(): Promise<readonly SourceFile[]> {
    const archiveStat = await stat(this.archivePath);
    assertArchiveByteCount(
      archiveStat.size,
      this.limits,
      this.description,
    );

    const archive = await readFile(this.archivePath);
    return readValidatedZipEntries(
      archive,
      this.limits,
      this.description,
    );
  }
}
