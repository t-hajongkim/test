import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { IngestWorkspace } from "../src/features/workspace-ingestion/application/ingest-workspace.js";
import { DirectoryWorkspaceSource } from "../src/features/workspace-ingestion/infrastructure/directory-workspace-source.js";
import { NotionExportParser } from "../src/features/workspace-ingestion/infrastructure/notion-export-parser.js";
import { ZipWorkspaceSource } from "../src/features/workspace-ingestion/infrastructure/zip-workspace-source.js";

const fixtureDirectory = path.resolve("fixtures/notion-export");
const temporaryDirectories: string[] = [];
const generatedAt = new Date("2026-07-22T05:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Notion workspace ingestion", () => {
  it("builds a typed graph from a directory export", async () => {
    const graph = await ingest(new DirectoryWorkspaceSource(fixtureDirectory));

    expect(graph.title).toBe("Notion2Loop Demo");
    expect(graph.nodes.filter((node) => node.kind === "database")).toHaveLength(
      2,
    );
    expect(
      graph.nodes.filter((node) => node.kind === "database_row"),
    ).toHaveLength(5);
    expect(
      graph.edges.filter((edge) => edge.type === "database_relation"),
    ).toHaveLength(6);
    expect(
      graph.edges.some((edge) => edge.type === "attachment"),
    ).toBe(true);
    expect(
      graph.warnings.filter((warning) => warning.code === "unsupported_block"),
    ).toHaveLength(2);
  });

  it("produces the same graph content from a ZIP export", async () => {
    const directorySource = new DirectoryWorkspaceSource(fixtureDirectory);
    const sourceFiles = await directorySource.readFiles();
    const archiveContent: Record<string, Uint8Array> = {};

    for (const file of sourceFiles) {
      archiveContent[file.path] = file.content;
    }

    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "notion2loop-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const archivePath = path.join(temporaryDirectory, "workspace.zip");
    await writeFile(archivePath, zipSync(archiveContent));

    const directoryGraph = await ingest(directorySource);
    const zipGraph = await ingest(new ZipWorkspaceSource(archivePath));

    expect(zipGraph.nodes).toEqual(directoryGraph.nodes);
    expect(zipGraph.edges).toEqual(directoryGraph.edges);
    expect(zipGraph.warnings).toEqual(directoryGraph.warnings);
  });

  it("rejects unsafe ZIP entry paths", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "notion2loop-unsafe-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const archivePath = path.join(temporaryDirectory, "unsafe.zip");
    await writeFile(
      archivePath,
      zipSync({
        "../escape.md": new TextEncoder().encode("# unsafe"),
      }),
    );

    await expect(
      new ZipWorkspaceSource(archivePath).readFiles(),
    ).rejects.toThrow("Unsafe source path");
  });

  it("rejects ZIPs that exceed configured source limits", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), "notion2loop-limits-"),
    );
    temporaryDirectories.push(temporaryDirectory);
    const archivePath = path.join(temporaryDirectory, "oversized.zip");
    await writeFile(
      archivePath,
      zipSync({
        "large.md": new TextEncoder().encode("12345"),
      }),
    );

    await expect(
      new ZipWorkspaceSource(archivePath, {
        maxFileCount: 10,
        maxTotalBytes: 4,
        maxArchiveBytes: 1024 * 1024,
      }).readFiles(),
    ).rejects.toThrow("exceeds 4 uncompressed bytes");
  });
});

async function ingest(
  source: DirectoryWorkspaceSource | ZipWorkspaceSource,
) {
  return new IngestWorkspace(new NotionExportParser()).execute(
    source,
    generatedAt,
  );
}
