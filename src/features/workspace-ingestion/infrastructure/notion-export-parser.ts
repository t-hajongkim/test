import { createHash } from "node:crypto";
import path from "node:path";

import { CsvError, parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import type {
  ParseWorkspaceRequest,
  WorkspaceParser,
} from "../application/workspace-parser.js";
import { WorkspaceSourceError } from "../application/workspace-source-error.js";
import {
  CanonicalEdgeSchema,
  CanonicalNodeSchema,
  CanonicalPropertySchema,
  CanonicalWorkspaceGraphSchema,
  type CanonicalEdge,
  type CanonicalNode,
  type CanonicalProperty,
  type CanonicalWarning,
  type CanonicalWorkspaceGraph,
} from "../domain/canonical-graph.js";
import {
  NotionApiSnapshotSchema,
  type NotionApiSnapshot,
  type SnapshotPropertyValue,
} from "../domain/notion-api-snapshot.js";
import { normalizeSourcePath } from "./source-path.js";

const decoder = new TextDecoder("utf-8");
const CsvRecordsSchema = z.array(z.record(z.string(), z.string()));
const NOTION_ID_PATTERN = /([0-9a-f]{32})$/i;

interface LinkReference {
  readonly target: string;
  readonly attachment: boolean;
}

export class NotionExportParser implements WorkspaceParser {
  public async parse(
    request: ParseWorkspaceRequest,
  ): Promise<CanonicalWorkspaceGraph> {
    try {
      return await this.parseValidated(request);
    } catch (error) {
      if (
        error instanceof WorkspaceSourceError ||
        error instanceof SyntaxError ||
        error instanceof z.ZodError ||
        error instanceof CsvError
      ) {
        if (error instanceof WorkspaceSourceError) {
          throw error;
        }
        throw new WorkspaceSourceError(
          "invalid_source_data",
          "The Notion export contains malformed structured data.",
        );
      }
      throw error;
    }
  }

  private async parseValidated(
    request: ParseWorkspaceRequest,
  ): Promise<CanonicalWorkspaceGraph> {
    const files = [...request.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const snapshotFile = files.find(
      (file) =>
        path.posix.basename(file.path).toLowerCase() ===
        "notion-api-snapshot.json",
    );
    const snapshot = snapshotFile
      ? NotionApiSnapshotSchema.parse(
          JSON.parse(decoder.decode(snapshotFile.content)),
        )
      : undefined;
    const workspaceId =
      snapshot?.workspace.id ??
      stableId(`workspace:${request.sourceDescription}`);
    const workspaceTitle =
      snapshot?.workspace.title ?? inferWorkspaceTitle(files);
    const nodesById = new Map<string, CanonicalNode>();
    const warnings: CanonicalWarning[] = [];

    nodesById.set(
      workspaceId,
      CanonicalNodeSchema.parse({
        id: workspaceId,
        kind: "workspace",
        title: workspaceTitle,
        sourcePath: ".",
        propertySchemas: [],
        properties: {},
        metadata: {
          apiSnapshotAvailable: snapshot !== undefined,
        },
      }),
    );

    this.addDatabasesAndRows(files, snapshot, workspaceId, nodesById);
    this.addPageContent(files, snapshot, workspaceId, nodesById);
    this.addAssets(files, workspaceId, nodesById);
    this.assignParents(workspaceId, nodesById);

    const pathToNodeId = new Map<string, string>();
    for (const node of nodesById.values()) {
      if (!node.sourcePath.includes("#")) {
        pathToNodeId.set(normalizeSourcePath(node.sourcePath), node.id);
      }
    }

    const edges: CanonicalEdge[] = [];
    const edgeKeys = new Set<string>();
    const addEdge = (candidate: Omit<CanonicalEdge, "id">): void => {
      const edgeKey = [
        candidate.type,
        candidate.from,
        candidate.to,
        candidate.label ?? "",
      ].join("|");

      if (edgeKeys.has(edgeKey)) {
        return;
      }

      edgeKeys.add(edgeKey);
      edges.push(
        CanonicalEdgeSchema.parse({
          ...candidate,
          id: stableId(`edge:${edgeKey}`),
        }),
      );
    };

    for (const node of nodesById.values()) {
      if (node.parentId) {
        addEdge({
          type: "parent_child",
          from: node.parentId,
          to: node.id,
          source: node.metadata["parentSource"] === "api" ? "api" : "inferred",
          metadata: {},
        });
      }

      if (!node.content) {
        continue;
      }

      for (const reference of extractLinkReferences(
        node.content,
        node.contentFormat ?? "markdown",
      )) {
        const resolvedPath = resolveLocalReference(
          node.sourcePath,
          reference.target,
        );

        if (!resolvedPath) {
          continue;
        }

        const targetId = pathToNodeId.get(resolvedPath);
        if (!targetId) {
          warnings.push({
            code: "unresolved_local_reference",
            message: `Could not resolve local reference "${reference.target}".`,
            sourceId: node.id,
            sourcePath: node.sourcePath,
            details: {
              resolvedPath,
            },
          });
          continue;
        }

        const targetNode = nodesById.get(targetId);
        addEdge({
          type:
            reference.attachment || targetNode?.kind === "asset"
              ? "attachment"
              : "internal_link",
          from: node.id,
          to: targetId,
          source: "export",
          metadata: {
            originalTarget: reference.target,
          },
        });
      }
    }

    if (snapshot) {
      this.addSnapshotRelations(snapshot, nodesById, warnings, addEdge);

      for (const unsupportedBlock of snapshot.unsupportedBlocks) {
        warnings.push({
          code: "unsupported_block",
          message: `${unsupportedBlock.type}: ${unsupportedBlock.description}`,
          sourceId: unsupportedBlock.pageId,
          details: {
            blockType: unsupportedBlock.type,
          },
        });
      }
    }

    return CanonicalWorkspaceGraphSchema.parse({
      schemaVersion: "1.0",
      workspaceId,
      title: workspaceTitle,
      generatedAt: request.generatedAt.toISOString(),
      sourceDescription: request.sourceDescription,
      nodes: [...nodesById.values()].sort(compareNodes),
      edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
      warnings,
    });
  }

  private addDatabasesAndRows(
    files: readonly ParseWorkspaceRequest["files"][number][],
    snapshot: NotionApiSnapshot | undefined,
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const file of files.filter(
      (candidate) => path.posix.extname(candidate.path).toLowerCase() === ".csv",
    )) {
      const databaseId =
        extractNotionId(file.path) ?? stableId(`database:${file.path}`);
      const snapshotDatabase = snapshot?.databases.find(
        (database) => database.id === databaseId,
      );
      const records = CsvRecordsSchema.parse(
        parseCsv(decoder.decode(file.content), {
          bom: true,
          columns: true,
          relax_column_count: true,
          skip_empty_lines: true,
        }),
      );
      const inferredColumns = records[0] ? Object.keys(records[0]) : [];
      const propertySchemas =
        snapshotDatabase?.properties.map((property) =>
          CanonicalPropertySchema.parse(property),
        ) ?? inferPropertySchemas(inferredColumns);

      nodesById.set(
        databaseId,
        CanonicalNodeSchema.parse({
          id: databaseId,
          kind: "database",
          title: snapshotDatabase?.title ?? titleFromPath(file.path),
          sourcePath: normalizeSourcePath(file.path),
          parentId: snapshotDatabase?.parentId ?? workspaceId,
          propertySchemas,
          properties: {},
          metadata: {
            parentSource: snapshotDatabase?.parentId ? "api" : "inferred",
            rowCount: records.length,
          },
        }),
      );

      const titleProperty =
        propertySchemas.find((property) => property.type === "title")?.name ??
        inferredColumns[0] ??
        "Name";
      const snapshotRows =
        snapshot?.rows.filter((row) => row.databaseId === databaseId) ?? [];
      const usedSnapshotRowIds = new Set<string>();

      records.forEach((record, index) => {
        const rowTitle =
          normalizeCell(record[titleProperty]) || `Row ${index + 1}`;
        const snapshotRow = snapshotRows.find(
          (row) =>
            !usedSnapshotRowIds.has(row.id) &&
            row.title.localeCompare(rowTitle, undefined, {
              sensitivity: "base",
            }) === 0,
        );

        if (snapshotRow) {
          usedSnapshotRowIds.add(snapshotRow.id);
        }

        const rowId =
          snapshotRow?.id ??
          stableId(`row:${databaseId}:${index}:${JSON.stringify(record)}`);
        const properties: Record<string, unknown> = { ...record };

        if (snapshotRow) {
          for (const [name, value] of Object.entries(snapshotRow.properties)) {
            properties[name] = value;
          }
        }

        nodesById.set(
          rowId,
          CanonicalNodeSchema.parse({
            id: rowId,
            kind: "database_row",
            title: snapshotRow?.title ?? rowTitle,
            sourcePath: `${normalizeSourcePath(file.path)}#row=${index + 1}`,
            parentId: databaseId,
            propertySchemas: [],
            properties,
            metadata: {
              csvRowIndex: index + 1,
              parentSource: snapshotRow ? "api" : "inferred",
            },
          }),
        );
      });
    }
  }

  private addPageContent(
    files: readonly ParseWorkspaceRequest["files"][number][],
    snapshot: NotionApiSnapshot | undefined,
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    const pageFiles = files.filter((file) => {
      const extension = path.posix.extname(file.path).toLowerCase();
      return (
        extension === ".md" ||
        (extension === ".html" &&
          path.posix.basename(file.path).toLowerCase() !== "index.html")
      );
    });

    for (const file of pageFiles) {
      const extension = path.posix.extname(file.path).toLowerCase();
      const extractedId =
        extractNotionId(file.path) ?? stableId(`page:${file.path}`);
      const snapshotRow = snapshot?.rows.find((row) => row.id === extractedId);
      const snapshotPage = snapshot?.pages.find(
        (page) => page.id === extractedId,
      );
      const existing = nodesById.get(extractedId);
      const title =
        snapshotRow?.title ??
        snapshotPage?.title ??
        existing?.title ??
        titleFromPath(file.path);
      const parentId =
        snapshotRow?.databaseId ??
        snapshotPage?.parentId ??
        existing?.parentId ??
        workspaceId;

      nodesById.set(
        extractedId,
        CanonicalNodeSchema.parse({
          id: extractedId,
          kind: snapshotRow ? "database_row" : "page",
          title,
          sourcePath: normalizeSourcePath(file.path),
          parentId,
          contentFormat: extension === ".md" ? "markdown" : "html",
          content: decoder.decode(file.content),
          propertySchemas: existing?.propertySchemas ?? [],
          properties: existing?.properties ?? {},
          metadata: {
            ...(existing?.metadata ?? {}),
            parentSource:
              snapshotRow || snapshotPage?.parentId ? "api" : "inferred",
          },
        }),
      );
    }
  }

  private addAssets(
    files: readonly ParseWorkspaceRequest["files"][number][],
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const file of files) {
      const extension = path.posix.extname(file.path).toLowerCase();
      const basename = path.posix.basename(file.path).toLowerCase();

      if (
        [".md", ".csv", ".html"].includes(extension) ||
        basename === "notion-api-snapshot.json"
      ) {
        continue;
      }

      const assetId = stableId(`asset:${file.path}`);
      const mimeType = inferMimeType(file.path);
      const dataUrl =
        mimeType.startsWith("image/") && file.content.byteLength <= 1024 * 1024
          ? `data:${mimeType};base64,${Buffer.from(file.content).toString("base64")}`
          : undefined;
      nodesById.set(
        assetId,
        CanonicalNodeSchema.parse({
          id: assetId,
          kind: "asset",
          title: path.posix.basename(file.path),
          sourcePath: normalizeSourcePath(file.path),
          parentId: workspaceId,
          propertySchemas: [],
          properties: {},
          metadata: {
            byteLength: file.content.byteLength,
            mimeType,
            ...(dataUrl ? { dataUrl } : {}),
            parentSource: "inferred",
          },
        }),
      );
    }
  }

  private assignParents(
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const node of [...nodesById.values()]) {
      if (node.id === workspaceId) {
        continue;
      }

      if (node.parentId && nodesById.has(node.parentId)) {
        continue;
      }

      const inferredParentId =
        inferParentIdFromPath(node.sourcePath, nodesById) ?? workspaceId;
      nodesById.set(
        node.id,
        CanonicalNodeSchema.parse({
          ...node,
          parentId: inferredParentId,
          metadata: {
            ...node.metadata,
            parentSource: "inferred",
          },
        }),
      );
    }
  }

  private addSnapshotRelations(
    snapshot: NotionApiSnapshot,
    nodesById: ReadonlyMap<string, CanonicalNode>,
    warnings: CanonicalWarning[],
    addEdge: (candidate: Omit<CanonicalEdge, "id">) => void,
  ): void {
    for (const row of snapshot.rows) {
      for (const [propertyName, value] of Object.entries(row.properties)) {
        if (value.type !== "relation") {
          continue;
        }

        for (const targetPageId of value.pageIds) {
          if (!nodesById.has(targetPageId)) {
            warnings.push({
              code: "unresolved_api_relation",
              message: `Relation "${propertyName}" targets a page that was not exported.`,
              sourceId: row.id,
              details: {
                targetPageId,
              },
            });
            continue;
          }

          addEdge({
            type: "database_relation",
            from: row.id,
            to: targetPageId,
            label: propertyName,
            source: "api",
            metadata: {},
          });
        }
      }
    }
  }
}

function inferWorkspaceTitle(
  files: readonly ParseWorkspaceRequest["files"][number][],
): string {
  const topLevelContent = files.find((file) => {
    const normalized = normalizeSourcePath(file.path);
    const extension = path.posix.extname(normalized).toLowerCase();
    return (
      !normalized.includes("/") &&
      (extension === ".md" || extension === ".html")
    );
  });

  return topLevelContent
    ? titleFromPath(topLevelContent.path)
    : "Notion Workspace";
}

function inferPropertySchemas(
  columns: readonly string[],
): CanonicalProperty[] {
  return columns.map((column, index) =>
    CanonicalPropertySchema.parse({
      id: stableId(`property:${column}:${index}`),
      name: column,
      type: index === 0 ? "title" : "rich_text",
    }),
  );
}

function inferParentIdFromPath(
  sourcePath: string,
  nodesById: ReadonlyMap<string, CanonicalNode>,
): string | undefined {
  const filePath = sourcePath.split("#", 1)[0];
  if (!filePath) {
    return undefined;
  }

  let directory = path.posix.dirname(filePath);
  while (directory !== "." && directory !== "/") {
    const candidateId = extractNotionId(path.posix.basename(directory));
    if (candidateId && nodesById.has(candidateId)) {
      return candidateId;
    }
    directory = path.posix.dirname(directory);
  }

  return undefined;
}

function extractLinkReferences(
  content: string,
  format: "markdown" | "html",
): readonly LinkReference[] {
  const references: LinkReference[] = [];

  if (format === "markdown") {
    const markdownPattern = /(!?)\[[^\]]*]\(([^)]+)\)/g;
    for (const match of content.matchAll(markdownPattern)) {
      const target = match[2];
      if (target) {
        references.push({
          target: normalizeMarkdownTarget(target),
          attachment: match[1] === "!",
        });
      }
    }
  } else {
    const htmlPattern = /<(a|img)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi;
    for (const match of content.matchAll(htmlPattern)) {
      const target = match[2];
      if (target) {
        references.push({
          target,
          attachment: match[1]?.toLowerCase() === "img",
        });
      }
    }
  }

  return references;
}

function normalizeMarkdownTarget(target: string): string {
  const trimmed = target.trim().replace(/^<|>$/g, "");
  const titleSeparator = trimmed.match(/\s+["'][^"']*["']$/);
  return titleSeparator
    ? trimmed.slice(0, titleSeparator.index).trim()
    : trimmed;
}

function resolveLocalReference(
  sourcePath: string,
  target: string,
): string | undefined {
  if (
    target.length === 0 ||
    target.startsWith("#") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)
  ) {
    return undefined;
  }

  const withoutFragment = target.split("#", 1)[0]?.split("?", 1)[0];
  if (!withoutFragment) {
    return undefined;
  }

  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(withoutFragment);
  } catch {
    decodedTarget = withoutFragment;
  }

  const sourceFilePath = sourcePath.split("#", 1)[0] ?? sourcePath;
  return normalizeSourcePath(
    path.posix.normalize(
      path.posix.join(path.posix.dirname(sourceFilePath), decodedTarget),
    ),
  );
}

function titleFromPath(sourcePath: string): string {
  const extension = path.posix.extname(sourcePath);
  const basename = path.posix.basename(sourcePath, extension);
  return basename.replace(/\s+[0-9a-f]{32}$/i, "").trim() || "Untitled";
}

function extractNotionId(sourcePath: string): string | undefined {
  const extension = path.posix.extname(sourcePath);
  const basename = path.posix.basename(sourcePath, extension);
  return basename.match(NOTION_ID_PATTERN)?.[1]?.toLowerCase();
}

function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function normalizeCell(value: string | undefined): string {
  return value?.trim() ?? "";
}

function inferMimeType(sourcePath: string): string {
  switch (path.posix.extname(sourcePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function compareNodes(left: CanonicalNode, right: CanonicalNode): number {
  const kindComparison = left.kind.localeCompare(right.kind);
  if (kindComparison !== 0) {
    return kindComparison;
  }

  const titleComparison = left.title.localeCompare(right.title);
  return titleComparison !== 0 ? titleComparison : left.id.localeCompare(right.id);
}

export function unwrapSnapshotValue(value: SnapshotPropertyValue): unknown {
  if (value.type === "relation") {
    return value.pageIds;
  }

  return value.value;
}
