import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GeneratePublicDemo } from "../src/features/public-demo/application/generate-public-demo.js";
import { FileSystemPublicArtifactAuditor } from "../src/features/public-demo/infrastructure/file-system-public-artifact-auditor.js";
import { FileSystemPublicDemoFixtureVerifier } from "../src/features/public-demo/infrastructure/file-system-public-demo-fixture-verifier.js";
import { RunMigration } from "../src/features/migration-run/application/run-migration.js";

const temporaryDirectories: string[] = [];
const fixedNow = new Date("2026-07-23T01:30:00.000Z");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("public demo delivery", () => {
  it("requires a declared synthetic fixture with no private-data patterns", async () => {
    const fixtureDirectory = path.resolve("fixtures/notion-export");

    await expect(
      new FileSystemPublicDemoFixtureVerifier().verify(fixtureDirectory),
    ).resolves.toEqual({
      classification: "synthetic",
      containsRealNotionData: false,
      safeForPublicDistribution: true,
    });
  });

  it("generates clean public artifacts without environment-specific metadata", async () => {
    const projectRoot = await createTemporaryProject();
    const outputDirectory = path.join(projectRoot, "output", "demo");
    await mkdir(outputDirectory, { recursive: true });
    const staleFile = path.join(outputDirectory, "stale-private-output.txt");
    await writeFile(staleFile, "TOKEN=stale-private-value", "utf-8");

    const result = await createPublicDemo().execute({
      projectRoot,
      outputDirectory,
      now: fixedNow,
    });

    const graph = JSON.parse(
      await readFile(
        path.join(outputDirectory, "canonical-graph.json"),
        "utf-8",
      ),
    ) as { sourceDescription: string };
    const manifest = JSON.parse(
      await readFile(path.join(outputDirectory, "manifest.json"), "utf-8"),
    ) as { outputDirectory: string };
    const dashboard = await readFile(
      path.join(outputDirectory, "index.html"),
      "utf-8",
    );

    expect(graph.sourceDescription).toBe(
      "synthetic-fixture:fixtures/notion-export",
    );
    expect(manifest.outputDirectory).toBe(".");
    expect(result.graph.sourceDescription).toBe(graph.sourceDescription);
    expect(result.manifest.outputDirectory).toBe(".");
    expect(dashboard).toContain("합성 샘플 기반 오프라인 분석 데모");
    expect(dashboard).toContain("실제 이전 서비스가 아닙니다");
    expect(dashboard).toContain(
      "73%는 실제 완료율이 아닌 예상 의미 보존 점수입니다",
    );
    expect(dashboard).toContain(
      "실제 Notion 자료를 업로드하거나 커밋하지 마세요",
    );
    await expect(readFile(staleFile, "utf-8")).rejects.toThrow();
    await expect(
      new FileSystemPublicArtifactAuditor().assertSafe(outputDirectory),
    ).resolves.toBeUndefined();
  });

  it("rejects paths, file URIs, contact details, and secret-shaped values", async () => {
    const outputDirectory = await createTemporaryDirectory();
    await mkdir(path.join(outputDirectory, "pages"), { recursive: true });
    await writeFile(
      path.join(outputDirectory, "index.html"),
      [
        "C:\\Users\\demo\\private",
        "\\\\server\\share\\private",
        "\\\\?\\UNC\\server\\share\\private",
        "//server/share/private",
        "(/Users/demo/private)",
        "/tmp/private/export",
        "file:/home/demo/private.txt",
        "person@example.com",
        "사용자@예시.한국",
        "+821012345678",
        "4155552671",
        '"token": "supersecret123"',
        '"aws_secret_access_key": "example-secret-value"',
        "github_pat_1234567890abcdefghijklmnop",
      ].join("\n"),
      "utf-8",
    );

    await expect(
      new FileSystemPublicArtifactAuditor().assertSafe(outputDirectory),
    ).rejects.toThrow(
      /absolute path.*file URI.*email address.*phone number.*secret/i,
    );
  });

  it("refuses to clean an output directory outside the project output root", async () => {
    await expect(
      createPublicDemo().execute({
        projectRoot: path.resolve("."),
        outputDirectory: path.resolve("."),
        now: fixedNow,
      }),
    ).rejects.toThrow(/public demo output.*inside.*output/i);
  });

  it("refuses public cleanup through a symlinked output root", async () => {
    const projectRoot = await createTemporaryProject();
    const externalDirectory = await createTemporaryDirectory();
    await symlink(
      externalDirectory,
      path.join(projectRoot, "output"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      createPublicDemo().execute({
        projectRoot,
        outputDirectory: path.join(projectRoot, "output", "demo"),
        now: fixedNow,
      }),
    ).rejects.toThrow(/symbolic link/i);
  });

  it("preserves local paths for ordinary migrations", async () => {
    const outputDirectory = await createTemporaryDirectory();
    const inputPath = path.resolve("fixtures/notion-export");
    const result = await new RunMigration().execute({
      inputPath,
      outputDirectory,
      now: fixedNow,
    });

    expect(result.graph.sourceDescription).toBe(`directory:${inputPath}`);
    expect(result.manifest.outputDirectory).toBe(
      path.resolve(outputDirectory),
    );
  });

  it("deploys only a validated main-push artifact through official Pages actions", async () => {
    const workflow = await readFile(".github/workflows/ci.yml", "utf-8");

    expect(workflow).toMatch(
      /build-pages:\s+name: Build public demo\s+needs: validate\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    );
    expect(workflow).toContain("uses: actions/configure-pages@v5");
    expect(workflow).toContain("uses: actions/upload-pages-artifact@v4");
    expect(workflow).toMatch(/path: output\/demo/);
    expect(workflow).toMatch(
      /deploy:\s+name: Deploy public demo\s+needs:\s+- validate\s+- build-pages\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    );
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("name: github-pages");
    expect(workflow).toContain(
      "url: ${{ steps.deployment.outputs.page_url }}",
    );
    expect(workflow).toContain("uses: actions/deploy-pages@v4");
  });
});

function createPublicDemo(): GeneratePublicDemo {
  const auditor = new FileSystemPublicArtifactAuditor();
  return new GeneratePublicDemo(
    new RunMigration(),
    new FileSystemPublicDemoFixtureVerifier(auditor),
    auditor,
  );
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "notion2loop-public-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function createTemporaryProject(): Promise<string> {
  const projectRoot = await createTemporaryDirectory();
  await cp(
    path.resolve("fixtures/notion-export"),
    path.join(projectRoot, "fixtures", "notion-export"),
    { recursive: true },
  );
  return projectRoot;
}
