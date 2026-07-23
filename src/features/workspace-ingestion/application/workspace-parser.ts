import type { CanonicalWorkspaceGraph } from "../domain/canonical-graph.js";
import type { SourceFile } from "./workspace-source.js";

export interface ParseWorkspaceRequest {
  readonly sourceDescription: string;
  readonly files: AsyncIterable<SourceFile>;
  readonly generatedAt: Date;
}

export interface WorkspaceParser {
  parse(request: ParseWorkspaceRequest): Promise<CanonicalWorkspaceGraph>;
}
