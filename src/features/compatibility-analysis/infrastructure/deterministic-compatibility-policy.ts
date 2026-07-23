import type {
  CanonicalEdge,
  CanonicalNode,
  CanonicalProperty,
  CanonicalWorkspaceGraph,
} from "../../workspace-ingestion/domain/canonical-graph.js";
import type {
  CompatibilityPolicy,
  EdgeCompatibilityEvaluation,
  NodeCompatibilityEvaluation,
} from "../application/compatibility-policy.js";
import {
  AgentTaskSchema,
  MigrationIssueSchema,
  MigrationItemPlanSchema,
  MigrationLinkPlanSchema,
  type AgentTask,
  type MigrationIssue,
  type MigrationStatus,
} from "../domain/migration-plan.js";

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /upload\s+.*\b(secret|credential|token)s?\b/i,
];

const COMPLEX_DATABASE_TYPES = new Set([
  "relation",
  "formula",
  "rollup",
  "person",
  "files",
]);

export class DeterministicCompatibilityPolicy
  implements CompatibilityPolicy
{
  public evaluateNode(
    node: CanonicalNode,
    graph: CanonicalWorkspaceGraph,
  ): NodeCompatibilityEvaluation {
    const issues: MigrationIssue[] = [];
    const agentTasks: AgentTask[] = [];
    const suspiciousPattern = node.content
      ? PROMPT_INJECTION_PATTERNS.find((pattern) => pattern.test(node.content!))
      : undefined;

    const base = evaluateNodeTarget(node, graph);
    let status = base.status;
    let approvalRequired = base.approvalRequired;
    const warnings = [...base.warnings];

    if (suspiciousPattern) {
      status = "manual";
      approvalRequired = true;
      warnings.push("Prompt-like source content requires security review.");
      issues.push(
        MigrationIssueSchema.parse({
          id: `issue:prompt_injection:${node.id}`,
          severity: "high",
          code: "prompt_injection_risk",
          message: `${node.title} contains text that resembles agent instructions.`,
          recommendation:
            "Keep the source text outside the instruction channel and require human approval before any agent transformation.",
          sourceId: node.id,
        }),
      );
      agentTasks.push(
        AgentTaskSchema.parse({
          id: `agent:security_review:${node.id}`,
          taskType: "security_review",
          title: `Review untrusted content in ${node.title}`,
          objective:
            "Determine whether the source can be transformed without obeying embedded instructions.",
          sourceIds: [node.id],
          risk: "high",
          approvalRequired: true,
          trustBoundary: "untrusted_source_data",
          input: {
            sourceTitle: node.title,
            matchedRule: suspiciousPattern.source,
            rawContentIncluded: false,
          },
          outputContract: {
            format: "json",
            requiredFields: [
              "safeToTransform",
              "redactions",
              "reviewNotes",
            ],
          },
        }),
      );
    }

    if (node.kind === "database") {
      for (const property of node.propertySchemas) {
        const generated = evaluateComplexProperty(node, property);
        issues.push(...generated.issues);
        agentTasks.push(...generated.agentTasks);
      }
    }

    return {
      item: MigrationItemPlanSchema.parse({
        id: `item:${node.id}`,
        sourceId: node.id,
        sourceKind: node.kind,
        title: node.title,
        status,
        targetKind: base.targetKind,
        approvalRequired,
        reasons: base.reasons,
        warnings,
      }),
      issues,
      agentTasks,
    };
  }

  public evaluateEdge(
    edge: CanonicalEdge,
    _graph: CanonicalWorkspaceGraph,
  ): EdgeCompatibilityEvaluation {
    const mapping = mapEdge(edge);

    return {
      link: MigrationLinkPlanSchema.parse({
        id: `link:${edge.id}`,
        edgeId: edge.id,
        edgeType: edge.type,
        from: edge.from,
        to: edge.to,
        ...mapping,
      }),
      issues: [],
      agentTasks: [],
    };
  }
}

function evaluateNodeTarget(
  node: CanonicalNode,
  graph: CanonicalWorkspaceGraph,
): {
  readonly status: MigrationStatus;
  readonly targetKind:
    | "loop_workspace"
    | "loop_page"
    | "loop_table"
    | "microsoft_list"
    | "microsoft_list_item"
    | "sharepoint_file";
  readonly approvalRequired: boolean;
  readonly reasons: readonly string[];
  readonly warnings: readonly string[];
} {
  switch (node.kind) {
    case "workspace":
      return {
        status: "manual",
        targetKind: "loop_workspace",
        approvalRequired: true,
        reasons: [
          "No supported public API for native Loop workspace and page content creation is available.",
        ],
        warnings: [],
      };
    case "page":
      return {
        status: "transformed",
        targetKind: "loop_page",
        approvalRequired: true,
        reasons: [
          "Page content can be converted to sanitized rich HTML for guided insertion.",
        ],
        warnings: [],
      };
    case "database": {
      const complexProperties = node.propertySchemas.filter((property) =>
        COMPLEX_DATABASE_TYPES.has(property.type),
      );
      return complexProperties.length === 0
        ? {
            status: "native",
            targetKind: "loop_table",
            approvalRequired: false,
            reasons: ["The database can be represented as a flat Loop table."],
            warnings: [],
          }
        : {
            status: "transformed",
            targetKind: "microsoft_list",
            approvalRequired: true,
            reasons: [
              "Typed or relational properties need a Microsoft Lists representation.",
            ],
            warnings: [
              `${complexProperties.length} properties need semantic mapping.`,
            ],
          };
    }
    case "database_row": {
      const parent = node.parentId
        ? graph.nodes.find((candidate) => candidate.id === node.parentId)
        : undefined;
      const complexParent =
        parent?.kind === "database" &&
        parent.propertySchemas.some((property) =>
          COMPLEX_DATABASE_TYPES.has(property.type),
        );

      return complexParent
        ? {
            status: "transformed",
            targetKind: "microsoft_list_item",
            approvalRequired: false,
            reasons: [
              "The row follows its parent database into Microsoft Lists.",
            ],
            warnings: [],
          }
        : {
            status: "native",
            targetKind: "loop_table",
            approvalRequired: false,
            reasons: ["The row can be rendered in a Loop table."],
            warnings: [],
          };
    }
    case "asset":
      return {
        status: "native",
        targetKind: "sharepoint_file",
        approvalRequired: false,
        reasons: [
          "The asset can be uploaded to SharePoint or OneDrive and relinked.",
        ],
        warnings: [],
      };
  }
}

function evaluateComplexProperty(
  database: CanonicalNode,
  property: CanonicalProperty,
): {
  readonly issues: readonly MigrationIssue[];
  readonly agentTasks: readonly AgentTask[];
} {
  if (property.type === "formula" && property.formulaExpression) {
    return createPropertyTask(
      database,
      property,
      "formula_mapping",
      "medium",
      "Translate the Notion formula into a supported calculated column, Power Automate flow, or documented static snapshot.",
      ["recommendedTarget", "expression", "fallback", "informationLoss"],
    );
  }

  if (property.type === "rollup" && property.rollup) {
    return createPropertyTask(
      database,
      property,
      "rollup_mapping",
      "medium",
      "Translate the Notion rollup into a Lists lookup, automation, or explicit static value.",
      ["recommendedTarget", "aggregation", "refreshStrategy", "informationLoss"],
    );
  }

  if (property.type === "relation") {
    return createPropertyTask(
      database,
      property,
      "relation_mapping",
      "medium",
      "Choose a Microsoft Lists lookup or durable target URL mapping for the relation.",
      ["recommendedTarget", "keyStrategy", "secondPassSteps", "informationLoss"],
    );
  }

  return {
    issues: [],
    agentTasks: [],
  };
}

function createPropertyTask(
  database: CanonicalNode,
  property: CanonicalProperty,
  taskType: "formula_mapping" | "rollup_mapping" | "relation_mapping",
  risk: "low" | "medium" | "high",
  objective: string,
  requiredFields: readonly string[],
): {
  readonly issues: readonly MigrationIssue[];
  readonly agentTasks: readonly AgentTask[];
} {
  const propertyContext: Record<string, unknown> = {
    databaseTitle: database.title,
    propertyName: property.name,
    propertyType: property.type,
  };

  if (property.formulaExpression) {
    propertyContext["formulaExpression"] = property.formulaExpression;
  }
  if (property.relationTargetDatabaseId) {
    propertyContext["relationTargetDatabaseId"] =
      property.relationTargetDatabaseId;
  }
  if (property.rollup) {
    propertyContext["rollup"] = property.rollup;
  }

  return {
    issues: [
      MigrationIssueSchema.parse({
        id: `issue:${taskType}:${database.id}:${property.id}`,
        severity: risk,
        code: taskType,
        message: `${database.title}.${property.name} requires semantic transformation.`,
        recommendation: objective,
        sourceId: database.id,
      }),
    ],
    agentTasks: [
      AgentTaskSchema.parse({
        id: `agent:${taskType}:${database.id}:${property.id}`,
        taskType,
        title: `Map ${database.title}.${property.name}`,
        objective,
        sourceIds: [database.id],
        risk,
        approvalRequired: true,
        trustBoundary: "untrusted_source_data",
        input: propertyContext,
        outputContract: {
          format: "json",
          requiredFields: [...requiredFields],
        },
      }),
    ],
  };
}

function mapEdge(edge: CanonicalEdge): {
  readonly status: MigrationStatus;
  readonly strategy: string;
  readonly approvalRequired: boolean;
} {
  switch (edge.type) {
    case "parent_child":
      return {
        status: "transformed",
        strategy:
          "Create all target containers first, then place child content using the source-to-target identity map.",
        approvalRequired: false,
      };
    case "internal_link":
      return {
        status: "transformed",
        strategy:
          "Replace the source URL during the second pass after target URLs exist.",
        approvalRequired: false,
      };
    case "database_relation":
      return {
        status: "transformed",
        strategy:
          "Create a Lists lookup when possible; otherwise store the resolved target URL.",
        approvalRequired: true,
      };
    case "attachment":
      return {
        status: "transformed",
        strategy:
          "Upload the asset to SharePoint or OneDrive and replace the local reference.",
        approvalRequired: false,
      };
    case "mention":
      return {
        status: "manual",
        strategy:
          "Resolve the source identity against Microsoft Entra ID and request approval.",
        approvalRequired: true,
      };
  }
}
