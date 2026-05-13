const state = {
  view: "overview",
  health: null,
  runs: [],
  runFilter: "",
  selectedRunId: "",
  runDetail: null,
  selectedTaskId: "",
  taskLogs: null,
  taskResult: null,
  taskView: "table",
  plans: [],
  selectedPlanId: "",
  planDetail: null,
  artifacts: [],
  selectedArtifactPath: "",
  artifactPreview: null,
  message: "",
};

const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const projectRoot = document.querySelector("#project-root");
const connection = document.querySelector("#connection-state");

document.querySelector("#refresh-button").addEventListener("click", () => refreshAll({ forceRun: true }));
document.querySelectorAll(".nav button").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
    refreshAll();
  });
});

document.body.addEventListener("click", async (event) => {
  const runRow = event.target.closest("[data-run-id]");
  if (runRow) {
    await selectRun(runRow.dataset.runId);
    return;
  }
  const taskRow = event.target.closest("[data-task-id]");
  if (taskRow) {
    await selectTask(taskRow.dataset.taskId);
    return;
  }
  const planRow = event.target.closest("[data-plan-id]");
  if (planRow) {
    await selectPlan(planRow.dataset.planId);
    return;
  }
  const artifactRow = event.target.closest("[data-artifact-path]");
  if (artifactRow) {
    await selectArtifact(artifactRow.dataset.artifactPath);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) {
    return;
  }
  await handleAction(action);
});

document.body.addEventListener("change", async (event) => {
  if (event.target.id === "run-filter") {
    state.runFilter = event.target.value;
    await loadRuns();
    render();
  }
  if (event.target.name === "task-view") {
    state.taskView = event.target.value;
    render();
  }
  if (event.target.id === "planner-mode") {
    render();
  }
});

document.body.addEventListener("submit", async (event) => {
  if (event.target.id !== "planner-form") {
    return;
  }
  event.preventDefault();
  const form = new FormData(event.target);
  const mode = String(form.get("mode"));
  const payload = {
    mode,
    featureBrief: String(form.get("featureBrief") || ""),
    inputPath: String(form.get("inputPath") || ""),
    outputDir: String(form.get("outputDir") || ""),
    ralphDir: String(form.get("ralphDir") || ""),
    model: String(form.get("model") || ""),
    reasoning: String(form.get("reasoning") || ""),
  };
  const job = await api("/api/plans", { method: "POST", body: payload });
  state.message = `Started planner job ${job.planJobId}`;
  state.selectedPlanId = job.planJobId;
  await loadPlans();
  await selectPlan(job.planJobId);
});

start();

async function start() {
  await refreshAll({ forceRun: true });
  connectEvents();
  setInterval(() => refreshAll(), 7000);
}

async function refreshAll(options = {}) {
  try {
    state.health = await api("/api/health");
    projectRoot.textContent = state.health.projectRoot;
    await Promise.all([loadRuns(), loadPlans(), loadArtifacts()]);
    if (options.forceRun && state.selectedRunId) {
      await selectRun(state.selectedRunId, { quiet: true });
    }
    if (state.selectedPlanId) {
      await selectPlan(state.selectedPlanId, { quiet: true });
    }
    if (state.selectedArtifactPath) {
      await selectArtifact(state.selectedArtifactPath, { quiet: true });
    }
    connection.textContent = "Connected";
  } catch (error) {
    state.message = error.message;
    connection.textContent = "Offline";
  }
  render();
}

async function loadRuns() {
  const query = state.runFilter ? `?status=${encodeURIComponent(state.runFilter)}` : "";
  const result = await api(`/api/runs${query}`);
  state.runs = result.items || [];
  if (!state.selectedRunId && state.runs[0]) {
    state.selectedRunId = state.runs[0].runId;
  }
}

async function loadPlans() {
  const result = await api("/api/plans");
  state.plans = result.items || [];
}

async function loadArtifacts() {
  const result = await api("/api/artifacts");
  state.artifacts = result.items || [];
}

async function selectRun(runId, options = {}) {
  state.selectedRunId = runId;
  state.runDetail = await api(`/api/runs/${encodeURIComponent(runId)}`);
  if (!state.selectedTaskId || !state.runDetail.tasks.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = state.runDetail.tasks[0]?.id || "";
  }
  if (state.selectedTaskId) {
    await selectTask(state.selectedTaskId, { quiet: true });
  }
  if (!options.quiet) {
    state.view = "runs";
  }
  render();
}

async function selectTask(taskId, options = {}) {
  state.selectedTaskId = taskId;
  if (state.selectedRunId && taskId) {
    const runId = encodeURIComponent(state.selectedRunId);
    const encodedTask = encodeURIComponent(taskId);
    state.taskLogs = await api(`/api/runs/${runId}/tasks/${encodedTask}/logs?lines=160`);
    state.taskResult = await api(`/api/runs/${runId}/tasks/${encodedTask}/result`);
  }
  if (!options.quiet) {
    state.view = "runs";
  }
  render();
}

async function selectPlan(planJobId, options = {}) {
  state.selectedPlanId = planJobId;
  state.planDetail = await api(`/api/plans/${encodeURIComponent(planJobId)}?logs=1`);
  if (!options.quiet) {
    state.view = "planner";
  }
  render();
}

async function selectArtifact(artifactPath, options = {}) {
  state.selectedArtifactPath = artifactPath;
  state.artifactPreview = await api(`/api/artifacts/preview?path=${encodeURIComponent(artifactPath)}`);
  if (!options.quiet) {
    state.view = "artifacts";
  }
  render();
}

async function handleAction(action) {
  if (action.startsWith("task-view-")) {
    state.taskView = action.replace("task-view-", "");
    render();
    return;
  }
  if (action === "collect" && state.selectedRunId) {
    await api(`/api/runs/${encodeURIComponent(state.selectedRunId)}/collect`, { method: "POST" });
    state.message = `Collected ${state.selectedRunId}`;
    await selectRun(state.selectedRunId, { quiet: true });
    await loadArtifacts();
  }
  if (action === "retry" && state.selectedRunId && state.selectedTaskId) {
    await api(`/api/runs/${encodeURIComponent(state.selectedRunId)}/tasks/${encodeURIComponent(state.selectedTaskId)}/retry`, {
      method: "POST",
      body: {},
    });
    state.message = `Queued ${state.selectedTaskId} for retry`;
    await selectRun(state.selectedRunId, { quiet: true });
  }
  if (action === "stop" && state.selectedRunId && state.selectedTaskId) {
    await api(`/api/runs/${encodeURIComponent(state.selectedRunId)}/tasks/${encodeURIComponent(state.selectedTaskId)}/stop`, {
      method: "POST",
      body: {},
    });
    state.message = `Stopped ${state.selectedTaskId}`;
    await selectRun(state.selectedRunId, { quiet: true });
  }
  render();
}

function render() {
  document.querySelectorAll(".nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  title.textContent = titleForView(state.view);
  const body = state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : "";
  state.message = "";
  app.innerHTML = body + ({
    overview: renderOverview,
    runs: renderRuns,
    planner: renderPlanner,
    artifacts: renderArtifacts,
    settings: renderSettings,
  }[state.view] || renderOverview)();
}

function renderOverview() {
  const activeRuns = state.runs.filter((run) => ["running", "queued"].includes(run.status)).length;
  const attention = state.runs.reduce((sum, run) => sum + Object.entries(run.counts || {})
    .filter(([status]) => ["failed", "stale", "stopped"].includes(status))
    .reduce((inner, [, count]) => inner + count, 0), 0);
  const runningTasks = state.runs.reduce((sum, run) => sum + Number(run.counts?.running || 0), 0);
  const activePlans = state.plans.filter((plan) => ["received", "running"].includes(plan.status)).length;
  return `
    <div class="grid metrics">
      ${metric("Active runs", activeRuns)}
      ${metric("Running tasks", runningTasks)}
      ${metric("Tasks needing attention", attention)}
      ${metric("Active planner jobs", activePlans)}
    </div>
    <div class="grid two" style="margin-top:16px">
      <section class="panel">
        <h2>Recent Runs</h2>
        ${renderRunTable(state.runs.slice(0, 8))}
      </section>
      <section class="panel">
        <h2>Recent Planner Jobs</h2>
        ${renderPlanTable(state.plans.slice(0, 8))}
      </section>
    </div>
  `;
}

function renderRuns() {
  const detail = state.runDetail;
  const selectedTask = detail?.tasks.find((task) => task.id === state.selectedTaskId);
  return `
    <div class="toolbar" style="margin-bottom:16px">
      <label style="max-width:220px">Status
        <select id="run-filter">
          ${["", "running", "queued", "succeeded", "needs_attention", "failed", "stale", "stopped"].map((status) => `
            <option value="${status}" ${state.runFilter === status ? "selected" : ""}>${status || "all"}</option>
          `).join("")}
        </select>
      </label>
      <button class="button" data-action="collect" type="button" ${state.selectedRunId ? "" : "disabled"}>Collect</button>
    </div>
    <div class="grid two">
      <section class="panel">
        <h2>Runs</h2>
        ${renderRunTable(state.runs)}
        ${detail ? renderRunDetail(detail) : `<div class="empty">No run selected</div>`}
      </section>
      <aside class="drawer">
        ${selectedTask ? renderTaskDrawer(selectedTask) : `<div class="empty">No task selected</div>`}
      </aside>
    </div>
  `;
}

function renderRunDetail(detail) {
  return `
    <div style="height:16px"></div>
    <div class="grid metrics">
      ${metric("Status", detail.run.status || "unknown")}
      ${metric("Tasks", detail.tasks.length)}
      ${metric("Max parallel", detail.run.maxParallel || "-")}
      ${metric("Blocked", detail.summary.blockedTasks.length)}
    </div>
    <div class="toolbar" style="justify-content:space-between;margin:16px 0">
      <div>
        <h2 style="margin:0">${escapeHtml(detail.run.runId || state.selectedRunId)}</h2>
        <p class="muted" style="margin:4px 0 0">${escapeHtml(detail.run.sourcePrd || "")}</p>
      </div>
      <div class="segmented">
        ${["table", "board", "graph"].map((value) => `
          <button type="button" name="task-view" value="${value}" class="${state.taskView === value ? "active" : ""}" data-action="task-view-${value}">${label(value)}</button>
        `).join("")}
      </div>
    </div>
    ${renderTaskView(detail.tasks)}
  `;
}

function renderTaskView(tasks) {
  if (state.taskView === "board") {
    return renderKanban(tasks);
  }
  if (state.taskView === "graph") {
    return renderGraph(tasks);
  }
  return renderTaskTable(tasks);
}

function renderTaskTable(tasks) {
  if (tasks.length === 0) {
    return `<div class="empty">No tasks</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Status</th><th>Priority</th><th>Title</th><th>Dependencies</th></tr></thead>
        <tbody>
          ${tasks.map((task) => `
            <tr data-task-id="${escapeAttr(task.id)}" class="${task.id === state.selectedTaskId ? "selected" : ""}">
              <td class="mono">${escapeHtml(task.id)}</td>
              <td>${badge(task.status)}</td>
              <td>${escapeHtml(task.priority ?? "-")}</td>
              <td>${escapeHtml(task.title || "")}</td>
              <td>${escapeHtml((task.dependencies || []).join(", ") || "-")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderKanban(tasks) {
  const lanes = ["queued", "running", "succeeded", "needs_attention"];
  return `<div class="kanban">${lanes.map((lane) => {
    const laneTasks = tasks.filter((task) => lane === "needs_attention"
      ? ["failed", "stale", "stopped", "needs_attention"].includes(task.status)
      : task.status === lane || (lane === "running" && task.status === "launching"));
    return `
      <section class="lane">
        <h3>${label(lane)} <span class="muted">${laneTasks.length}</span></h3>
        ${laneTasks.map((task) => `
          <div class="task-tile ${task.id === state.selectedTaskId ? "selected" : ""}" data-task-id="${escapeAttr(task.id)}">
            <strong>${escapeHtml(task.id)}: ${escapeHtml(task.title || "")}</strong>
            ${badge(task.status)}
          </div>
        `).join("") || `<p class="muted">Empty</p>`}
      </section>
    `;
  }).join("")}</div>`;
}

function renderGraph(tasks) {
  if (tasks.length === 0) {
    return `<div class="empty">No graph</div>`;
  }
  const width = 900;
  const height = Math.max(260, tasks.length * 62 + 40);
  const positions = new Map(tasks.map((task, index) => [task.id, {
    x: 170 + (index % 3) * 260,
    y: 44 + index * 58,
  }]));
  const lines = [];
  const nodes = [];
  for (const task of tasks) {
    const point = positions.get(task.id);
    for (const dep of task.dependencies || []) {
      const depPoint = positions.get(dep);
      if (depPoint) {
        lines.push(`<line x1="${depPoint.x + 74}" y1="${depPoint.y}" x2="${point.x - 74}" y2="${point.y}" stroke="#9aa8a1" stroke-width="1.5" marker-end="url(#arrow)" />`);
      }
    }
    nodes.push(`
      <g data-task-id="${escapeAttr(task.id)}" class="graph-node">
        <rect x="${point.x - 76}" y="${point.y - 18}" width="152" height="36" rx="6" fill="${statusFill(task.status)}" stroke="#76847d" />
        <text x="${point.x}" y="${point.y + 4}" text-anchor="middle" font-size="12" fill="#17201c">${escapeSvg(task.id)}</text>
      </g>
    `);
  }
  return `
    <div class="graph-box">
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Task dependency graph">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#9aa8a1"></path>
          </marker>
        </defs>
        ${lines.join("")}
        ${nodes.join("")}
      </svg>
    </div>
  `;
}

function renderTaskDrawer(task) {
  return `
    <div class="toolbar" style="justify-content:space-between;margin-bottom:12px">
      <div>
        <h2 style="margin-bottom:4px">${escapeHtml(task.id)}</h2>
        ${badge(task.status)}
      </div>
      <div class="row-actions">
        <button class="button" data-action="retry" type="button">Retry</button>
        <button class="button danger" data-action="stop" type="button">Stop</button>
      </div>
    </div>
    <h3>${escapeHtml(task.title || "")}</h3>
    <p class="muted">${escapeHtml(task.description || "")}</p>
    <dl class="kv">
      ${kv("Priority", task.priority)}
      ${kv("Dependencies", (task.dependencies || []).join(", ") || "-")}
      ${kv("Allowed paths", (task.allowedPaths || []).join(", ") || "-")}
      ${kv("Attempts", task.attempts ?? "-")}
      ${kv("Branch", task.branch || "-")}
      ${kv("Worktree", task.worktree || "-")}
      ${kv("PID", task.pid || "-")}
      ${kv("Started", task.startedAt || "-")}
      ${kv("Completed", task.completedAt || "-")}
      ${kv("Lease", task.leaseExpiresAt || "-")}
      ${kv("Last error", task.lastError || "-")}
    </dl>
    <h3 style="margin-top:16px">Acceptance Criteria</h3>
    ${(task.acceptanceCriteria || []).length
      ? `<ul>${task.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="muted">None</p>`}
    <h3>Log Tail</h3>
    <pre>${escapeHtml(state.taskLogs?.content || "")}</pre>
    <h3 style="margin-top:16px">Result</h3>
    <pre>${escapeHtml(state.taskResult?.content || "")}</pre>
  `;
}

function renderPlanner() {
  const mode = document.querySelector("#planner-mode")?.value || "brief_to_json";
  return `
    <div class="grid two">
      <section class="panel">
        <h2>New Planner Job</h2>
        <form id="planner-form" class="form-grid">
          <label>Mode
            <select id="planner-mode" name="mode">
              <option value="brief_to_json" ${mode === "brief_to_json" ? "selected" : ""}>Brief to prd.json</option>
              <option value="prd_to_json" ${mode === "prd_to_json" ? "selected" : ""}>PRD to prd.json</option>
            </select>
          </label>
          ${mode === "prd_to_json"
            ? `<label>PRD path<input name="inputPath" placeholder="tasks/prd-example.md"></label>`
            : `<label>Feature brief<textarea name="featureBrief" placeholder="Build..."></textarea></label>`}
          <div class="grid two">
            <label>Output dir<input name="outputDir" placeholder="tasks"></label>
            <label>Ralph dir<input name="ralphDir" placeholder="."></label>
          </div>
          <div class="grid two">
            <label>Model<input name="model" placeholder="default"></label>
            <label>Reasoning<input name="reasoning" placeholder="default"></label>
          </div>
          <div><button class="button primary" type="submit">Start</button></div>
        </form>
      </section>
      <section class="panel">
        <h2>Planner Jobs</h2>
        ${renderPlanTable(state.plans)}
      </section>
    </div>
    <div style="height:16px"></div>
    ${state.planDetail ? renderPlanDetail(state.planDetail) : `<div class="empty">No planner job selected</div>`}
  `;
}

function renderPlanDetail(plan) {
  const contract = plan.result?.contract || {};
  return `
    <section class="panel">
      <div class="toolbar" style="justify-content:space-between">
        <div>
          <h2 style="margin-bottom:4px">${escapeHtml(plan.planJobId)}</h2>
          ${badge(plan.status)} ${badge(plan.stage)}
        </div>
      </div>
      <dl class="kv" style="margin:14px 0">
        ${kv("Mode", plan.input.mode)}
        ${kv("PRD file", contract.PRD_FILE || "-")}
        ${kv("PRD JSON", contract.PRD_JSON || "-")}
        ${kv("Progress", contract.PROGRESS_FILE || "-")}
        ${kv("Last error", plan.lastError || "-")}
      </dl>
      <div class="grid two">
        <div>
          <h3>stdout</h3>
          <pre>${escapeHtml(plan.stdout || "")}</pre>
        </div>
        <div>
          <h3>stderr</h3>
          <pre>${escapeHtml(plan.stderr || "")}</pre>
        </div>
      </div>
    </section>
  `;
}

function renderArtifacts() {
  return `
    <div class="grid two">
      <section class="panel">
        <h2>Artifacts</h2>
        ${renderArtifactTable(state.artifacts)}
      </section>
      <aside class="drawer">
        <h2>Preview</h2>
        <p class="muted mono">${escapeHtml(state.artifactPreview?.path || "")}</p>
        <pre>${escapeHtml(state.artifactPreview?.content || "")}</pre>
      </aside>
    </div>
  `;
}

function renderSettings() {
  const health = state.health || {};
  return `
    <section class="panel">
      <h2>Settings</h2>
      <dl class="kv">
        ${kv("Project root", health.projectRoot || "-")}
        ${kv("State root", health.stateRoot || "-")}
        ${kv("UI state root", health.uiStateRoot || "-")}
        ${kv("ralph-run", health.ralphRunCli || "-")}
        ${kv("ralph", health.ralphPlanCli || "-")}
      </dl>
    </section>
  `;
}

function renderRunTable(runs) {
  if (!runs.length) {
    return `<div class="empty">No runs</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Status</th><th>Tasks</th><th>Project</th><th>Updated</th></tr></thead>
        <tbody>
          ${runs.map((run) => `
            <tr data-run-id="${escapeAttr(run.runId)}" class="${run.runId === state.selectedRunId ? "selected" : ""}">
              <td class="mono">${escapeHtml(run.runId)}</td>
              <td>${badge(run.status)}</td>
              <td>${escapeHtml(run.totalTasks ?? 0)}</td>
              <td>${escapeHtml(run.project || "-")}</td>
              <td>${escapeHtml(formatDate(run.updatedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlanTable(plans) {
  if (!plans.length) {
    return `<div class="empty">No planner jobs</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Job</th><th>Status</th><th>Stage</th><th>Updated</th></tr></thead>
        <tbody>
          ${plans.map((plan) => `
            <tr data-plan-id="${escapeAttr(plan.planJobId)}" class="${plan.planJobId === state.selectedPlanId ? "selected" : ""}">
              <td class="mono">${escapeHtml(plan.planJobId)}</td>
              <td>${badge(plan.status)}</td>
              <td>${badge(plan.stage)}</td>
              <td>${escapeHtml(formatDate(plan.updatedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderArtifactTable(artifacts) {
  if (!artifacts.length) {
    return `<div class="empty">No artifacts</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Kind</th><th>Title</th><th>Updated</th><th>Path</th></tr></thead>
        <tbody>
          ${artifacts.map((artifact) => `
            <tr data-artifact-path="${escapeAttr(artifact.path)}" class="${artifact.path === state.selectedArtifactPath ? "selected" : ""}">
              <td>${badge(artifact.kind)}</td>
              <td>${escapeHtml(artifact.title)}</td>
              <td>${escapeHtml(formatDate(artifact.updatedAt))}</td>
              <td class="mono">${escapeHtml(artifact.path)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function metric(labelText, value) {
  return `<div class="metric"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function badge(value) {
  const text = String(value || "unknown");
  return `<span class="badge ${escapeAttr(text)}">${escapeHtml(label(text))}</span>`;
}

function kv(key, value) {
  return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "-")}</dd>`;
}

function titleForView(view) {
  return {
    overview: "Overview",
    runs: "Runs",
    planner: "Planner Jobs",
    artifacts: "Artifacts",
    settings: "Settings",
  }[view] || "Overview";
}

function label(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusFill(status) {
  if (["succeeded"].includes(status)) {
    return "#dcfce7";
  }
  if (["failed", "stale", "stopped", "needs_attention"].includes(status)) {
    return "#fee2e2";
  }
  if (["running", "launching"].includes(status)) {
    return "#dbeafe";
  }
  return "#fef3c7";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("connected", () => {
    connection.textContent = "Connected";
  });
  events.addEventListener("state.updated", () => {
    refreshAll({ forceRun: true });
  });
  events.onerror = () => {
    connection.textContent = "Reconnecting";
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function escapeSvg(value) {
  return escapeHtml(value);
}
