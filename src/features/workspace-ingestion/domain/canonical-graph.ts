import { z } from "zod";

export const CanonicalNodeKindSchema = z.enum([
  "workspace",
  "page",
  "database",
  "database_row",
  "asset",
]);

export const CanonicalPropertyTypeSchema = z.enum([
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "person",
  "files",
  "relation",
  "formula",
  "rollup",
  "unknown",
]);

export const CanonicalPropertySchema = z.object({
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

export const CanonicalNodeSchema = z.object({
  id: z.string().min(1),
  kind: CanonicalNodeKindSchema,
  title: z.string().min(1),
  sourcePath: z.string().min(1),
  parentId: z.string().min(1).optional(),
  contentFormat: z.enum(["markdown", "html"]).optional(),
  content: z.string().optional(),
  propertySchemas: z.array(CanonicalPropertySchema).default([]),
  properties: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const CanonicalEdgeTypeSchema = z.enum([
  "parent_child",
  "internal_link",
  "database_relation",
  "attachment",
  "mention",
]);

export const CanonicalEdgeSchema = z.object({
  id: z.string().min(1),
  type: CanonicalEdgeTypeSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1).optional(),
  source: z.enum(["export", "api", "inferred"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const CanonicalWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const CanonicalWorkspaceGraphSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  sourceDescription: z.string().min(1),
  nodes: z.array(CanonicalNodeSchema),
  edges: z.array(CanonicalEdgeSchema),
  warnings: z.array(CanonicalWarningSchema),
});

export type CanonicalNodeKind = z.infer<typeof CanonicalNodeKindSchema>;
export type CanonicalProperty = z.infer<typeof CanonicalPropertySchema>;
export type CanonicalNode = z.infer<typeof CanonicalNodeSchema>;
export type CanonicalEdge = z.infer<typeof CanonicalEdgeSchema>;
export type CanonicalWarning = z.infer<typeof CanonicalWarningSchema>;
export type CanonicalWorkspaceGraph = z.infer<
  typeof CanonicalWorkspaceGraphSchema
>;
