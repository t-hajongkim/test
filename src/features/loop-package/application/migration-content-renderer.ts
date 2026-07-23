import type { MigrationItemPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type {
  CanonicalNode,
  CanonicalWorkspaceGraph,
} from "../../workspace-ingestion/domain/canonical-graph.js";
import type { RenderedMigrationItem } from "../domain/migration-package.js";

export interface MigrationContentRenderer {
  render(
    node: CanonicalNode,
    itemPlan: MigrationItemPlan,
    graph: CanonicalWorkspaceGraph,
  ): Promise<RenderedMigrationItem>;
}
