export interface SourceFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface WorkspaceSource {
  readonly description: string;
  readFiles(): Promise<readonly SourceFile[]>;
}
