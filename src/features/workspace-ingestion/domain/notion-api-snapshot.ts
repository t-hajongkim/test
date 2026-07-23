import { z } from "zod";

import { CanonicalPropertyTypeSchema } from "./canonical-graph.js";

export const SnapshotPropertyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: CanonicalPropertyTypeSchema,
  relationTargetDatabaseId: z.string().min(1).optional(),
  formulaExpression: z.string().min(1).optional(),
  rollup: z
    .object({
      relationPropertyName: z.string().min(1),
      targetPropertyName: z.string().min(1),
      function: z.string().min(1),
    })
    .optional(),
});

export const SnapshotPropertyValueSchema = z.object({
  type: CanonicalPropertyTypeSchema,
  value: z.unknown().optional(),
  pageIds: z.array(z.string().min(1)).default([]),
});

export const NotionApiSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workspace: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
  }),
  pages: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        parentId: z.string().min(1).optional(),
      }),
    )
    .default([]),
  databases: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        parentId: z.string().min(1).optional(),
        properties: z.array(SnapshotPropertyDefinitionSchema),
      }),
    )
    .default([]),
  rows: z
    .array(
      z.object({
        id: z.string().min(1),
        databaseId: z.string().min(1),
        title: z.string().min(1),
        properties: z.record(z.string(), SnapshotPropertyValueSchema),
      }),
    )
    .default([]),
  unsupportedBlocks: z
    .array(
      z.object({
        pageId: z.string().min(1),
        type: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .default([]),
});

export type NotionApiSnapshot = z.infer<typeof NotionApiSnapshotSchema>;
export type SnapshotPropertyValue = z.infer<
  typeof SnapshotPropertyValueSchema
>;
