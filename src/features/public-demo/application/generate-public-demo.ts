import path from "node:path";

import type { RunMigrationResult } from "../../migration-run/application/run-migration.js";
import {
  PUBLIC_DEMO_FIXTURE_RELATIVE_PATH,
  PUBLIC_DEMO_SOURCE_DESCRIPTION,
} from "../domain/public-demo-contract.js";
import type { PublicArtifactAuditor } from "./public-artifact-auditor.js";
import type { PublicDemoFixtureVerifier } from "./public-demo-fixture-verifier.js";

export interface GeneratePublicDemoRequest {
  readonly projectRoot: string;
  readonly outputDirectory: string;
  readonly now?: Date;
}

export interface PublicDemoMigrationRunner {
  execute(request: {
    readonly inputPath: string;
    readonly outputDirectory: string;
    readonly packageProfile: "public_demo";
    readonly publicOutputRoot: string;
    readonly publishedSourceDescription: string;
    readonly now?: Date;
  }): Promise<RunMigrationResult>;
}

export class GeneratePublicDemo {
  public constructor(
    private readonly migrationRunner: PublicDemoMigrationRunner,
    private readonly fixtureVerifier: PublicDemoFixtureVerifier,
    private readonly artifactAuditor: PublicArtifactAuditor,
  ) {}

  public async execute(
    request: GeneratePublicDemoRequest,
  ): Promise<RunMigrationResult> {
    const fixtureDirectory = path.resolve(
      request.projectRoot,
      PUBLIC_DEMO_FIXTURE_RELATIVE_PATH,
    );
    await this.fixtureVerifier.verify(fixtureDirectory);

    const result = await this.migrationRunner.execute({
      inputPath: fixtureDirectory,
      outputDirectory: request.outputDirectory,
      packageProfile: "public_demo",
      publicOutputRoot: path.resolve(request.projectRoot, "output"),
      publishedSourceDescription: PUBLIC_DEMO_SOURCE_DESCRIPTION,
      ...(request.now ? { now: request.now } : {}),
    });
    await this.artifactAuditor.assertSafe(request.outputDirectory);
    return result;
  }
}
