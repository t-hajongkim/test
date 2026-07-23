import { stat } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSource } from "../application/workspace-source.js";
import { DirectoryWorkspaceSource } from "./directory-workspace-source.js";
import { ZipWorkspaceSource } from "./zip-workspace-source.js";

export async function createWorkspaceSource(
  inputPath: string,
): Promise<WorkspaceSource> {
  const inputStat = await stat(inputPath);

  if (inputStat.isDirectory()) {
    return new DirectoryWorkspaceSource(inputPath);
  }

  if (
    inputStat.isFile() &&
    path.extname(inputPath).toLowerCase() === ".zip"
  ) {
    return new ZipWorkspaceSource(inputPath);
  }

  throw new Error(
    `Input must be a Notion export directory or ZIP file: ${inputPath}`,
  );
}
