import { z } from "zod";

import {
  MigrationStatusSchema,
  TargetKindSchema,
} from "../../compatibility-analysis/domain/migration-plan.js";

export const RenderedMigrationItemSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1),
  status: MigrationStatusSchema,
  targetKind: TargetKindSchema,
  html: z.string(),
  plainText: z.string(),
});

export const MigrationPackageManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workspaceId: z.string().min(1),
  workspaceTitle: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  outputDirectory: z.string().min(1),
  dashboardPath: z.string().min(1),
  files: z.array(z.string().min(1)),
  renderedItems: z.number().int().nonnegative(),
});

export type RenderedMigrationItem = z.infer<
  typeof RenderedMigrationItemSchema
>;
export type MigrationPackageManifest = z.infer<
  typeof MigrationPackageManifestSchema
>;
