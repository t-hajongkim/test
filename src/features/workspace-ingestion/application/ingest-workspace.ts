import type { CanonicalWorkspaceGraph } from "../domain/canonical-graph.js";
import type { WorkspaceParser } from "./workspace-parser.js";
import type { WorkspaceSource } from "./workspace-source.js";
import { WorkspaceSourceError } from "./workspace-source-error.js";

export class IngestWorkspace {
  public constructor(private readonly parser: WorkspaceParser) {}

  public async execute(
    source: WorkspaceSource,
    generatedAt = new Date(),
  ): Promise<CanonicalWorkspaceGraph> {
    const files = await source.readFiles();

    if (files.length === 0) {
      throw new WorkspaceSourceError(
        "empty_source",
        `No files were found in ${source.description}.`,
      );
    }

    return this.parser.parse({
      sourceDescription: source.description,
      files,
      generatedAt,
    });
  }
}
