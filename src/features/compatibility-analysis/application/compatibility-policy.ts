import type {
  CanonicalEdge,
  CanonicalNode,
  CanonicalWorkspaceGraph,
} from "../../workspace-ingestion/domain/canonical-graph.js";
import type {
  AgentTask,
  MigrationIssue,
  MigrationItemPlan,
  MigrationLinkPlan,
} from "../domain/migration-plan.js";

export interface NodeCompatibilityEvaluation {
  readonly item: MigrationItemPlan;
  readonly issues: readonly MigrationIssue[];
  readonly agentTasks: readonly AgentTask[];
}

export interface EdgeCompatibilityEvaluation {
  readonly link: MigrationLinkPlan;
  readonly issues: readonly MigrationIssue[];
  readonly agentTasks: readonly AgentTask[];
}

export interface CompatibilityPolicy {
  evaluateNode(
    node: CanonicalNode,
    graph: CanonicalWorkspaceGraph,
  ): NodeCompatibilityEvaluation;

  evaluateEdge(
    edge: CanonicalEdge,
    graph: CanonicalWorkspaceGraph,
  ): EdgeCompatibilityEvaluation;
}
