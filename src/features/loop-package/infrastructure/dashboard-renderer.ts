import type { MigrationPlan } from "../../compatibility-analysis/domain/migration-plan.js";
import type { CanonicalWorkspaceGraph } from "../../workspace-ingestion/domain/canonical-graph.js";
import type { RenderedMigrationItem } from "../domain/migration-package.js";
import { escapeHtml, safeJsonForHtml } from "./html-utils.js";

export function renderDashboard(
  graph: CanonicalWorkspaceGraph,
  plan: MigrationPlan,
  renderedItems: readonly RenderedMigrationItem[],
): string {
  const dashboardData = {
    graph: {
      workspaceId: graph.workspaceId,
      title: graph.title,
      generatedAt: graph.generatedAt,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        parentId: node.parentId ?? null,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        from: edge.from,
        to: edge.to,
      })),
    },
    plan,
    renderedItems,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(graph.title)} - Notion2Loop Migration Studio</title>
  <style>
    :root {
      --bg: #07111f;
      --surface: rgba(15, 30, 50, 0.82);
      --surface-strong: #10233a;
      --line: rgba(148, 163, 184, 0.18);
      --text: #edf6ff;
      --muted: #94a8bd;
      --purple: #a78bfa;
      --blue: #38bdf8;
      --green: #34d399;
      --amber: #fbbf24;
      --red: #fb7185;
      --shadow: 0 30px 80px rgba(0, 0, 0, 0.32);
      font-family: Inter, "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at 8% 0%, rgba(124, 58, 237, 0.23), transparent 33rem),
        radial-gradient(circle at 92% 6%, rgba(14, 165, 233, 0.18), transparent 30rem),
        linear-gradient(160deg, #07111f 0%, #091827 48%, #07111f 100%);
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .shell { width: min(1440px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 80px; }
    .topbar {
      position: sticky; top: 16px; z-index: 20;
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      padding: 14px 18px; border: 1px solid var(--line); border-radius: 18px;
      background: rgba(7, 17, 31, 0.78); backdrop-filter: blur(20px); box-shadow: var(--shadow);
    }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: -0.03em; }
    .brand-mark {
      display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px;
      background: linear-gradient(135deg, #8b5cf6, #0ea5e9); box-shadow: 0 12px 30px rgba(56, 189, 248, 0.25);
    }
    .brand-mark svg { width: 22px; }
    .nav { display: flex; gap: 6px; flex-wrap: wrap; }
    .nav button {
      border: 0; border-radius: 10px; padding: 9px 12px; color: var(--muted); background: transparent;
    }
    .nav button:hover, .nav button.active { color: var(--text); background: rgba(148, 163, 184, 0.12); }
    .hero {
      display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr); gap: 30px;
      align-items: end; padding: 86px 12px 38px;
    }
    .eyebrow { color: var(--blue); text-transform: uppercase; letter-spacing: .16em; font-size: 12px; font-weight: 800; }
    h1 { margin: 14px 0 18px; max-width: 900px; font-size: clamp(42px, 7vw, 84px); line-height: .94; letter-spacing: -.065em; }
    .hero p { max-width: 760px; margin: 0; color: var(--muted); font-size: 18px; line-height: 1.65; }
    .score-card {
      display: flex; align-items: center; gap: 22px; padding: 24px;
      border: 1px solid var(--line); border-radius: 24px; background: var(--surface); box-shadow: var(--shadow);
    }
    .score-ring {
      --score: 0;
      position: relative; display: grid; place-items: center; flex: 0 0 126px; height: 126px; border-radius: 50%;
      background: conic-gradient(var(--green) calc(var(--score) * 1%), rgba(148,163,184,.14) 0);
    }
    .score-ring::before { content: ""; position: absolute; inset: 12px; border-radius: 50%; background: #0d1d30; }
    .score-ring strong { position: relative; font-size: 34px; letter-spacing: -.05em; }
    .score-copy small { display: block; color: var(--muted); margin-top: 8px; line-height: 1.5; }
    .grid { display: grid; gap: 18px; }
    .metrics { grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 20px 0 36px; }
    .metric, .panel {
      border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow);
    }
    .metric { padding: 20px; }
    .metric span { display: block; color: var(--muted); font-size: 13px; }
    .metric strong { display: block; margin-top: 8px; font-size: 30px; letter-spacing: -.04em; }
    .metric.native strong { color: var(--green); }
    .metric.transformed strong { color: var(--blue); }
    .metric.manual strong { color: var(--amber); }
    .metric.blocked strong { color: var(--red); }
    .section { display: none; animation: reveal .28s ease; }
    .section.active { display: block; }
    @keyframes reveal { from { opacity: 0; transform: translateY(8px); } }
    .section-head {
      display: flex; align-items: end; justify-content: space-between; gap: 20px; margin: 44px 0 16px;
    }
    .section-head h2 { margin: 0; font-size: 30px; letter-spacing: -.04em; }
    .section-head p { margin: 6px 0 0; color: var(--muted); }
    .panel { padding: 22px; overflow: hidden; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .filter {
      border: 1px solid var(--line); border-radius: 999px; padding: 8px 13px;
      color: var(--muted); background: rgba(15, 35, 58, .7);
    }
    .filter.active { color: #06111f; background: var(--text); border-color: var(--text); }
    .table-scroll { overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 720px; }
    th, td { padding: 15px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    td { font-size: 14px; }
    tr:last-child td { border-bottom: 0; }
    .badge {
      display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px;
      font-size: 12px; font-weight: 700; text-transform: capitalize;
    }
    .badge::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .badge.native { color: var(--green); background: rgba(52, 211, 153, .11); }
    .badge.transformed { color: var(--blue); background: rgba(56, 189, 248, .11); }
    .badge.manual { color: var(--amber); background: rgba(251, 191, 36, .11); }
    .badge.blocked { color: var(--red); background: rgba(251, 113, 133, .11); }
    .target { color: var(--purple); }
    .preview-layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 18px; min-height: 680px; }
    .preview-list { max-height: 680px; overflow: auto; padding: 8px; }
    .preview-button {
      width: 100%; border: 0; border-radius: 14px; padding: 13px; margin-bottom: 6px;
      color: var(--text); background: transparent; text-align: left;
    }
    .preview-button:hover, .preview-button.active { background: rgba(148, 163, 184, .11); }
    .preview-button strong, .preview-button small { display: block; }
    .preview-button small { margin-top: 5px; color: var(--muted); }
    .preview-stage { padding: 0; background: #f8fafc; color: #172033; }
    .preview-toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 18px; color: var(--text); background: #11243b;
    }
    .copy-button {
      border: 0; border-radius: 10px; padding: 9px 13px; color: #07111f;
      background: linear-gradient(135deg, #a7f3d0, #7dd3fc); font-weight: 800;
    }
    .copy-button.copied { background: var(--green); }
    .loop-preview { padding: 38px; overflow: auto; max-height: 625px; }
    .loop-preview .loop-content { max-width: 900px; margin: 0 auto; line-height: 1.6; }
    .loop-preview h1 { margin: 8px 0 24px; font-size: 38px; line-height: 1.1; letter-spacing: -.04em; }
    .loop-preview h2 { margin-top: 32px; }
    .loop-preview .migration-eyebrow { color: #2563eb; font-size: 11px; text-transform: uppercase; letter-spacing: .12em; font-weight: 800; }
    .loop-preview img { max-width: 100%; height: auto; border-radius: 12px; }
    .loop-preview pre { padding: 16px; overflow: auto; border-radius: 12px; background: #e2e8f0; }
    .loop-preview blockquote, .loop-preview aside { margin: 18px 0; padding: 14px 18px; border-left: 4px solid #8b5cf6; background: #ede9fe; }
    .loop-preview table { min-width: 560px; }
    .loop-preview th, .loop-preview td { border: 1px solid #cbd5e1; padding: 10px; }
    .loop-preview footer { margin-top: 32px; color: #64748b; }
    .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .issue-card, .agent-card { padding: 18px; border: 1px solid var(--line); border-radius: 16px; background: rgba(8, 22, 39, .62); }
    .issue-card h3, .agent-card h3 { margin: 10px 0 8px; font-size: 17px; }
    .issue-card p, .agent-card p { margin: 0; color: var(--muted); line-height: 1.55; }
    .severity { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }
    .severity.high { color: var(--red); } .severity.medium { color: var(--amber); } .severity.low { color: var(--green); }
    .agent-meta { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .agent-meta code { padding: 5px 8px; border-radius: 8px; color: var(--blue); background: rgba(56,189,248,.09); }
    .graph-panel { min-height: 680px; }
    #graphSvg { width: 100%; height: 640px; }
    .graph-edge { stroke: rgba(148, 163, 184, .28); stroke-width: 1.4; }
    .graph-node rect { stroke: rgba(255,255,255,.18); stroke-width: 1; }
    .graph-node text { fill: white; font-size: 11px; pointer-events: none; }
    .graph-node.workspace rect { fill: #7c3aed; }
    .graph-node.page rect { fill: #2563eb; }
    .graph-node.database rect { fill: #0891b2; }
    .graph-node.database_row rect { fill: #0f766e; }
    .graph-node.asset rect { fill: #475569; }
    .empty { padding: 50px 20px; text-align: center; color: var(--muted); }
    @media (max-width: 1000px) {
      .hero { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .preview-layout { grid-template-columns: 1fr; }
      .preview-list { max-height: 260px; }
      .cards { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .shell { width: min(100% - 22px, 1440px); }
      .topbar { position: static; align-items: flex-start; flex-direction: column; }
      .hero { padding-top: 54px; }
      .metrics { grid-template-columns: 1fr; }
      .score-card { align-items: flex-start; flex-direction: column; }
      .loop-preview { padding: 22px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M5 18V6l7 4 7-4v12l-7-4-7 4Z" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>
        </span>
        Notion2Loop Migration Studio
      </div>
      <div class="nav" aria-label="Dashboard sections">
        <button class="active" data-section="overview">Overview</button>
        <button data-section="content">Loop preview</button>
        <button data-section="issues">Issues</button>
        <button data-section="agents">Agent tasks</button>
        <button data-section="graph">Graph</button>
      </div>
    </nav>

    <header class="hero">
      <div>
        <div class="eyebrow">Migration dry run</div>
        <h1>${escapeHtml(graph.title)}</h1>
        <p>A deterministic compatibility scan of pages, databases, relations, assets, and risky content. Review every transformation before inserting anything into Microsoft Loop.</p>
      </div>
      <div class="score-card">
        <div class="score-ring" id="scoreRing"><strong id="scoreValue">0</strong></div>
        <div class="score-copy">
          <strong>Estimated fidelity</strong>
          <small>Semantic preservation across source items and relationship edges.</small>
        </div>
      </div>
    </header>

    <section class="section active" id="overview">
      <div class="grid metrics" id="metrics"></div>
      <div class="section-head">
        <div><h2>Migration inventory</h2><p>Filter every planned target by fidelity class.</p></div>
        <div class="filters" id="statusFilters"></div>
      </div>
      <div class="panel table-scroll">
        <table>
          <thead><tr><th>Source</th><th>Kind</th><th>Status</th><th>Target</th><th>Approval</th><th>Reason</th></tr></thead>
          <tbody id="inventoryRows"></tbody>
        </table>
      </div>
    </section>

    <section class="section" id="content">
      <div class="section-head">
        <div><h2>Loop-ready content</h2><p>Sanitized rich HTML with source identity preserved.</p></div>
      </div>
      <div class="preview-layout">
        <div class="panel preview-list" id="previewList"></div>
        <div class="panel preview-stage">
          <div class="preview-toolbar">
            <span id="previewTitle">Select an item</span>
            <button class="copy-button" id="copyButton" disabled>Copy for Loop</button>
          </div>
          <div class="loop-preview" id="loopPreview"><div class="empty">Choose a page or database to preview.</div></div>
        </div>
      </div>
    </section>

    <section class="section" id="issues">
      <div class="section-head"><div><h2>Fidelity and security issues</h2><p>No unsupported item is silently discarded.</p></div></div>
      <div class="grid cards" id="issueCards"></div>
    </section>

    <section class="section" id="agents">
      <div class="section-head"><div><h2>Provider-neutral agent queue</h2><p>Structured tasks can be sent to Claude or GPT only after approval.</p></div></div>
      <div class="grid cards" id="agentCards"></div>
    </section>

    <section class="section" id="graph">
      <div class="section-head"><div><h2>Canonical workspace graph</h2><p>Stable source identities and typed edges drive the two-pass migration.</p></div></div>
      <div class="panel graph-panel"><svg id="graphSvg" role="img" aria-label="Workspace relationship graph"></svg></div>
    </section>
  </main>

  <script id="dashboardData" type="application/json">${safeJsonForHtml(dashboardData)}</script>
  <script>
    const data = JSON.parse(document.getElementById("dashboardData").textContent);
    const statusOrder = ["native", "transformed", "manual", "blocked"];
    const state = { status: "all", selectedSourceId: null };

    function text(element, value) {
      element.textContent = value == null ? "" : String(value);
      return element;
    }

    function create(tag, className) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      return element;
    }

    function initializeNavigation() {
      document.querySelectorAll(".nav button").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelectorAll(".nav button").forEach((item) => item.classList.remove("active"));
          document.querySelectorAll(".section").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
          document.getElementById(button.dataset.section).classList.add("active");
          if (button.dataset.section === "graph") renderGraph();
        });
      });
    }

    function renderSummary() {
      const summary = data.plan.summary;
      document.getElementById("scoreRing").style.setProperty("--score", summary.fidelityScore);
      text(document.getElementById("scoreValue"), summary.fidelityScore + "%");
      const definitions = [
        ["Total items", summary.totalItems, ""],
        ["Native", summary.native, "native"],
        ["Transformed", summary.transformed, "transformed"],
        ["Manual", summary.manual, "manual"],
        ["Blocked", summary.blocked, "blocked"],
      ];
      const metrics = document.getElementById("metrics");
      definitions.forEach(([label, value, className]) => {
        const card = create("div", "metric " + className);
        card.append(text(create("span"), label));
        card.append(text(create("strong"), value));
        metrics.append(card);
      });
    }

    function renderFilters() {
      const container = document.getElementById("statusFilters");
      ["all", ...statusOrder].forEach((status) => {
        const button = text(create("button", "filter" + (status === "all" ? " active" : "")), status);
        button.addEventListener("click", () => {
          state.status = status;
          container.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
          button.classList.add("active");
          renderInventory();
        });
        container.append(button);
      });
    }

    function renderInventory() {
      const body = document.getElementById("inventoryRows");
      body.replaceChildren();
      data.plan.items
        .filter((item) => state.status === "all" || item.status === state.status)
        .forEach((item) => {
          const row = document.createElement("tr");
          row.append(text(document.createElement("td"), item.title));
          row.append(text(document.createElement("td"), item.sourceKind.replaceAll("_", " ")));
          const statusCell = document.createElement("td");
          statusCell.append(text(create("span", "badge " + item.status), item.status));
          row.append(statusCell);
          row.append(text(create("td", "target"), item.targetKind.replaceAll("_", " ")));
          row.append(text(document.createElement("td"), item.approvalRequired ? "Required" : "No"));
          row.append(text(document.createElement("td"), item.reasons[0]));
          body.append(row);
        });
    }

    function renderPreviews() {
      const list = document.getElementById("previewList");
      data.renderedItems.forEach((item, index) => {
        const button = create("button", "preview-button");
        button.dataset.sourceId = item.sourceId;
        button.append(text(document.createElement("strong"), item.title));
        button.append(text(document.createElement("small"), item.targetKind.replaceAll("_", " ") + " - " + item.status));
        button.addEventListener("click", () => selectPreview(item.sourceId));
        list.append(button);
        if (index === 0) selectPreview(item.sourceId);
      });
    }

    function selectPreview(sourceId) {
      const item = data.renderedItems.find((candidate) => candidate.sourceId === sourceId);
      if (!item) return;
      state.selectedSourceId = sourceId;
      document.querySelectorAll(".preview-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.sourceId === sourceId);
      });
      text(document.getElementById("previewTitle"), item.title);
      document.getElementById("loopPreview").innerHTML = item.html;
      document.getElementById("copyButton").disabled = false;
    }

    async function copySelectedPreview() {
      const item = data.renderedItems.find((candidate) => candidate.sourceId === state.selectedSourceId);
      if (!item) return;
      const button = document.getElementById("copyButton");
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([item.html], { type: "text/html" }),
              "text/plain": new Blob([item.plainText], { type: "text/plain" }),
            }),
          ]);
        } else {
          const container = create("div");
          container.contentEditable = "true";
          container.style.position = "fixed";
          container.style.left = "-10000px";
          container.innerHTML = item.html;
          document.body.append(container);
          const range = document.createRange();
          range.selectNodeContents(container);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand("copy");
          selection.removeAllRanges();
          container.remove();
        }
        button.classList.add("copied");
        text(button, "Copied");
        setTimeout(() => { button.classList.remove("copied"); text(button, "Copy for Loop"); }, 1400);
      } catch (error) {
        text(button, "Copy failed");
        console.error(error);
      }
    }

    function renderIssues() {
      const container = document.getElementById("issueCards");
      if (data.plan.issues.length === 0) {
        container.append(text(create("div", "empty"), "No issues detected."));
        return;
      }
      data.plan.issues.forEach((issue) => {
        const card = create("article", "issue-card");
        card.append(text(create("span", "severity " + issue.severity), issue.severity));
        card.append(text(document.createElement("h3"), issue.message));
        card.append(text(document.createElement("p"), issue.recommendation));
        container.append(card);
      });
    }

    function renderAgents() {
      const container = document.getElementById("agentCards");
      data.plan.agentTasks.forEach((task) => {
        const card = create("article", "agent-card");
        card.append(text(create("span", "severity " + task.risk), task.risk + " risk"));
        card.append(text(document.createElement("h3"), task.title));
        card.append(text(document.createElement("p"), task.objective));
        const meta = create("div", "agent-meta");
        meta.append(text(document.createElement("code"), task.taskType));
        meta.append(text(document.createElement("code"), task.trustBoundary));
        meta.append(text(document.createElement("code"), "approval required"));
        card.append(meta);
        container.append(card);
      });
    }

    function renderGraph() {
      const svg = document.getElementById("graphSvg");
      if (svg.dataset.rendered) return;
      svg.dataset.rendered = "true";
      const width = Math.max(svg.clientWidth, 900);
      const height = 640;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      const groups = {
        workspace: data.graph.nodes.filter((node) => node.kind === "workspace"),
        containers: data.graph.nodes.filter((node) => node.kind === "page" || node.kind === "database"),
        rows: data.graph.nodes.filter((node) => node.kind === "database_row"),
        assets: data.graph.nodes.filter((node) => node.kind === "asset"),
      };
      const positions = new Map();
      place(groups.workspace, 90, height / 2, 0, positions);
      place(groups.containers, width * .34, 80, 105, positions);
      place(groups.rows, width * .65, 55, 82, positions);
      place(groups.assets, width * .9, height / 2, 0, positions);

      data.graph.edges.forEach((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", from.x + 70);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", to.x - 70);
        line.setAttribute("y2", to.y);
        line.setAttribute("class", "graph-edge");
        svg.append(line);
      });

      data.graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (!position) return;
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "graph-node " + node.kind);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", position.x - 70);
        rect.setAttribute("y", position.y - 24);
        rect.setAttribute("width", 140);
        rect.setAttribute("height", 48);
        rect.setAttribute("rx", 12);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", position.x);
        label.setAttribute("y", position.y + 4);
        label.setAttribute("text-anchor", "middle");
        label.textContent = node.title.length > 19 ? node.title.slice(0, 18) + "..." : node.title;
        group.append(rect, label);
        svg.append(group);
      });
    }

    function place(nodes, x, startY, gap, positions) {
      const effectiveGap = gap || 0;
      const origin = effectiveGap ? startY : startY - ((nodes.length - 1) * effectiveGap) / 2;
      nodes.forEach((node, index) => positions.set(node.id, { x, y: origin + index * effectiveGap }));
    }

    initializeNavigation();
    renderSummary();
    renderFilters();
    renderInventory();
    renderPreviews();
    renderIssues();
    renderAgents();
    document.getElementById("copyButton").addEventListener("click", copySelectedPreview);
  </script>
</body>
</html>`;
}
