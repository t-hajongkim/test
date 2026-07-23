import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunMigration } from "../src/features/migration-run/application/run-migration.js";
import { startDashboardServer } from "../src/features/loop-package/infrastructure/static-dashboard-server.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Loop migration package", () => {
  it("generates a visual dashboard and structured migration artifacts", async () => {
    const outputDirectory = await createTemporaryDirectory();
    const result = await new RunMigration().execute({
      inputPath: path.resolve("fixtures/notion-export"),
      outputDirectory,
      now: new Date("2026-07-22T05:10:00.000Z"),
    });

    const dashboard = await readFile(
      path.join(outputDirectory, "index.html"),
      "utf-8",
    );
    const graph = JSON.parse(
      await readFile(
        path.join(outputDirectory, "canonical-graph.json"),
        "utf-8",
      ),
    ) as unknown;
    const agentTasks = JSON.parse(
      await readFile(path.join(outputDirectory, "agent-tasks.json"), "utf-8"),
    ) as unknown[];

    expect(result.manifest.renderedItems).toBe(result.graph.nodes.length);
    expect(dashboard).toContain("Notion2Loop Migration Studio");
    expect(dashboard).toContain("Copy for Loop");
    expect(dashboard).toContain("Canonical workspace graph");
    expect(dashboard).not.toContain("window.notionExportExecuted");
    expect(graph).toEqual(result.graph);
    expect(agentTasks).toHaveLength(result.plan.summary.agentTaskCount);
  });

  it("serves the generated dashboard over localhost", async () => {
    const outputDirectory = await createTemporaryDirectory();
    await new RunMigration().execute({
      inputPath: path.resolve("fixtures/notion-export"),
      outputDirectory,
      now: new Date("2026-07-22T05:10:00.000Z"),
    });
    await mkdir(path.join(outputDirectory, "empty"), { recursive: true });
    const server = await startDashboardServer(outputDirectory, 0);

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("The test server did not expose a TCP port.");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      const content = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(content).toContain("Migration Studio");

      const missingIndexResponse = await fetch(
        `http://127.0.0.1:${address.port}/empty/`,
      );
      expect(missingIndexResponse.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("keeps generated page files inside a clean package directory", async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const inputDirectory = path.join(temporaryDirectory, "input");
    const outputDirectory = path.join(temporaryDirectory, "package");
    const stalePagePath = path.join(outputDirectory, "pages", "stale.html");
    await mkdir(inputDirectory, { recursive: true });
    await mkdir(path.dirname(stalePagePath), { recursive: true });
    await writeFile(stalePagePath, "stale", "utf-8");
    await writeFile(
      path.join(inputDirectory, "notion-api-snapshot.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        workspace: {
          id: "../../escaped",
          title: "Unsafe workspace ID",
        },
        pages: [],
        databases: [],
        rows: [],
        unsupportedBlocks: [],
      }),
      "utf-8",
    );
    await writeFile(
      path.join(
        inputDirectory,
        "Unsafe workspace ID 11111111111111111111111111111111.md",
      ),
      "# Unsafe workspace ID",
      "utf-8",
    );

    const result = await new RunMigration().execute({
      inputPath: inputDirectory,
      outputDirectory,
      now: new Date("2026-07-22T05:10:00.000Z"),
    });

    expect(
      result.manifest.files.filter((file) => file.startsWith("pages/")),
    ).toHaveLength(result.graph.nodes.length);
    expect(result.manifest.files.some((file) => file.includes(".."))).toBe(
      false,
    );
    await expect(
      readFile(path.join(temporaryDirectory, "escaped.html"), "utf-8"),
    ).rejects.toThrow();
    await expect(readFile(stalePagePath, "utf-8")).rejects.toThrow();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "notion2loop-output-"));
  temporaryDirectories.push(directory);
  return directory;
}
