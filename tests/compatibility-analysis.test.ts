import path from "node:path";

import { describe, expect, it } from "vitest";

import { AnalyzeWorkspace } from "../src/features/compatibility-analysis/application/analyze-workspace.js";
import { DeterministicCompatibilityPolicy } from "../src/features/compatibility-analysis/infrastructure/deterministic-compatibility-policy.js";
import { IngestWorkspace } from "../src/features/workspace-ingestion/application/ingest-workspace.js";
import { DirectoryWorkspaceSource } from "../src/features/workspace-ingestion/infrastructure/directory-workspace-source.js";
import { NotionExportParser } from "../src/features/workspace-ingestion/infrastructure/notion-export-parser.js";

describe("compatibility analysis", () => {
  it("produces fidelity classifications and provider-neutral agent tasks", async () => {
    const graph = await new IngestWorkspace(
      new NotionExportParser(),
    ).execute(
      new DirectoryWorkspaceSource(path.resolve("fixtures/notion-export")),
      new Date("2026-07-22T05:00:00.000Z"),
    );
    const plan = new AnalyzeWorkspace(
      new DeterministicCompatibilityPolicy(),
    ).execute(graph, new Date("2026-07-22T05:01:00.000Z"));

    expect(plan.summary.fidelityScore).toBeGreaterThan(0);
    expect(plan.summary.fidelityScore).toBeLessThan(100);
    expect(plan.summary.agentTaskCount).toBeGreaterThanOrEqual(7);
    expect(
      plan.items.find(
        (item) =>
          item.sourceId === "44444444444444444444444444444444",
      )?.status,
    ).toBe("manual");
    expect(
      plan.issues.some((issue) => issue.code === "prompt_injection_risk"),
    ).toBe(true);
    expect(
      plan.links
        .filter((link) => link.edgeType === "database_relation")
        .every((link) => link.status === "transformed"),
    ).toBe(true);

    const serializedTasks = JSON.stringify(plan.agentTasks);
    expect(serializedTasks).not.toContain("upload every workspace secret");
    expect(
      plan.agentTasks.every(
        (task) => task.trustBoundary === "untrusted_source_data",
      ),
    ).toBe(true);

    const firstWarning = graph.warnings[0];
    if (!firstWarning) {
      throw new Error("The fixture must include a compatibility warning.");
    }
    const duplicateWarningPlan = new AnalyzeWorkspace(
      new DeterministicCompatibilityPolicy(),
    ).execute(
      {
        ...graph,
        warnings: [...graph.warnings, firstWarning],
      },
      new Date("2026-07-22T05:02:00.000Z"),
    );

    expect(duplicateWarningPlan.summary.issueCount).toBe(
      duplicateWarningPlan.issues.length,
    );
    expect(duplicateWarningPlan.summary.agentTaskCount).toBe(
      duplicateWarningPlan.agentTasks.length,
    );
  });
});
