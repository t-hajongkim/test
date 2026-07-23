import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { unzipSync } from "fflate";

import type {
  SourceFile,
  WorkspaceSource,
} from "../application/workspace-source.js";
import {
  assertArchiveByteCount,
  assertSourceByteCount,
  assertSourceFileCount,
  DEFAULT_SOURCE_READ_LIMITS,
  type SourceReadLimits,
} from "./source-limits.js";
import { assertSafeSourcePath } from "./source-path.js";

export class ZipWorkspaceSource implements WorkspaceSource {
  public readonly description: string;

  public constructor(
    private readonly archivePath: string,
    private readonly limits: SourceReadLimits = DEFAULT_SOURCE_READ_LIMITS,
  ) {
    this.description = `zip:${path.resolve(archivePath)}`;
  }

  public async readFiles(): Promise<readonly SourceFile[]> {
    const archiveStat = await stat(this.archivePath);
    assertArchiveByteCount(
      archiveStat.size,
      this.limits,
      this.description,
    );

    const archive = await readFile(this.archivePath);
    const normalizedPaths = new Set<string>();
    let declaredFileCount = 0;
    let declaredTotalBytes = 0;
    const entries = unzipSync(archive, {
      filter: (entry) => {
        const safePath = assertSafeSourcePath(entry.name);
        if (safePath.endsWith("/")) {
          return false;
        }

        if (normalizedPaths.has(safePath)) {
          throw new Error(`Duplicate ZIP source path: ${safePath}`);
        }

        normalizedPaths.add(safePath);
        declaredFileCount += 1;
        declaredTotalBytes += entry.originalSize;
        assertSourceFileCount(
          declaredFileCount,
          this.limits,
          this.description,
        );
        assertSourceByteCount(
          declaredTotalBytes,
          this.limits,
          this.description,
        );
        return true;
      },
    });
    const files: SourceFile[] = [];
    let actualTotalBytes = 0;

    for (const [entryPath, content] of Object.entries(entries)) {
      const safePath = assertSafeSourcePath(entryPath);
      actualTotalBytes += content.byteLength;
      assertSourceByteCount(
        actualTotalBytes,
        this.limits,
        this.description,
      );

      files.push({
        path: safePath,
        content,
      });
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
  }
}
