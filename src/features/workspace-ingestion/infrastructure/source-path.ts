import path from "node:path";

import { WorkspaceSourceError } from "../application/workspace-source-error.js";

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
    throw new WorkspaceSourceError(
      "unsafe_path",
      `Unsafe source path: ${value}`,
    );
  }

  return path.posix.normalize(normalized);
}
