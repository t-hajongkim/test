import { createReadStream } from "node:fs";
import {
  open,
  type FileHandle,
} from "node:fs/promises";

import { UnzipInflate } from "fflate";

import type { SourceFile } from "../application/workspace-source.js";
import { WorkspaceSourceError } from "../application/workspace-source-error.js";
import {
  assertArchiveByteCount,
  assertSourceByteCount,
  assertSourceEntryByteCount,
  assertSourceFileCount,
  type SourceReadLimits,
} from "./source-limits.js";
import { assertSafeSourcePath } from "./source-path.js";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_END_RECORD_SEARCH = 65_557;
const ARCHIVE_READ_CHUNK_BYTES = 64 * 1024;
const UNZIP_FEED_CHUNK_BYTES = 16 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const CRC_TABLE = createCrcTable();

interface ZipEntryMetadata {
  readonly path: string;
  readonly directory: boolean;
  readonly compression: number;
  readonly flags: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

interface ZipEntryManifest extends ZipEntryMetadata {
  readonly dataStart: number;
  readonly dataEnd: number;
  readonly entryEnd: number;
}

interface ZipManifest {
  readonly archiveSize: number;
  readonly entries: readonly ZipEntryManifest[];
  readonly entriesByPath: ReadonlyMap<string, ZipEntryManifest>;
}

interface EntryRange {
  readonly start: number;
  readonly end: number;
}

interface StreamingEntry {
  readonly entry: ZipEntryManifest;
  readonly content: Buffer;
  readonly decoder?: UnzipInflate;
  byteCount: number;
  crc: number;
}

export async function* readValidatedZipEntries(
  archivePath: string,
  limits: SourceReadLimits,
  description: string,
  signal?: AbortSignal,
): AsyncIterable<SourceFile> {
  try {
    const manifest = await readZipManifest(
      archivePath,
      limits,
      description,
    );
    yield* streamValidatedEntries(
      archivePath,
      manifest,
      limits,
      description,
      signal,
    );
  } catch (error) {
    if (error instanceof WorkspaceSourceError) {
      throw error;
    }
    throw invalidArchive(description);
  }
}

async function readZipManifest(
  archivePath: string,
  limits: SourceReadLimits,
  description: string,
): Promise<ZipManifest> {
  const handle = await open(archivePath, "r");
  try {
    const archiveSize = (await handle.stat()).size;
    assertArchiveByteCount(archiveSize, limits, description);
    const endRecord = await readEndRecord(handle, archiveSize);
    const {
      entryCount,
      centralDirectoryOffset,
      centralDirectorySize,
    } = endRecord;
    const entries: ZipEntryManifest[] = [];
    const entriesByPath = new Map<string, ZipEntryManifest>();
    const ranges: EntryRange[] = [];
    let offset = centralDirectoryOffset;
    let declaredTotalBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
      const header = await readExactly(handle, offset, 46, archiveSize);
      if (header.readUInt32LE(0) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw invalidArchive(description);
      }
      const flags = header.readUInt16LE(8);
      const compression = header.readUInt16LE(10);
      const crc = header.readUInt32LE(16);
      const compressedSize = header.readUInt32LE(20);
      const uncompressedSize = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const diskStart = header.readUInt16LE(34);
      const localHeaderOffset = header.readUInt32LE(42);
      const recordLength =
        46 + nameLength + extraLength + commentLength;

      assertReadableRange(
        offset,
        recordLength,
        centralDirectoryOffset + centralDirectorySize,
      );
      if (
        diskStart !== 0 ||
        (flags & 0x1) !== 0 ||
        ![0, 8].includes(compression) ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff
      ) {
        throw invalidArchive(description);
      }

      const name = await readExactly(
        handle,
        offset + 46,
        nameLength,
        archiveSize,
      );
      const safePath = assertSafeSourcePath(decodeName(name));
      if (entriesByPath.has(safePath)) {
        throw new WorkspaceSourceError(
          "duplicate_path",
          `Duplicate ZIP source path: ${safePath}`,
        );
      }

      const entryMetadata: ZipEntryMetadata = {
        path: safePath,
        directory: safePath.endsWith("/"),
        compression,
        flags,
        crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
      const localEntry = await validateLocalEntry(
        handle,
        entryMetadata,
        centralDirectoryOffset,
        archiveSize,
        description,
      );
      const entry: ZipEntryManifest = {
        ...entryMetadata,
        ...localEntry,
      };
      entries.push(entry);
      entriesByPath.set(safePath, entry);
      assertSourceFileCount(entries.length, limits, description);
      assertSourceEntryByteCount(
        uncompressedSize,
        limits,
        description,
      );
      declaredTotalBytes += uncompressedSize;
      assertSourceByteCount(declaredTotalBytes, limits, description);
      ranges.push({
        start: entry.localHeaderOffset,
        end: entry.entryEnd,
      });
      offset += recordLength;
    }

    if (offset !== centralDirectoryOffset + centralDirectorySize) {
      throw invalidArchive(description);
    }
    validateEntryRanges(
      ranges,
      centralDirectoryOffset,
      description,
    );
    return { archiveSize, entries, entriesByPath };
  } finally {
    await handle.close();
  }
}

async function readEndRecord(
  handle: FileHandle,
  archiveSize: number,
): Promise<{
  readonly entryCount: number;
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
}> {
  const tailLength = Math.min(archiveSize, MAX_END_RECORD_SEARCH);
  const tailOffset = archiveSize - tailLength;
  const tail = await readExactly(
    handle,
    tailOffset,
    tailLength,
    archiveSize,
  );
  let relativeOffset = tail.byteLength - 22;
  while (
    relativeOffset >= 0 &&
    tail.readUInt32LE(relativeOffset) !==
      END_OF_CENTRAL_DIRECTORY_SIGNATURE
  ) {
    relativeOffset -= 1;
  }
  if (relativeOffset < 0) {
    throw invalidArchive("ZIP");
  }

  const endOffset = tailOffset + relativeOffset;
  const diskNumber = tail.readUInt16LE(relativeOffset + 4);
  const centralDirectoryDisk = tail.readUInt16LE(relativeOffset + 6);
  const diskEntryCount = tail.readUInt16LE(relativeOffset + 8);
  const entryCount = tail.readUInt16LE(relativeOffset + 10);
  const centralDirectorySize = tail.readUInt32LE(relativeOffset + 12);
  const centralDirectoryOffset = tail.readUInt32LE(relativeOffset + 16);
  const commentLength = tail.readUInt16LE(relativeOffset + 20);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    endOffset + 22 + commentLength !== archiveSize ||
    centralDirectoryOffset + centralDirectorySize !== endOffset
  ) {
    throw invalidArchive("ZIP");
  }
  return {
    entryCount,
    centralDirectoryOffset,
    centralDirectorySize,
  };
}

async function validateLocalEntry(
  handle: FileHandle,
  entry: ZipEntryMetadata,
  centralDirectoryOffset: number,
  archiveSize: number,
  description: string,
): Promise<{
  readonly dataStart: number;
  readonly dataEnd: number;
  readonly entryEnd: number;
}> {
  const header = await readExactly(
    handle,
    entry.localHeaderOffset,
    30,
    archiveSize,
  );
  if (
    entry.localHeaderOffset >= centralDirectoryOffset ||
    header.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE ||
    header.readUInt16LE(6) !== entry.flags ||
    header.readUInt16LE(8) !== entry.compression
  ) {
    throw invalidArchive(description);
  }

  const dataDescriptor = (entry.flags & 0x8) !== 0;
  if (
    !dataDescriptor &&
    (header.readUInt32LE(14) !== entry.crc ||
      header.readUInt32LE(18) !== entry.compressedSize ||
      header.readUInt32LE(22) !== entry.uncompressedSize)
  ) {
    throw invalidArchive(description);
  }

  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const name = await readExactly(
    handle,
    entry.localHeaderOffset + 30,
    nameLength,
    archiveSize,
  );
  if (assertSafeSourcePath(decodeName(name)) !== entry.path) {
    throw invalidArchive(description);
  }

  const dataStart =
    entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  assertReadableRange(
    entry.localHeaderOffset,
    dataEnd - entry.localHeaderOffset,
    centralDirectoryOffset,
  );
  let entryEnd = dataEnd;
  if (dataDescriptor) {
    const prefix = await readExactly(
      handle,
      dataEnd,
      4,
      centralDirectoryOffset,
    );
    const hasSignature =
      prefix.readUInt32LE(0) === DATA_DESCRIPTOR_SIGNATURE;
    const descriptor = await readExactly(
      handle,
      dataEnd,
      hasSignature ? 16 : 12,
      centralDirectoryOffset,
    );
    const fieldOffset = hasSignature ? 4 : 0;
    if (
      descriptor.readUInt32LE(fieldOffset) !== entry.crc ||
      descriptor.readUInt32LE(fieldOffset + 4) !==
        entry.compressedSize ||
      descriptor.readUInt32LE(fieldOffset + 8) !==
        entry.uncompressedSize
    ) {
      throw invalidArchive(description);
    }
    entryEnd += descriptor.byteLength;
  }
  return { dataStart, dataEnd, entryEnd };
}

function validateEntryRanges(
  ranges: readonly EntryRange[],
  centralDirectoryOffset: number,
  description: string,
): void {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start,
  );
  if (sorted.length === 0) {
    if (centralDirectoryOffset !== 0) {
      throw invalidArchive(description);
    }
    return;
  }
  if (
    sorted[0]?.start !== 0 ||
    sorted.at(-1)?.end !== centralDirectoryOffset
  ) {
    throw invalidArchive(description);
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current || current.start !== previous.end) {
      throw invalidArchive(description);
    }
  }
}

async function* streamValidatedEntries(
  archivePath: string,
  manifest: ZipManifest,
  limits: SourceReadLimits,
  description: string,
  signal?: AbortSignal,
): AsyncIterable<SourceFile> {
  const pendingFiles: SourceFile[] = [];
  const orderedEntries = [...manifest.entries].sort(
    (left, right) => left.dataStart - right.dataStart,
  );
  let entryIndex = 0;
  let currentEntry: StreamingEntry | undefined;
  let actualTotalBytes = 0;
  let callbackError: unknown;

  const rememberError = (error: unknown): void => {
    callbackError ??= error;
  };
  const receiveOutput = (
    state: StreamingEntry,
    error: Error | null,
    data: Uint8Array | null,
    final: boolean,
  ): void => {
    if (callbackError) {
      return;
    }
    if (error || !data) {
      rememberError(error ?? invalidArchive(description));
      return;
    }
    try {
      const nextEntryByteCount = state.byteCount + data.byteLength;
      const nextTotalBytes = actualTotalBytes + data.byteLength;
      assertSourceEntryByteCount(
        nextEntryByteCount,
        limits,
        description,
      );
      assertSourceByteCount(nextTotalBytes, limits, description);
      if (nextEntryByteCount > state.content.byteLength) {
        throw invalidArchive(description);
      }
      state.content.set(data, state.byteCount);
      state.byteCount = nextEntryByteCount;
      actualTotalBytes = nextTotalBytes;
      state.crc = updateCrc(state.crc, data);

      if (final) {
        if (
          state.byteCount !== state.entry.uncompressedSize ||
          finalizeCrc(state.crc) !== state.entry.crc
        ) {
          throw invalidArchive(description);
        }
        if (!state.entry.directory) {
          pendingFiles.push({
            path: state.entry.path,
            content: state.content,
          });
        }
        currentEntry = undefined;
        entryIndex += 1;
      }
    } catch (entryError) {
      rememberError(entryError);
    }
  };

  const startEntry = (entry: ZipEntryManifest): StreamingEntry => {
    const state: StreamingEntry = {
      entry,
      content: Buffer.allocUnsafe(entry.uncompressedSize),
      byteCount: 0,
      crc: 0xffffffff,
      ...(entry.compression === 8
        ? { decoder: new UnzipInflate() }
        : {}),
    };
    if (state.decoder) {
      state.decoder.ondata = (error, data, final) => {
        receiveOutput(state, error, data, final);
      };
    }
    currentEntry = state;
    if (entry.compressedSize === 0) {
      if (entry.compression !== 0) {
        rememberError(invalidArchive(description));
      } else {
        receiveOutput(state, null, new Uint8Array(), true);
      }
    }
    return state;
  };

  const processArchiveBytes = (
    bytes: Uint8Array,
    absoluteStart: number,
  ): void => {
    let cursor = 0;
    while (cursor < bytes.byteLength && !callbackError) {
      const entry = orderedEntries[entryIndex];
      if (!entry) {
        return;
      }
      const absoluteOffset = absoluteStart + cursor;
      if (absoluteOffset < entry.dataStart) {
        cursor += Math.min(
          bytes.byteLength - cursor,
          entry.dataStart - absoluteOffset,
        );
        continue;
      }
      if (entry.compressedSize === 0 && !currentEntry) {
        startEntry(entry);
        continue;
      }
      if (absoluteOffset >= entry.dataEnd) {
        rememberError(invalidArchive(description));
        return;
      }

      const state = currentEntry ?? startEntry(entry);
      const dataEnd = Math.min(
        absoluteStart + bytes.byteLength,
        entry.dataEnd,
      );
      const chunkEnd = cursor + (dataEnd - absoluteOffset);
      const compressed = bytes.subarray(cursor, chunkEnd);
      const final = dataEnd === entry.dataEnd;
      if (entry.compression === 0) {
        receiveOutput(state, null, compressed, final);
      } else if (state.decoder) {
        state.decoder.push(compressed, final);
      } else {
        rememberError(invalidArchive(description));
      }
      cursor = chunkEnd;
    }
  };

  const archiveStream = createReadStream(archivePath, {
    highWaterMark: ARCHIVE_READ_CHUNK_BYTES,
    ...(signal ? { signal } : {}),
  });
  let compressedByteCount = 0;
  try {
    for await (const chunk of archiveStream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      compressedByteCount += bytes.byteLength;
      assertArchiveByteCount(
        compressedByteCount,
        limits,
        description,
      );

      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += UNZIP_FEED_CHUNK_BYTES
      ) {
        const chunkEnd = Math.min(
          offset + UNZIP_FEED_CHUNK_BYTES,
          bytes.byteLength,
        );
        processArchiveBytes(
          bytes.subarray(offset, chunkEnd),
          compressedByteCount - bytes.byteLength + offset,
        );
        throwCallbackError(callbackError, description);
        while (pendingFiles.length > 0) {
          yield pendingFiles.shift()!;
        }
      }
    }
    throwCallbackError(callbackError, description);
    while (pendingFiles.length > 0) {
      yield pendingFiles.shift()!;
    }
    if (
      compressedByteCount !== manifest.archiveSize ||
      currentEntry !== undefined ||
      entryIndex !== orderedEntries.length
    ) {
      throw invalidArchive(description);
    }
  } finally {
    archiveStream.destroy();
  }
}

function throwCallbackError(
  error: unknown,
  description: string,
): void {
  if (!error) {
    return;
  }
  if (error instanceof WorkspaceSourceError) {
    throw error;
  }
  throw invalidArchive(description);
}

async function readExactly(
  handle: FileHandle,
  position: number,
  length: number,
  archiveSize: number,
): Promise<Buffer> {
  assertReadableRange(position, length, archiveSize);
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(
      bytes,
      offset,
      length - offset,
      position + offset,
    );
    if (result.bytesRead === 0) {
      throw invalidArchive("ZIP");
    }
    offset += result.bytesRead;
  }
  return bytes;
}

function assertReadableRange(
  offset: number,
  length: number,
  limit: number,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(limit) ||
    offset < 0 ||
    length < 0 ||
    offset + length > limit
  ) {
    throw invalidArchive("ZIP");
  }
}

function decodeName(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

function updateCrc(crc: number, bytes: Uint8Array): number {
  let updated = crc;
  for (const byte of bytes) {
    updated = CRC_TABLE[(updated ^ byte) & 0xff]! ^ (updated >>> 8);
  }
  return updated;
}

function finalizeCrc(crc: number): number {
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
