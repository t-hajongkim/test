export interface SourceReadLimits {
  readonly maxFileCount: number;
  readonly maxTotalBytes: number;
  readonly maxArchiveBytes: number;
}

export const DEFAULT_SOURCE_READ_LIMITS: SourceReadLimits = {
  maxFileCount: 10_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxArchiveBytes: 200 * 1024 * 1024,
};

export function assertSourceFileCount(
  fileCount: number,
  limits: SourceReadLimits,
  description: string,
): void {
  if (fileCount > limits.maxFileCount) {
    throw new Error(
      `${description} contains more than ${limits.maxFileCount} files.`,
    );
  }
}

export function assertSourceByteCount(
  byteCount: number,
  limits: SourceReadLimits,
  description: string,
): void {
  if (byteCount > limits.maxTotalBytes) {
    throw new Error(
      `${description} exceeds ${limits.maxTotalBytes} uncompressed bytes.`,
    );
  }
}

export function assertArchiveByteCount(
  byteCount: number,
  limits: SourceReadLimits,
  description: string,
): void {
  if (byteCount > limits.maxArchiveBytes) {
    throw new Error(
      `${description} exceeds ${limits.maxArchiveBytes} compressed bytes.`,
    );
  }
}
