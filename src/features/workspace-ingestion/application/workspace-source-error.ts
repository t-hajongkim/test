export type WorkspaceSourceErrorCode =
  | "archive_size_mismatch"
  | "archive_too_large"
  | "duplicate_path"
  | "empty_source"
  | "file_count_limit"
  | "invalid_archive"
  | "invalid_source_data"
  | "unsafe_path"
  | "uncompressed_size_limit";

export class WorkspaceSourceError extends Error {
  public constructor(
    public readonly code: WorkspaceSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceSourceError";
  }
}
