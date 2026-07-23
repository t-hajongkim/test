import type { CanonicalWorkspaceGraph } from "../domain/canonical-graph.js";
import type { WorkspaceParser } from "./workspace-parser.js";
import type {
  SourceFile,
  WorkspaceSource,
} from "./workspace-source.js";
import { WorkspaceSourceError } from "./workspace-source-error.js";

export class IngestWorkspace {
  public constructor(private readonly parser: WorkspaceParser) {}

  public async execute(
    source: WorkspaceSource,
    generatedAt = new Date(),
  ): Promise<CanonicalWorkspaceGraph> {
    return this.parser.parse({
      sourceDescription: source.description,
      files: requireSourceFiles(source),
      generatedAt,
    });
  }
}

async function* requireSourceFiles(
  source: WorkspaceSource,
): AsyncIterable<SourceFile> {
  let fileCount = 0;
  for await (const file of source.readFiles()) {
    fileCount += 1;
    yield file;
  }
  if (fileCount === 0) {
    throw new WorkspaceSourceError(
      "empty_source",
      `No files were found in ${source.description}.`,
    );
  }
}
