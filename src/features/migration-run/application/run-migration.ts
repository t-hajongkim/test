import { AnalyzeWorkspace } from "../../compatibility-analysis/application/analyze-workspace.js";
import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import { DeterministicCompatibilityPolicy } from "../../compatibility-analysis/infrastructure/deterministic-compatibility-policy.js";
import { GenerateLoopPackage } from "../../loop-package/application/generate-loop-package.js";
import type { MigrationPackageManifest } from "../../loop-package/domain/migration-package.js";
import { FileSystemMigrationPackageWriter } from "../../loop-package/infrastructure/file-system-migration-package-writer.js";
import { LoopHtmlRenderer } from "../../loop-package/infrastructure/loop-html-renderer.js";
import { IngestWorkspace } from "../../workspace-ingestion/application/ingest-workspace.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";
import { createWorkspaceSource } from "../../workspace-ingestion/infrastructure/create-workspace-source.js";
import { NotionExportParser } from "../../workspace-ingestion/infrastructure/notion-export-parser.js";

export interface RunMigrationRequest {
  readonly inputPath: string;
  readonly outputDirectory: string;
  readonly now?: Date;
}

export interface RunMigrationResult {
  readonly graph: CanonicalWorkspaceGraph;
  readonly plan: MigrationPlan;
  readonly manifest: MigrationPackageManifest;
}

export class RunMigration {
  public async execute(
    request: RunMigrationRequest,
  ): Promise<RunMigrationResult> {
    const generatedAt = request.now ?? new Date();
    const source = await createWorkspaceSource(request.inputPath);
    const graph = await new IngestWorkspace(
      new NotionExportParser(),
    ).execute(source, generatedAt);
    const plan = new AnalyzeWorkspace(
      new DeterministicCompatibilityPolicy(),
    ).execute(graph, generatedAt);
    const manifest = await new GenerateLoopPackage(
      new LoopHtmlRenderer(),
      new FileSystemMigrationPackageWriter(),
    ).execute({
      graph,
      plan,
      outputDirectory: request.outputDirectory,
      generatedAt,
    });

    return {
      graph,
      plan,
      manifest,
    };
  }
}
