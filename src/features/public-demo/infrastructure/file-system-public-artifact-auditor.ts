import { readFile } from "node:fs/promises";
import path from "node:path";

import fastGlob from "fast-glob";

import type { PublicArtifactAuditor } from "../application/public-artifact-auditor.js";
import {
  findPublicDataRisks,
  findSensitiveJsonRisks,
} from "../domain/public-demo-contract.js";

export class FileSystemPublicArtifactAuditor
  implements PublicArtifactAuditor
{
  public async assertSafe(directory: string): Promise<void> {
    const relativePaths = await fastGlob("**/*", {
      cwd: directory,
      dot: true,
      followSymbolicLinks: false,
      onlyFiles: true,
    });
    if (relativePaths.length === 0) {
      throw new Error("The public demo directory contains no files.");
    }

    const violations: string[] = [];
    for (const relativePath of relativePaths.sort()) {
      const content = await readFile(
        path.join(directory, relativePath),
        "utf-8",
      );
      const descriptions = [
        ...findPublicDataRisks(relativePath),
        ...findPublicDataRisks(content),
        ...(relativePath.toLowerCase().endsWith(".json")
          ? findSensitiveJsonRisks(parsePublicJson(content, relativePath))
          : []),
      ].map((risk) => risk.description);
      const uniqueDescriptions = [...new Set(descriptions)];
      if (uniqueDescriptions.length > 0) {
        violations.push(
          `${relativePath}: ${uniqueDescriptions.join(", ")}`,
        );
      }
    }

    function parsePublicJson(content: string, relativePath: string): unknown {
      try {
        return JSON.parse(content);
      } catch {
        throw new Error(`Public demo JSON is invalid: ${relativePath}`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Public demo privacy audit failed: ${violations.join("; ")}`,
      );
    }
  }
}
