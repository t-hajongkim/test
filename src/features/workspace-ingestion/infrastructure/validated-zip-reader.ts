import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

import type { SourceFile } from "../application/workspace-source.js";
import { WorkspaceSourceError } from "../application/workspace-source-error.js";
import {
  assertSourceByteCount,
  assertSourceFileCount,
  type SourceReadLimits,
} from "./source-limits.js";
import { assertSafeSourcePath } from "./source-path.js";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_END_RECORD_SEARCH = 65_557;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const CRC_TABLE = createCrcTable();

interface ZipEntry {
  readonly path: string;
  readonly compression: number;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export async function readValidatedZipEntries(
  archive: Uint8Array,
  limits: SourceReadLimits,
  description: string,
): Promise<readonly SourceFile[]> {
  const bytes = Buffer.from(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength,
  );
  try {
    const { entries, centralDirectoryOffset } =
      parseCentralDirectory(bytes);
    const normalizedPaths = new Set<string>();
    const fileEntries: ZipEntry[] = [];
    let declaredTotalBytes = 0;

    for (const entry of entries) {
      const safePath = assertSafeSourcePath(entry.path);
      if (safePath.endsWith("/")) {
        continue;
      }
      if (normalizedPaths.has(safePath)) {
        throw new WorkspaceSourceError(
          "duplicate_path",
          `Duplicate ZIP source path: ${safePath}`,
        );
      }
      normalizedPaths.add(safePath);
      assertSourceFileCount(
        normalizedPaths.size,
        limits,
        description,
      );
      declaredTotalBytes += entry.uncompressedSize;
      assertSourceByteCount(declaredTotalBytes, limits, description);
      fileEntries.push({ ...entry, path: safePath });
    }

    validateEntryRanges(bytes, fileEntries, centralDirectoryOffset);
    const files: SourceFile[] = [];
    let actualTotalBytes = 0;
    for (const entry of fileEntries) {
      const compressed = readCompressedEntry(
        bytes,
        entry,
        centralDirectoryOffset,
      );
      const content = await decompressEntry(
        entry,
        compressed,
        (chunkBytes) => {
          actualTotalBytes += chunkBytes;
          assertSourceByteCount(actualTotalBytes, limits, description);
        },
      );
      if (
        content.byteLength !== entry.uncompressedSize ||
        crc32(content) !== entry.crc
      ) {
        throw invalidArchive(description);
      }
      files.push({ path: entry.path, content });
    }
    return files.sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  } catch (error) {
    if (error instanceof WorkspaceSourceError) {
      throw error;
    }
    throw invalidArchive(description);
  }
}

function parseCentralDirectory(archive: Buffer): {
  readonly entries: readonly ZipEntry[];
  readonly centralDirectoryOffset: number;
} {
  const endOffset = findEndOfCentralDirectory(archive);
  if (
    archive.readUInt16LE(endOffset + 4) !== 0 ||
    archive.readUInt16LE(endOffset + 6) !== 0
  ) {
    throw invalidArchive("ZIP");
  }
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    endOffset + 22 + commentLength !== archive.byteLength ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) {
    throw invalidArchive("ZIP");
  }

  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assertReadable(archive, offset, 46);
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw invalidArchive("ZIP");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const entryCommentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const recordLength =
      46 + nameLength + extraLength + entryCommentLength;
    assertReadable(archive, offset, recordLength);
    if (
      diskStart !== 0 ||
      (flags & 0x1) !== 0 ||
      ![0, 8].includes(compression)
    ) {
      throw invalidArchive("ZIP");
    }
    entries.push({
      path: decodeName(archive.subarray(offset + 46, offset + 46 + nameLength)),
      compression,
      flags,
      crc: archive.readUInt32LE(offset + 16),
      compressedSize: archive.readUInt32LE(offset + 20),
      uncompressedSize: archive.readUInt32LE(offset + 24),
      localHeaderOffset: archive.readUInt32LE(offset + 42),
    });
    offset += recordLength;
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw invalidArchive("ZIP");
  }
  return { entries, centralDirectoryOffset };
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(
    0,
    archive.byteLength - MAX_END_RECORD_SEARCH,
  );
  for (
    let offset = archive.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (
      archive.readUInt32LE(offset) ===
      END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return offset;
    }
  }
  throw invalidArchive("ZIP");
}

function validateEntryRanges(
  archive: Buffer,
  entries: readonly ZipEntry[],
  centralDirectoryOffset: number,
): void {
  const ranges = entries
    .map((entry) => {
      const compressed = readCompressedEntry(
        archive,
        entry,
        centralDirectoryOffset,
      );
      return {
        start: entry.localHeaderOffset,
        end: compressed.byteOffset - archive.byteOffset + compressed.byteLength,
      };
    })
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (!previous || !current || current.start < previous.end) {
      throw invalidArchive("ZIP");
    }
  }
}

function readCompressedEntry(
  archive: Buffer,
  entry: ZipEntry,
  centralDirectoryOffset: number,
): Buffer {
  const offset = entry.localHeaderOffset;
  assertReadable(archive, offset, 30);
  if (
    offset >= centralDirectoryOffset ||
    archive.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE ||
    archive.readUInt16LE(offset + 6) !== entry.flags ||
    archive.readUInt16LE(offset + 8) !== entry.compression
  ) {
    throw invalidArchive("ZIP");
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  assertReadable(archive, offset, dataEnd - offset);
  if (
    dataEnd > centralDirectoryOffset ||
    assertSafeSourcePath(
      decodeName(
        archive.subarray(offset + 30, offset + 30 + nameLength),
      ),
    ) !==
      entry.path
  ) {
    throw invalidArchive("ZIP");
  }
  return archive.subarray(dataStart, dataEnd);
}

async function decompressEntry(
  entry: ZipEntry,
  compressed: Buffer,
  countBytes: (byteCount: number) => void,
): Promise<Uint8Array> {
  if (entry.compression === 0) {
    countBytes(compressed.byteLength);
    return Uint8Array.from(compressed);
  }

  const inflater = createInflateRaw();
  const input = Readable.from([compressed]);
  input.pipe(inflater);
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of inflater) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      countBytes(bytes.byteLength);
      chunks.push(bytes);
    }
  } catch (error) {
    input.destroy();
    inflater.destroy();
    throw error;
  }
  return Buffer.concat(chunks);
}

function decodeName(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

function assertReadable(
  archive: Buffer,
  offset: number,
  length: number,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > archive.byteLength
  ) {
    throw invalidArchive("ZIP");
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) !== 0
          ? 0xedb88320 ^ (value >>> 1)
          : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function invalidArchive(description: string): WorkspaceSourceError {
  return new WorkspaceSourceError(
    "invalid_archive",
    `${description} is not a readable ZIP archive.`,
  );
}
