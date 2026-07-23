import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import fastGlob from "fast-glob";

import type {
  SourceFile,
  WorkspaceSource,
} from "../application/workspace-source.js";
import {
  assertSourceByteCount,
  assertSourceEntryByteCount,
  assertSourceFileCount,
  DEFAULT_SOURCE_READ_LIMITS,
  type SourceReadLimits,
} from "./source-limits.js";
import { assertSafeSourcePath } from "./source-path.js";

export class DirectoryWorkspaceSource implements WorkspaceSource {
  public readonly description: string;

  public constructor(
    private readonly directory: string,
    private readonly limits: SourceReadLimits = DEFAULT_SOURCE_READ_LIMITS,
  ) {
    this.description = `directory:${path.resolve(directory)}`;
  }

  public async *readFiles(): AsyncIterable<SourceFile> {
    const relativePaths = await fastGlob("**/*", {
      cwd: this.directory,
      onlyFiles: true,
      followSymbolicLinks: false,
      dot: false,
    });

    assertSourceFileCount(
      relativePaths.length,
      this.limits,
      this.description,
    );

    let totalBytes = 0;

    for (const relativePath of relativePaths.sort()) {
      const safePath = assertSafeSourcePath(relativePath);
      const absolutePath = path.join(this.directory, relativePath);
      const fileStat = await stat(absolutePath);
      assertSourceEntryByteCount(
        fileStat.size,
        this.limits,
        this.description,
      );
      assertSourceByteCount(
        totalBytes + fileStat.size,
        this.limits,
        this.description,
      );

      const content = await readFile(absolutePath);
      assertSourceEntryByteCount(
        content.byteLength,
        this.limits,
        this.description,
      );
      totalBytes += content.byteLength;
      assertSourceByteCount(totalBytes, this.limits, this.description);
      yield {
        path: safePath,
        content,
      };
    }
  }
}
