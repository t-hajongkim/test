import { randomBytes } from "node:crypto";
import { open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  LocalZipStagingCancelledError,
  LocalZipStagingCleanupError,
  type LocalZipArchiveStager,
  type StageLocalZipArchiveRequest,
  type StagedZipArchive,
} from "../application/local-zip-archive-stager.js";
import { WorkspaceSourceError } from "../../workspace-ingestion/application/workspace-source-error.js";
import {
  assertArchiveByteCount,
  DEFAULT_SOURCE_READ_LIMITS,
  type SourceReadLimits,
} from "../../workspace-ingestion/infrastructure/source-limits.js";
import { ZipWorkspaceSource } from "../../workspace-ingestion/infrastructure/zip-workspace-source.js";

export interface FileSystemLocalZipArchiveStagerOptions {
  readonly tempDirectory?: string;
  readonly limits?: SourceReadLimits;
}

export class FileSystemLocalZipArchiveStager
  implements LocalZipArchiveStager
{
  readonly #tempDirectory: string;
  readonly #limits: SourceReadLimits;

  public constructor(
    options: FileSystemLocalZipArchiveStagerOptions = {},
  ) {
    this.#tempDirectory = options.tempDirectory ?? os.tmpdir();
    this.#limits = options.limits ?? DEFAULT_SOURCE_READ_LIMITS;
  }

  public async stage(
    request: StageLocalZipArchiveRequest,
  ): Promise<StagedZipArchive> {
    throwIfCancelled(request.signal);
    if (request.declaredBytes !== undefined) {
      assertArchiveByteCount(
        request.declaredBytes,
        this.#limits,
        "Local ZIP upload",
      );
      if (request.declaredBytes === 0) {
        throw emptyArchiveError();
      }
    }

    const archivePath = path.join(
      this.#tempDirectory,
      `notion2loop-${randomBytes(24).toString("hex")}.zip`,
    );
    const handle = await open(archivePath, "wx", 0o600);
    let handleOpen = true;
    let byteCount = 0;

    try {
      for await (const chunk of request.content) {
        throwIfCancelled(request.signal);
        const bytes =
          chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        byteCount += bytes.byteLength;
        assertArchiveByteCount(
          byteCount,
          this.#limits,
          "Local ZIP upload",
        );
        await writeAll(handle, bytes);
      }

      throwIfCancelled(request.signal);
      if (byteCount === 0) {
        throw emptyArchiveError();
      }
      if (byteCount !== request.expectedBytes) {
        throw new WorkspaceSourceError(
          "archive_size_mismatch",
          "The uploaded ZIP size does not match the selected file metadata.",
        );
      }

      await handle.close();
      handleOpen = false;
      let disposed = false;
      const removeArchive = async (): Promise<void> => {
        await rm(archivePath);
        disposed = true;
      };
      return {
        source: new ZipWorkspaceSource(
          archivePath,
          this.#limits,
          "local-upload:notion-zip",
        ),
        async dispose(): Promise<void> {
          if (disposed) {
            return;
          }
          try {
            await removeArchive();
          } catch {
            throw new LocalZipStagingCleanupError(removeArchive);
          }
        },
      };
    } catch (error) {
      const removePartialArchive = async (): Promise<void> => {
        let cleanupFailure: unknown;
        if (handleOpen) {
          try {
            await handle.close();
            handleOpen = false;
          } catch (closeError) {
            cleanupFailure = closeError;
          }
        }
        try {
          await rm(archivePath, { force: true });
        } catch (removeError) {
          cleanupFailure ??= removeError;
        }
        if (cleanupFailure) {
          throw cleanupFailure;
        }
      };
      try {
        await removePartialArchive();
      } catch {
        throw new LocalZipStagingCleanupError(removePartialArchive);
      }
      throw error;
    }
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    offset += bytesWritten;
  }
}

function emptyArchiveError(): WorkspaceSourceError {
  return new WorkspaceSourceError(
    "empty_source",
    "The local ZIP upload is empty.",
  );
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new LocalZipStagingCancelledError();
  }
}
