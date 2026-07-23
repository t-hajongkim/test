import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  NotionApiSnapshotSchema,
  type PublicDemoFixtureDeclaration,
} from "../../workspace-ingestion/domain/notion-api-snapshot.js";
import type { PublicArtifactAuditor } from "../application/public-artifact-auditor.js";
import type { PublicDemoFixtureVerifier } from "../application/public-demo-fixture-verifier.js";
import { FileSystemPublicArtifactAuditor } from "./file-system-public-artifact-auditor.js";

export class FileSystemPublicDemoFixtureVerifier
  implements PublicDemoFixtureVerifier
{
  public constructor(
    private readonly auditor: PublicArtifactAuditor =
      new FileSystemPublicArtifactAuditor(),
  ) {}

  public async verify(
    fixtureDirectory: string,
  ): Promise<PublicDemoFixtureDeclaration> {
    const snapshotPath = path.join(
      fixtureDirectory,
      "notion-api-snapshot.json",
    );
    const snapshot = NotionApiSnapshotSchema.parse(
      JSON.parse(await readFile(snapshotPath, "utf-8")),
    );
    if (!snapshot.publicDemoFixture) {
      throw new Error(
        "The public demo fixture must declare synthetic public data.",
      );
    }

    await this.auditor.assertSafe(fixtureDirectory);
    return snapshot.publicDemoFixture;
  }
}
