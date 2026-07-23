import { createHash } from "node:crypto";
import path from "node:path";

import { CsvError, parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import type {
  ParseWorkspaceRequest,
  WorkspaceParser,
} from "../application/workspace-parser.js";
import type { SourceFile } from "../application/workspace-source.js";
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

interface PreparedSnapshotFile {
  readonly kind: "snapshot";
  readonly path: string;
  readonly snapshot: NotionApiSnapshot;
}

interface PreparedCsvFile {
  readonly kind: "csv";
  readonly path: string;
  readonly records: readonly Record<string, string>[];
}

interface PreparedPageFile {
  readonly kind: "page";
  readonly path: string;
  readonly format: "markdown" | "html";
  readonly content: string;
}

interface PreparedAssetFile {
  readonly kind: "asset";
  readonly path: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly dataUrl?: string;
}

interface PreparedIgnoredFile {
  readonly kind: "ignored";
  readonly path: string;
}

type PreparedSourceFile =
  | PreparedSnapshotFile
  | PreparedCsvFile
  | PreparedPageFile
  | PreparedAssetFile
  | PreparedIgnoredFile;

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
    const files = await prepareSourceFiles(request.files);
    const snapshotFile = files.find(
      (file): file is PreparedSnapshotFile =>
        file.kind === "snapshot",
    );
    const snapshot = snapshotFile?.snapshot;
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
    files: readonly PreparedSourceFile[],
    snapshot: NotionApiSnapshot | undefined,
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const file of files) {
      if (file.kind !== "csv") {
        continue;
      }
      const databaseId =
        extractNotionId(file.path) ?? stableId(`database:${file.path}`);
      const snapshotDatabase = snapshot?.databases.find(
        (database) => database.id === databaseId,
      );
      const records = file.records;
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
    files: readonly PreparedSourceFile[],
    snapshot: NotionApiSnapshot | undefined,
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const file of files) {
      if (file.kind !== "page") {
        continue;
      }
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
          contentFormat: file.format,
          content: file.content,
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
    files: readonly PreparedSourceFile[],
    workspaceId: string,
    nodesById: Map<string, CanonicalNode>,
  ): void {
    for (const file of files) {
      if (file.kind !== "asset") {
        continue;
      }

      const assetId = stableId(`asset:${file.path}`);
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
            byteLength: file.byteLength,
            mimeType: file.mimeType,
            ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
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

async function prepareSourceFiles(
  sourceFiles: AsyncIterable<SourceFile>,
): Promise<readonly PreparedSourceFile[]> {
  const files: PreparedSourceFile[] = [];
  for await (const sourceFile of sourceFiles) {
    const sourcePath = normalizeSourcePath(sourceFile.path);
    const extension = path.posix.extname(sourcePath).toLowerCase();
    const basename = path.posix.basename(sourcePath).toLowerCase();

    if (basename === "notion-api-snapshot.json") {
      files.push({
        kind: "snapshot",
        path: sourcePath,
        snapshot: NotionApiSnapshotSchema.parse(
          JSON.parse(decoder.decode(sourceFile.content)),
        ),
      });
      continue;
    }
    if (extension === ".csv") {
      files.push({
        kind: "csv",
        path: sourcePath,
        records: CsvRecordsSchema.parse(
          parseCsv(decoder.decode(sourceFile.content), {
            bom: true,
            columns: true,
            relax_column_count: true,
            skip_empty_lines: true,
          }),
        ),
      });
      continue;
    }
    if (
      extension === ".md" ||
      (extension === ".html" && basename !== "index.html")
    ) {
      files.push({
        kind: "page",
        path: sourcePath,
        format: extension === ".md" ? "markdown" : "html",
        content: decoder.decode(sourceFile.content),
      });
      continue;
    }
    if (extension === ".html") {
      files.push({ kind: "ignored", path: sourcePath });
      continue;
    }

    const mimeType = inferMimeType(sourcePath);
    const dataUrl =
      mimeType.startsWith("image/") &&
      sourceFile.content.byteLength <= 1024 * 1024
        ? `data:${mimeType};base64,${Buffer.from(sourceFile.content).toString("base64")}`
        : undefined;
    files.push({
      kind: "asset",
      path: sourcePath,
      byteLength: sourceFile.content.byteLength,
      mimeType,
      ...(dataUrl ? { dataUrl } : {}),
    });
  }
  return files.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function inferWorkspaceTitle(
  files: readonly PreparedSourceFile[],
): string {
  const topLevelContent = files.find((file) => {
    if (file.kind !== "page" && file.kind !== "ignored") {
      return false;
    }
    const normalized = normalizeSourcePath(file.path);
    return !normalized.includes("/");
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
