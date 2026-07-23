export const LOCAL_APP_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Notion2Loop 로컬 연결 마법사</title>
  <link rel="stylesheet" href="/assets/local-app.css">
  <script type="module" src="/assets/local-app.js"></script>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Notion2Loop 로컬 연결 마법사 홈">
        <span class="brand-mark" aria-hidden="true">N2L</span>
        <span>Notion2Loop <small>Local</small></span>
      </a>
      <span class="local-badge">127.0.0.1 전용</span>
    </header>

    <div class="error" role="alert" data-error hidden></div>

    <section class="landing" data-view="landing">
      <p class="eyebrow">LOCAL CONNECTION WIZARD</p>
      <h1>복잡한 이전도<br>한 단계씩 준비하세요.</h1>
      <p class="lead">Notion 입력과 Microsoft 365 대상을 안전하게 정리한 뒤, 분석과 사람의 승인을 거쳐 배포하는 흐름을 안내합니다.</p>
      <button class="primary large" type="button" data-action="start-session">시작</button>
      <div class="scope-note">
        <strong>이번 기반 단계의 범위</strong>
        <span>연결 정보 안내·검증·메모리 저장만 수행합니다. ZIP 내용, Notion API, Microsoft Graph, 실제 배포는 실행하지 않습니다.</span>
      </div>
    </section>

    <section class="wizard" data-view="wizard" hidden>
      <ol class="stepper" aria-label="연결 설정 단계">
        <li data-step-indicator="0" aria-current="step"><span>1</span>Source</li>
        <li data-step-indicator="1"><span>2</span>Notion</li>
        <li data-step-indicator="2"><span>3</span>Microsoft</li>
        <li data-step-indicator="3"><span>4</span>Target</li>
        <li data-step-indicator="4"><span>5</span>흐름 확인</li>
      </ol>

      <form data-form="connection-setup" autocomplete="off" novalidate>
        <section class="step-card" data-step="source" data-step-index="0">
          <p class="eyebrow">STEP 1</p>
          <h2>어디에서 가져올까요?</h2>
          <p class="description">이번에는 한 가지 source를 고릅니다. 실제 수집과 분석은 후속 단계에서 연결됩니다.</p>
          <div class="choice-grid">
            <label class="choice">
              <input type="radio" name="sourceKind" value="zip" checked>
              <span><strong>Notion ZIP</strong><small>로컬 내보내기 파일</small></span>
            </label>
            <label class="choice">
              <input type="radio" name="sourceKind" value="notion_api">
              <span><strong>Notion API</strong><small>읽기 전용 연결 준비</small></span>
            </label>
          </div>
          <div class="field" data-zip-fields>
            <label for="zip-file">Notion ZIP 파일</label>
            <input id="zip-file" type="file" accept=".zip,application/zip">
            <small>파일 이름과 크기만 서버 메모리로 전달합니다. ZIP 바이트는 업로드하거나 분석하지 않습니다.</small>
          </div>
        </section>

        <section class="step-card" data-step="notion" data-step-index="1" hidden>
          <p class="eyebrow">STEP 2</p>
          <h2>Notion 연결을 준비합니다.</h2>
          <p class="description">토큰은 Notion이 허용한 페이지를 읽는 비밀 열쇠입니다. 이 앱은 값을 프로세스 메모리에만 두고 화면·로그·파일로 다시 내보내지 않습니다.</p>
          <div data-notion-api-fields hidden>
            <div class="field">
              <label for="notion-token">Notion integration token</label>
              <input id="notion-token" type="password" autocomplete="new-password" spellcheck="false">
            </div>
            <div class="field-row">
              <div class="field">
                <label for="notion-root-kind">Root 종류</label>
                <select id="notion-root-kind">
                  <option value="page">Page</option>
                  <option value="database">Database</option>
                </select>
              </div>
              <div class="field grow">
                <label for="notion-root-id">Root page/database ID</label>
                <input id="notion-root-id" type="text" autocomplete="off" spellcheck="false" placeholder="32자리 Notion ID">
              </div>
            </div>
          </div>
          <div class="info" data-zip-notion-note>
            ZIP source에는 토큰이 필요하지 않습니다. 관계 ID와 최신 schema를 보강하는 Notion API 연결은 후속 PR에서 함께 사용할 수 있습니다.
          </div>
        </section>

        <section class="step-card" data-step="microsoft" data-step-index="2" hidden>
          <p class="eyebrow">STEP 3</p>
          <h2>Microsoft 연결 정보를 확인합니다.</h2>
          <p class="description">Tenant ID는 조직의 Microsoft Entra 디렉터리 ID이고, Client ID는 이 마이그레이션 앱의 등록 ID입니다.</p>
          <div class="field-row">
            <div class="field grow">
              <label for="tenant-id">Tenant ID</label>
              <input id="tenant-id" type="text" autocomplete="off" spellcheck="false" placeholder="00000000-0000-0000-0000-000000000000">
            </div>
            <div class="field grow">
              <label for="client-id">Client ID</label>
              <input id="client-id" type="text" autocomplete="off" spellcheck="false" placeholder="00000000-0000-0000-0000-000000000000">
            </div>
          </div>
          <div class="info">
            <strong>delegated login 예정</strong>
            사용자가 직접 로그인하고 권한 동의한 범위 안에서만 Microsoft Graph가 Lists, SharePoint, Planner에 접근하는 방식입니다. 이번 PR은 로그인이나 권한 요청을 실행하지 않습니다.
          </div>
        </section>

        <section class="step-card" data-step="target" data-step-index="3" hidden>
          <p class="eyebrow">STEP 4</p>
          <h2>어디에 배치할까요?</h2>
          <p class="description">하나 이상 고를 수 있습니다. 실제 분석 결과에 따라 항목별 대상이 달라질 수 있습니다.</p>
          <div class="choice-grid targets">
            <label class="choice">
              <input type="checkbox" name="target" value="lists">
              <span><strong>Microsoft Lists</strong><small>구조화된 표와 속성</small></span>
            </label>
            <label class="choice">
              <input type="checkbox" name="target" value="sharepoint">
              <span><strong>SharePoint</strong><small>문서와 첨부 파일</small></span>
            </label>
            <label class="choice">
              <input type="checkbox" name="target" value="planner">
              <span><strong>Planner</strong><small>작업과 일정</small></span>
            </label>
          </div>
        </section>

        <section class="step-card" data-step="flow" data-step-index="4" hidden>
          <p class="eyebrow">STEP 5</p>
          <h2>설정 다음의 흐름입니다.</h2>
          <div class="flow">
            <article><span>1</span><div><strong>분석</strong><p>결정적 규칙으로 구조, 관계, 지원 수준을 확인합니다.</p></div></article>
            <article><span>2</span><div><strong>검토·승인</strong><p>손실 가능성과 변환 대상을 사람이 확인하고 승인합니다.</p></div></article>
            <article><span>3</span><div><strong>배포</strong><p>승인된 항목만 Lists, SharePoint, Planner adapter로 전달합니다.</p></div></article>
          </div>
          <div class="scope-note compact">
            <strong>아직 실행되지 않습니다.</strong>
            <span>이번 저장은 연결 설정만 완료합니다. ZIP 내용이나 Notion 데이터는 아직 획득하지 않았습니다.</span>
          </div>
        </section>

        <div class="form-actions">
          <button class="secondary" type="button" data-action="previous-step">이전</button>
          <button class="primary" type="button" data-action="next-step">다음</button>
          <button class="primary" type="submit" data-action="save-configuration" hidden>설정 저장</button>
        </div>
      </form>

      <section class="summary" data-summary hidden>
        <p class="eyebrow">SESSION MEMORY</p>
        <h2>연결 설정이 저장되었습니다.</h2>
        <p>민감한 token 값은 표시하지 않습니다. 분석 입력 데이터는 아직 없으며 분석과 배포도 시작되지 않았습니다.</p>
        <pre data-summary-content></pre>
        <div class="summary-actions">
          <button class="secondary" type="button" data-action="clear-token">Notion 토큰 지우기</button>
          <button class="danger" type="button" data-action="end-session">세션 종료 및 모두 삭제</button>
        </div>
      </section>
    </section>
  </main>
</body>
</html>`;

export const LOCAL_APP_CSS = `
:root {
  --bg: #07111f;
  --panel: rgba(14, 29, 49, .9);
  --panel-strong: #10243d;
  --line: rgba(148, 163, 184, .22);
  --text: #f1f7ff;
  --muted: #9bb0c7;
  --blue: #38bdf8;
  --purple: #a78bfa;
  --green: #34d399;
  --red: #fb7185;
  font-family: Inter, "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 12% 0%, rgba(124, 58, 237, .26), transparent 34rem),
    radial-gradient(circle at 90% 8%, rgba(14, 165, 233, .2), transparent 30rem),
    linear-gradient(155deg, #06101c, #0a1a2b 52%, #07111f);
}
button, input, select { font: inherit; }
button { cursor: pointer; }
.shell { width: min(1100px, calc(100% - 32px)); margin: auto; padding: 24px 0 72px; }
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 14px 18px; border: 1px solid var(--line); border-radius: 18px;
  background: rgba(7, 17, 31, .78); backdrop-filter: blur(18px);
}
.brand { display: flex; align-items: center; gap: 12px; color: var(--text); font-weight: 800; text-decoration: none; }
.brand small { color: var(--blue); }
.brand-mark {
  display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px;
  background: linear-gradient(135deg, #7c3aed, #0ea5e9); font-size: 11px;
}
.local-badge { padding: 7px 11px; border: 1px solid rgba(52, 211, 153, .35); border-radius: 999px; color: #a7f3d0; background: rgba(6, 78, 59, .25); font-size: 12px; }
.landing { padding: 100px 12px 20px; }
.eyebrow { margin: 0 0 12px; color: var(--blue); font-size: 12px; font-weight: 800; letter-spacing: .15em; }
h1 { margin: 0; font-size: clamp(48px, 8vw, 88px); line-height: .96; letter-spacing: -.065em; }
h2 { margin: 0 0 12px; font-size: clamp(28px, 4vw, 42px); letter-spacing: -.04em; }
.lead, .description { max-width: 760px; color: var(--muted); line-height: 1.7; }
.lead { margin: 28px 0; font-size: 18px; }
.primary, .secondary, .danger {
  border: 0; border-radius: 12px; padding: 12px 18px; font-weight: 800;
}
.primary { color: #06111f; background: linear-gradient(135deg, #a7f3d0, #7dd3fc); }
.primary.large { min-width: 160px; padding: 15px 24px; font-size: 17px; }
.secondary { color: var(--text); background: rgba(148, 163, 184, .14); }
.danger { color: #fff1f2; background: rgba(190, 24, 93, .72); }
.scope-note, .info {
  display: grid; gap: 7px; margin-top: 28px; padding: 18px 20px; border: 1px solid var(--line);
  border-radius: 16px; color: var(--muted); background: rgba(15, 35, 58, .62); line-height: 1.55;
}
.scope-note { max-width: 820px; }
.scope-note strong, .info strong { color: var(--text); }
.scope-note.compact { margin-top: 22px; }
.wizard { padding-top: 34px; }
.stepper {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 0 0 22px; padding: 0; list-style: none;
}
.stepper li {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px;
  border: 1px solid var(--line); border-radius: 12px; color: var(--muted); font-size: 12px;
}
.stepper li span { display: grid; place-items: center; flex: 0 0 25px; height: 25px; border-radius: 50%; background: rgba(148, 163, 184, .14); }
.stepper li[aria-current="step"] { color: var(--text); border-color: rgba(56, 189, 248, .65); background: rgba(14, 165, 233, .12); }
.stepper li[aria-current="step"] span { color: #07111f; background: var(--blue); }
.error { margin: 18px 0 0; padding: 14px 16px; border: 1px solid rgba(251, 113, 133, .5); border-radius: 12px; color: #fecdd3; background: rgba(136, 19, 55, .35); }
.step-card, .summary {
  min-height: 440px; padding: clamp(24px, 5vw, 52px); border: 1px solid var(--line);
  border-radius: 24px; background: var(--panel); box-shadow: 0 28px 80px rgba(0, 0, 0, .3);
}
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 26px; }
.choice-grid.targets { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.choice {
  display: flex; align-items: center; gap: 12px; padding: 18px; border: 1px solid var(--line);
  border-radius: 16px; background: rgba(8, 24, 42, .65);
}
.choice:has(input:checked) { border-color: var(--blue); background: rgba(14, 165, 233, .12); }
.choice input { accent-color: var(--blue); }
.choice strong, .choice small { display: block; }
.choice small { margin-top: 5px; color: var(--muted); }
.field { display: grid; gap: 8px; margin-top: 24px; }
.field.grow { flex: 1; }
.field-row { display: flex; gap: 16px; }
.field label { font-weight: 700; }
.field small { color: var(--muted); line-height: 1.5; }
.field input, .field select {
  width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 13px 14px;
  color: var(--text); background: #071625;
}
.field input:focus, .field select:focus { outline: 2px solid var(--blue); outline-offset: 1px; }
.form-actions { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; }
.flow { display: grid; gap: 12px; margin-top: 24px; }
.flow article { display: flex; gap: 16px; padding: 16px; border: 1px solid var(--line); border-radius: 15px; background: rgba(8, 24, 42, .65); }
.flow article > span { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border-radius: 10px; color: #07111f; background: var(--green); font-weight: 900; }
.flow p { margin: 5px 0 0; color: var(--muted); }
.summary { min-height: 0; margin-top: 22px; }
.summary pre { overflow: auto; padding: 18px; border: 1px solid var(--line); border-radius: 14px; color: #c4f1ff; background: #06101c; line-height: 1.55; }
.summary-actions { display: flex; gap: 12px; flex-wrap: wrap; }
@media (max-width: 760px) {
  .stepper { grid-template-columns: 1fr; }
  .stepper li:not([aria-current="step"]) { display: none; }
  .choice-grid, .choice-grid.targets { grid-template-columns: 1fr; }
  .field-row { flex-direction: column; gap: 0; }
  .landing { padding-top: 64px; }
  .local-badge { display: none; }
}
`;

export const LOCAL_APP_SCRIPT = String.raw`
const API = "/api/v1/connection-session";
const landing = document.querySelector('[data-view="landing"]');
const wizard = document.querySelector('[data-view="wizard"]');
const form = document.querySelector('[data-form="connection-setup"]');
const steps = Array.from(document.querySelectorAll("[data-step-index]"));
const indicators = Array.from(document.querySelectorAll("[data-step-indicator]"));
const errorBox = document.querySelector("[data-error]");
const previousButton = document.querySelector('[data-action="previous-step"]');
const nextButton = document.querySelector('[data-action="next-step"]');
const saveButton = document.querySelector('[data-action="save-configuration"]');
const summary = document.querySelector("[data-summary]");
const summaryContent = document.querySelector("[data-summary-content]");
const notionTokenInput = document.getElementById("notion-token");
const zipInput = document.getElementById("zip-file");
let currentStep = 0;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

function showStep(index) {
  currentStep = Math.max(0, Math.min(index, steps.length - 1));
  steps.forEach(function (step, stepIndex) {
    step.hidden = stepIndex !== currentStep;
  });
  indicators.forEach(function (indicator, stepIndex) {
    if (stepIndex === currentStep) {
      indicator.setAttribute("aria-current", "step");
    } else {
      indicator.removeAttribute("aria-current");
    }
  });
  previousButton.hidden = currentStep === 0;
  nextButton.hidden = currentStep === steps.length - 1;
  saveButton.hidden = currentStep !== steps.length - 1;
  clearError();
}

function selectedSourceKind() {
  const selected = form.querySelector('input[name="sourceKind"]:checked');
  return selected ? selected.value : "zip";
}

function updateSourceFields() {
  const apiSelected = selectedSourceKind() === "notion_api";
  document.querySelector("[data-zip-fields]").hidden = apiSelected;
  document.querySelector("[data-notion-api-fields]").hidden = !apiSelected;
  document.querySelector("[data-zip-notion-note]").hidden = apiSelected;
}

function validateCurrentStep() {
  if (currentStep === 0 && selectedSourceKind() === "zip" && !zipInput.files[0]) {
    showError("Notion ZIP 파일을 선택해 주세요. 파일 내용은 전송하지 않습니다.");
    return false;
  }
  if (currentStep === 1 && selectedSourceKind() === "notion_api") {
    if (!notionTokenInput.value || !document.getElementById("notion-root-id").value) {
      showError("Notion token과 root page/database ID를 입력해 주세요.");
      return false;
    }
  }
  if (currentStep === 2) {
    if (!document.getElementById("tenant-id").value || !document.getElementById("client-id").value) {
      showError("Tenant ID와 Client ID를 모두 입력해 주세요.");
      return false;
    }
  }
  if (currentStep === 3 && form.querySelectorAll('input[name="target"]:checked').length === 0) {
    showError("Lists, SharePoint, Planner 중 하나 이상 선택해 주세요.");
    return false;
  }
  return true;
}

function buildConfiguration() {
  let source;
  if (selectedSourceKind() === "zip") {
    const file = zipInput.files[0];
    source = {
      kind: "zip",
      file: { name: file.name, sizeBytes: file.size }
    };
  } else {
    source = {
      kind: "notion_api",
      notionToken: notionTokenInput.value,
      root: {
        kind: document.getElementById("notion-root-kind").value,
        id: document.getElementById("notion-root-id").value
      }
    };
  }
  return {
    source: source,
    microsoft: {
      tenantId: document.getElementById("tenant-id").value,
      clientId: document.getElementById("client-id").value
    },
    targets: Array.from(form.querySelectorAll('input[name="target"]:checked')).map(function (input) {
      return input.value;
    })
  };
}

async function request(path, options) {
  const response = await fetch(API + path, Object.assign({ credentials: "same-origin" }, options));
  if (response.status === 204) {
    return null;
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error("서버가 올바른 응답을 반환하지 않았습니다.");
  }
  if (!response.ok) {
    const details = body && body.error && Array.isArray(body.error.fields)
      ? body.error.fields.map(function (field) { return field.path + ": " + field.message; }).join(" / ")
      : "";
    throw new Error((body && body.error && body.error.message ? body.error.message : "요청에 실패했습니다.") + (details ? " " + details : ""));
  }
  return body;
}

function renderSummary(value) {
  summaryContent.textContent = JSON.stringify(value, null, 2);
  summary.hidden = false;
  const clearTokenButton = document.querySelector('[data-action="clear-token"]');
  clearTokenButton.hidden = !value.notionTokenPresent;
}

document.querySelector('[data-action="start-session"]').addEventListener("click", async function () {
  clearError();
  try {
    await request("", { method: "POST" });
    landing.hidden = true;
    wizard.hidden = false;
    summary.hidden = true;
    showStep(0);
  } catch (error) {
    showError(error instanceof Error ? error.message : "세션을 시작하지 못했습니다.");
  }
});

form.querySelectorAll('input[name="sourceKind"]').forEach(function (input) {
  input.addEventListener("change", updateSourceFields);
});

previousButton.addEventListener("click", function () {
  showStep(currentStep - 1);
});

nextButton.addEventListener("click", function () {
  if (validateCurrentStep()) {
    showStep(currentStep + 1);
  }
});

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  clearError();
  try {
    const value = await request("/configuration", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildConfiguration())
    });
    notionTokenInput.value = "";
    renderSummary(value);
  } catch (error) {
    showError(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
  }
});

document.querySelector('[data-action="clear-token"]').addEventListener("click", async function () {
  clearError();
  try {
    const value = await request("/notion-token", { method: "DELETE" });
    notionTokenInput.value = "";
    renderSummary(value);
    showStep(1);
  } catch (error) {
    showError(error instanceof Error ? error.message : "토큰을 지우지 못했습니다.");
  }
});

document.querySelector('[data-action="end-session"]').addEventListener("click", async function () {
  clearError();
  try {
    await request("", { method: "DELETE" });
    form.reset();
    notionTokenInput.value = "";
    zipInput.value = "";
    summaryContent.textContent = "";
    summary.hidden = true;
    wizard.hidden = true;
    landing.hidden = false;
    updateSourceFields();
    showStep(0);
  } catch (error) {
    showError(error instanceof Error ? error.message : "세션을 종료하지 못했습니다.");
  }
});

async function restoreSession() {
  const response = await fetch(API, { credentials: "same-origin" });
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    showError("기존 로컬 세션 상태를 확인하지 못했습니다.");
    return;
  }
  const value = await response.json();
  landing.hidden = true;
  wizard.hidden = false;
  showStep(0);
  if (value.configured || value.source) {
    renderSummary(value);
  }
}

updateSourceFields();
showStep(0);
restoreSession().catch(function () {
  showError("기존 로컬 세션 상태를 확인하지 못했습니다.");
});
`;
