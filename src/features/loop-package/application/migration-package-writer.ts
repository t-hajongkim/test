import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";
import type {
  MigrationPackageManifest,
  RenderedMigrationItem,
} from "../domain/migration-package.js";

export interface WriteMigrationPackageRequest {
  readonly outputDirectory: string;
  readonly generatedAt: Date;
  readonly graph: CanonicalWorkspaceGraph;
  readonly plan: MigrationPlan;
  readonly renderedItems: readonly RenderedMigrationItem[];
}

export interface MigrationPackageWriter {
  write(
    request: WriteMigrationPackageRequest,
  ): Promise<MigrationPackageManifest>;
}
