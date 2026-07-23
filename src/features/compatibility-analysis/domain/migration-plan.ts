import { z } from "zod";

import {
  CanonicalEdgeTypeSchema,
  CanonicalNodeKindSchema,
} from "../../workspace-ingestion/domain/canonical-graph.js";

export const MigrationStatusSchema = z.enum([
  "native",
  "transformed",
  "manual",
  "blocked",
]);

export const TargetKindSchema = z.enum([
  "loop_workspace",
  "loop_page",
  "loop_table",
  "microsoft_list",
  "microsoft_list_item",
  "planner_plan",
  "sharepoint_file",
  "manual_archive",
]);

export const MigrationItemPlanSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: CanonicalNodeKindSchema,
  title: z.string().min(1),
  status: MigrationStatusSchema,
  targetKind: TargetKindSchema,
  approvalRequired: z.boolean(),
  reasons: z.array(z.string().min(1)),
  warnings: z.array(z.string().min(1)),
});

export const MigrationLinkPlanSchema = z.object({
  id: z.string().min(1),
  edgeId: z.string().min(1),
  edgeType: CanonicalEdgeTypeSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  status: MigrationStatusSchema,
  strategy: z.string().min(1),
  approvalRequired: z.boolean(),
});

export const MigrationIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  code: z.string().min(1),
  message: z.string().min(1),
  recommendation: z.string().min(1),
  sourceId: z.string().min(1).optional(),
});

export const AgentTaskSchema = z.object({
  id: z.string().min(1),
  taskType: z.enum([
    "formula_mapping",
    "rollup_mapping",
    "relation_mapping",
    "unsupported_block",
    "security_review",
  ]),
  title: z.string().min(1),
  objective: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  risk: z.enum(["low", "medium", "high"]),
  approvalRequired: z.literal(true),
  trustBoundary: z.literal("untrusted_source_data"),
  input: z.record(z.string(), z.unknown()),
  outputContract: z.object({
    format: z.literal("json"),
    requiredFields: z.array(z.string().min(1)).min(1),
  }),
});

export const MigrationPlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  workspaceId: z.string().min(1),
  workspaceTitle: z.string().min(1),
  graphGeneratedAt: z.string().datetime({ offset: true }),
  analyzedAt: z.string().datetime({ offset: true }),
  summary: z.object({
    fidelityScore: z.number().min(0).max(100),
    totalItems: z.number().int().nonnegative(),
    native: z.number().int().nonnegative(),
    transformed: z.number().int().nonnegative(),
    manual: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    issueCount: z.number().int().nonnegative(),
    agentTaskCount: z.number().int().nonnegative(),
  }),
  items: z.array(MigrationItemPlanSchema),
  links: z.array(MigrationLinkPlanSchema),
  issues: z.array(MigrationIssueSchema),
  agentTasks: z.array(AgentTaskSchema),
});

export type MigrationStatus = z.infer<typeof MigrationStatusSchema>;
export type MigrationItemPlan = z.infer<typeof MigrationItemPlanSchema>;
export type MigrationLinkPlan = z.infer<typeof MigrationLinkPlanSchema>;
export type MigrationIssue = z.infer<typeof MigrationIssueSchema>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;
