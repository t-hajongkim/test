import path from "node:path";

export function normalizeSourcePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function assertSafeSourcePath(value: string): string {
  const normalized = normalizeSourcePath(value);
  const segments = normalized.split("/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.includes("..")
  ) {
    throw new Error(`Unsafe source path: ${value}`);
  }

  return path.posix.normalize(normalized);
}
