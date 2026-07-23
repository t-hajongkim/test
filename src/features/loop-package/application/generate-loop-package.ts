import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";
import type { MigrationPackageManifest } from "../domain/migration-package.js";
import type { MigrationContentRenderer } from "./migration-content-renderer.js";
import type { MigrationPackageWriter } from "./migration-package-writer.js";

export interface GenerateLoopPackageRequest {
  readonly graph: CanonicalWorkspaceGraph;
  readonly plan: MigrationPlan;
  readonly outputDirectory: string;
  readonly generatedAt?: Date;
}

export class GenerateLoopPackage {
  public constructor(
    private readonly renderer: MigrationContentRenderer,
    private readonly writer: MigrationPackageWriter,
  ) {}

  public async execute(
    request: GenerateLoopPackageRequest,
  ): Promise<MigrationPackageManifest> {
    const itemPlansBySourceId = new Map(
      request.plan.items.map((item) => [item.sourceId, item]),
    );
    const renderedItems = await Promise.all(
      request.graph.nodes.map((node) => {
        const itemPlan = itemPlansBySourceId.get(node.id);
        if (!itemPlan) {
          throw new Error(`No migration item plan exists for ${node.id}.`);
        }

        return this.renderer.render(node, itemPlan, request.graph);
      }),
    );

    return this.writer.write({
      outputDirectory: request.outputDirectory,
      generatedAt: request.generatedAt ?? new Date(),
      graph: request.graph,
      plan: request.plan,
      renderedItems,
    });
  }
}
