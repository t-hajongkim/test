export interface PublicArtifactAuditor {
  assertSafe(directory: string): Promise<void>;
}
