import path from "node:path";

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import type { MigrationItemPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type {
  CanonicalNode,
  CanonicalWorkspaceGraph,
} from "../../workspace-ingestion/domain/canonical-graph.js";
import type { MigrationContentRenderer } from "../application/migration-content-renderer.js";
import { RenderedMigrationItemSchema } from "../domain/migration-package.js";
import { escapeHtml } from "./html-utils.js";

export class LoopHtmlRenderer implements MigrationContentRenderer {
  public async render(
    node: CanonicalNode,
    itemPlan: MigrationItemPlan,
    graph: CanonicalWorkspaceGraph,
  ) {
    const body = await renderNodeBody(node, graph);
    const html = [
      `<article class="loop-content" data-source-id="${escapeHtml(node.id)}">`,
      `<header><p class="migration-eyebrow">${escapeHtml(itemPlan.targetKind.replaceAll("_", " "))}</p>`,
      `<h1>${escapeHtml(node.title)}</h1></header>`,
      body,
      `<footer><small>Source ID: ${escapeHtml(node.id)}</small></footer>`,
      "</article>",
    ].join("");
    const sanitized = sanitizeHtml(html, createSanitizeOptions(node, graph));
    const plainText = sanitizeHtml(sanitized, {
      allowedTags: [],
      allowedAttributes: {},
    })
      .replace(/\s+/g, " ")
      .trim();

    return RenderedMigrationItemSchema.parse({
      sourceId: node.id,
      title: node.title,
      status: itemPlan.status,
      targetKind: itemPlan.targetKind,
      html: sanitized,
      plainText,
    });
  }
}

async function renderNodeBody(
  node: CanonicalNode,
  graph: CanonicalWorkspaceGraph,
): Promise<string> {
  switch (node.kind) {
    case "workspace": {
      const children = graph.nodes.filter(
        (candidate) => candidate.parentId === node.id,
      );
      return [
        "<p>Migration package workspace overview.</p>",
        "<ul>",
        ...children.map(
          (child) =>
            `<li>${escapeHtml(child.title)} <small>(${escapeHtml(child.kind)})</small></li>`,
        ),
        "</ul>",
      ].join("");
    }
    case "database":
      return renderDatabase(node, graph);
    case "database_row": {
      const propertyTable = renderProperties(node, graph);
      const content = node.content
        ? await renderContent(node.content, node.contentFormat ?? "markdown")
        : "";
      return `${propertyTable}${content}`;
    }
    case "page":
      return node.content
        ? renderContent(node.content, node.contentFormat ?? "markdown")
        : "<p>No exported page content was available.</p>";
    case "asset": {
      const mimeType = String(
        node.metadata["mimeType"] ?? "application/octet-stream",
      );
      const byteLength = Number(node.metadata["byteLength"] ?? 0);
      const dataUrl = node.metadata["dataUrl"];
      const preview =
        typeof dataUrl === "string" && mimeType.startsWith("image/")
          ? `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(node.title)}">`
          : "";
      return `${preview}<dl><dt>MIME type</dt><dd>${escapeHtml(mimeType)}</dd><dt>Size</dt><dd>${byteLength.toLocaleString()} bytes</dd></dl>`;
    }
  }
}

function renderDatabase(
  database: CanonicalNode,
  graph: CanonicalWorkspaceGraph,
): string {
  const rows = graph.nodes.filter(
    (candidate) =>
      candidate.kind === "database_row" && candidate.parentId === database.id,
  );
  const columns =
    database.propertySchemas.length > 0
      ? database.propertySchemas.map((property) => property.name)
      : collectPropertyNames(rows);

  return [
    "<div class=\"table-wrap\"><table><thead><tr>",
    ...columns.map((column) => `<th>${escapeHtml(column)}</th>`),
    "</tr></thead><tbody>",
    ...rows.map((row) => {
      const cells = columns.map((column) =>
        formatPropertyValue(row.properties[column], graph),
      );
      return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
    }),
    "</tbody></table></div>",
  ].join("");
}

function renderProperties(
  node: CanonicalNode,
  graph: CanonicalWorkspaceGraph,
): string {
  const entries = Object.entries(node.properties);
  if (entries.length === 0) {
    return "";
  }

  return [
    "<div class=\"table-wrap\"><table><tbody>",
    ...entries.map(
      ([name, value]) =>
        `<tr><th>${escapeHtml(name)}</th><td>${formatPropertyValue(value, graph)}</td></tr>`,
    ),
    "</tbody></table></div>",
  ].join("");
}

async function renderContent(
  content: string,
  format: "markdown" | "html",
): Promise<string> {
  return format === "markdown" ? await marked.parse(content) : content;
}

function formatPropertyValue(
  value: unknown,
  graph: CanonicalWorkspaceGraph,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const propertyValue = value as Record<string, unknown>;
    const pageIds = propertyValue["pageIds"];
    if (Array.isArray(pageIds)) {
      return pageIds
        .map((pageId) => {
          const target = graph.nodes.find((node) => node.id === pageId);
          return escapeHtml(target?.title ?? String(pageId));
        })
        .join(", ");
    }
    if ("value" in propertyValue) {
      return escapeHtml(String(propertyValue["value"] ?? ""));
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => escapeHtml(String(item))).join(", ");
  }

  return escapeHtml(String(value));
}

function collectPropertyNames(rows: readonly CanonicalNode[]): string[] {
  return [
    ...new Set(rows.flatMap((row) => Object.keys(row.properties))),
  ].sort();
}

function createSanitizeOptions(
  sourceNode: CanonicalNode,
  graph: CanonicalWorkspaceGraph,
): sanitizeHtml.IOptions {
  const assetByPath = new Map(
    graph.nodes
      .filter((node) => node.kind === "asset")
      .map((node) => [node.sourcePath, node]),
  );

  return {
    allowedTags: [
      "article",
      "header",
      "footer",
      "section",
      "div",
      "aside",
      "details",
      "summary",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "s",
      "blockquote",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "dl",
      "dt",
      "dd",
      "small",
      "input",
    ],
    allowedAttributes: {
      article: ["class", "data-source-id"],
      p: ["class"],
      div: ["class"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      input: ["type", "checked", "disabled"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      img: (_tagName, attributes) => {
        const source = attributes["src"];
        if (!source || /^[A-Za-z][A-Za-z\d+.-]*:/.test(source)) {
          return {
            tagName: "img",
            attribs: attributes,
          };
        }

        const resolvedPath = resolveRelativePath(sourceNode.sourcePath, source);
        const dataUrl = resolvedPath
          ? assetByPath.get(resolvedPath)?.metadata["dataUrl"]
          : undefined;

        return {
          tagName: "img",
          attribs: {
            ...attributes,
            ...(typeof dataUrl === "string" ? { src: dataUrl } : {}),
          },
        };
      },
    },
  };
}

function resolveRelativePath(
  sourcePath: string,
  target: string,
): string | undefined {
  const withoutFragment = target.split("#", 1)[0]?.split("?", 1)[0];
  if (!withoutFragment) {
    return undefined;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }

  const sourceFile = sourcePath.split("#", 1)[0] ?? sourcePath;
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(sourceFile), decoded))
    .replaceAll("\\", "/");
}
