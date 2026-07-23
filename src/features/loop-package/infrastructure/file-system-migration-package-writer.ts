import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  MigrationPackageWriter,
  WriteMigrationPackageRequest,
} from "../application/migration-package-writer.js";
import {
  MigrationPackageManifestSchema,
  type MigrationPackageManifest,
  type RenderedMigrationItem,
} from "../domain/migration-package.js";
import { renderDashboard } from "./dashboard-renderer.js";
import { escapeHtml } from "./html-utils.js";

export class FileSystemMigrationPackageWriter
  implements MigrationPackageWriter
{
  public async write(
    request: WriteMigrationPackageRequest,
  ): Promise<MigrationPackageManifest> {
    const outputDirectory = path.resolve(request.outputDirectory);
    const pagesDirectory = path.join(outputDirectory, "pages");
    await rm(pagesDirectory, { force: true, recursive: true });
    await mkdir(pagesDirectory, { recursive: true });

    const files: string[] = [];
    await writeJson(
      outputDirectory,
      "canonical-graph.json",
      request.graph,
      files,
    );
    await writeJson(
      outputDirectory,
      "migration-plan.json",
      request.plan,
      files,
    );
    await writeJson(
      outputDirectory,
      "agent-tasks.json",
      request.plan.agentTasks,
      files,
    );

    for (const item of request.renderedItems) {
      const fileName = `${stableFileId(item.sourceId)}.html`;
      const relativePath = path.posix.join("pages", fileName);
      await writeFile(
        path.join(pagesDirectory, fileName),
        renderStandaloneItem(item),
        "utf-8",
      );
      files.push(relativePath);
    }

    const dashboardPath = "index.html";
    await writeFile(
      path.join(outputDirectory, dashboardPath),
      renderDashboard(request.graph, request.plan, request.renderedItems),
      "utf-8",
    );
    files.push(dashboardPath);

    const manifest = MigrationPackageManifestSchema.parse({
      schemaVersion: "1.0",
      workspaceId: request.graph.workspaceId,
      workspaceTitle: request.graph.title,
      generatedAt: request.generatedAt.toISOString(),
      outputDirectory,
      dashboardPath,
      files: [...files, "manifest.json"].sort(),
      renderedItems: request.renderedItems.length,
    });

    await writeFile(
      path.join(outputDirectory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    return manifest;
  }
}

async function writeJson(
  outputDirectory: string,
  relativePath: string,
  value: unknown,
  files: string[],
): Promise<void> {
  await writeFile(
    path.join(outputDirectory, relativePath),
    JSON.stringify(value, null, 2),
    "utf-8",
  );
  files.push(relativePath);
}

function stableFileId(sourceId: string): string {
  return createHash("sha256").update(sourceId).digest("hex");
}

function renderStandaloneItem(item: RenderedMigrationItem): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(item.title)}</title>
  <style>
    body { margin: 0; padding: 40px; color: #172033; background: #f8fafc; font: 16px/1.6 "Segoe UI", sans-serif; }
    article { max-width: 900px; margin: auto; }
    h1 { font-size: 40px; line-height: 1.1; }
    img { max-width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border: 1px solid #cbd5e1; text-align: left; }
    pre { overflow: auto; padding: 16px; border-radius: 12px; background: #e2e8f0; }
    aside, blockquote { padding: 14px 18px; border-left: 4px solid #8b5cf6; background: #ede9fe; }
  </style>
</head>
<body>${item.html}</body>
</html>`;
}
