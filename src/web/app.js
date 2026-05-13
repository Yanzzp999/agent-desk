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
  hydrateShell();
  await refreshAll({ forceRun: true });
  connectEvents();
  setInterval(() => refreshAll(), 7000);
}

function hydrateShell() {
  projectRoot.classList.add("project-path");
  document.querySelectorAll(".nav button").forEach((button) => {
    if (button.querySelector("small, .nav-subtitle")) {
      return;
    }
    const view = button.dataset.view;
    const subtitles = {
      overview: "Daily health",
      runs: "Task control",
      planner: "Plan jobs",
      artifacts: "Outputs",
      settings: "Runtime",
    };
    button.innerHTML = `
      <span>${escapeHtml(button.textContent)}</span>
      <small class="nav-subtitle">${escapeHtml(subtitles[view] || "")}</small>
    `;
  });
}

async function refreshAll(options = {}) {
  try {
    state.health = await api("/api/health");
    projectRoot.textContent = state.health.projectRoot;
    projectRoot.title = state.health.projectRoot;
    await Promise.all([loadRuns(), loadPlans(), loadArtifacts()]);
    if ((options.forceRun || state.selectedRunId) && state.selectedRunId) {
      await selectRun(state.selectedRunId, { quiet: true });
    }
    if (state.selectedPlanId) {
      await selectPlan(state.selectedPlanId, { quiet: true });
    }
    if (state.selectedArtifactPath) {
      await selectArtifact(state.selectedArtifactPath, { quiet: true });
    }
    setConnectionState("connected", "Connected");
  } catch (error) {
    state.message = error.message;
    setConnectionState("offline", "Offline");
  }
  render();
}

async function loadRuns() {
  const query = state.runFilter ? `?status=${encodeURIComponent(state.runFilter)}` : "";
  const result = await api(`/api/runs${query}`);
  state.runs = result.items || [];
  if (!state.runs.some((run) => run.runId === state.selectedRunId)) {
    state.selectedRunId = state.runs[0]?.runId || "";
    state.runDetail = null;
    state.selectedTaskId = "";
    state.taskLogs = null;
    state.taskResult = null;
  }
}

async function loadPlans() {
  const result = await api("/api/plans");
  state.plans = result.items || [];
  if (!state.plans.some((plan) => plan.planJobId === state.selectedPlanId)) {
    state.selectedPlanId = state.plans[0]?.planJobId || "";
    state.planDetail = null;
  }
}

async function loadArtifacts() {
  const result = await api("/api/artifacts");
  state.artifacts = result.items || [];
  if (!state.artifacts.some((artifact) => artifact.path === state.selectedArtifactPath)) {
    state.selectedArtifactPath = state.artifacts[0]?.path || "";
    state.artifactPreview = null;
  }
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
  const latestRun = state.runs[0] || null;
  const latestPlan = state.plans[0] || null;
  const latestArtifact = state.artifacts[0] || null;
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Current workspace</p>
        <h2>Keep Ralph work visible without digging through state files.</h2>
        <p class="section-copy">
          Track active runs, planner jobs, and generated artifacts from one operator-friendly surface.
        </p>
      </div>
      <div class="hero-stats">
        <div>
          <span>Selected run</span>
          <strong>${escapeHtml(state.selectedRunId || latestRun?.runId || "No active run")}</strong>
          <p>${escapeHtml(latestRun ? `${label(latestRun.status)} · ${latestRun.totalTasks} tasks` : "Waiting for Ralph state")}</p>
        </div>
        <div>
          <span>Newest planner job</span>
          <strong>${escapeHtml(latestPlan?.planJobId || "No planner job")}</strong>
          <p>${escapeHtml(latestPlan ? `${label(latestPlan.status)} · ${label(latestPlan.stage)}` : "No recent planner activity")}</p>
        </div>
      </div>
    </section>
    <div class="stats-grid">
      ${metric("Active runs", activeRuns, "Runs still executing or waiting.", activeRuns ? "accent" : "")}
      ${metric("Running tasks", runningTasks, "Workers currently doing work.", runningTasks ? "active" : "")}
      ${metric("Needs attention", attention, attention ? "Failures, stale tasks, or stopped work." : "No open attention items right now.", attention ? "danger" : "positive")}
      ${metric("Planner jobs", activePlans, activePlans ? "Planner jobs still in flight." : "Planner queue is quiet.", activePlans ? "warning" : "")}
    </div>
    <div class="split-layout">
      <section class="stack-card list-card">
        <div class="section-header">
          <div>
            <h2>Recent Runs</h2>
            <p class="section-copy">Quick access to the runs most likely to need a closer look.</p>
          </div>
          <div class="pill-group">
            ${renderPill("Running", activeRuns, activeRuns ? "active" : "")}
            ${renderPill("Attention", attention, attention ? "danger" : "positive")}
          </div>
        </div>
        ${renderRunTable(state.runs.slice(0, 8))}
      </section>
      <section class="stack-card list-card">
        <div class="section-header">
          <div>
            <h2>Recent Planner Jobs</h2>
            <p class="section-copy">Keep an eye on PRD generation and JSON conversion without leaving the dashboard.</p>
          </div>
          <div class="pill-group">
            ${renderPill("Queued", state.plans.filter((plan) => plan.status === "received").length, state.plans.some((plan) => plan.status === "received") ? "warning" : "")}
            ${renderPill("Running", state.plans.filter((plan) => plan.status === "running").length, state.plans.some((plan) => plan.status === "running") ? "active" : "")}
          </div>
        </div>
        ${renderPlanTable(state.plans.slice(0, 8))}
      </section>
    </div>
    <div class="split-layout secondary">
      <section class="stack-card detail-card">
        <div class="section-header">
          <div>
            <h2>Status Snapshot</h2>
            <p class="section-copy">Across all loaded runs.</p>
          </div>
        </div>
        <div class="pill-group">
          ${renderPill("Succeeded", state.runs.reduce((sum, run) => sum + sumCounts(run.counts, ["succeeded"]), 0), "positive")}
          ${renderPill("Running", state.runs.reduce((sum, run) => sum + sumCounts(run.counts, ["running", "launching"]), 0), "active")}
          ${renderPill("Queued", state.runs.reduce((sum, run) => sum + sumCounts(run.counts, ["queued"]), 0), "warning")}
          ${renderPill("Attention", state.runs.reduce((sum, run) => sum + sumCounts(run.counts, ["failed", "stale", "stopped", "needs_attention"]), 0), attention ? "danger" : "")}
        </div>
        <p class="field-hint">${escapeHtml(latestRun ? `Latest run updated ${formatDate(latestRun.updatedAt)}.` : "Load a Ralph project to see run activity.")}</p>
      </section>
      <section class="stack-card detail-card">
        <div class="section-header">
          <div>
            <h2>Latest Artifact</h2>
            <p class="section-copy">The freshest generated output available for inspection.</p>
          </div>
        </div>
        ${latestArtifact ? `
          <div class="artifact-meta">
            <div><span>Title</span><strong>${escapeHtml(latestArtifact.title)}</strong></div>
            <div><span>Kind</span><strong>${escapeHtml(label(latestArtifact.kind))}</strong></div>
            <div><span>Updated</span><strong>${escapeHtml(formatDate(latestArtifact.updatedAt))}</strong></div>
            <div><span>Size</span><strong>${escapeHtml(formatFileSize(latestArtifact.size))}</strong></div>
          </div>
          <p class="field-hint mono">${escapeHtml(latestArtifact.path)}</p>
        ` : emptyState("No artifacts yet", "Generated reports and task results will show up here once Ralph writes them.")}
      </section>
    </div>
  `;
}

function renderRuns() {
  const detail = state.runDetail;
  const selectedTask = detail?.tasks.find((task) => task.id === state.selectedTaskId);
  return `
    <section class="hero hero-compact">
      <div class="hero-copy">
        <p class="eyebrow">Execution tracking</p>
        <h2>Inspect run health, task flow, and worker output.</h2>
        <p class="section-copy">Filter the run list, switch task views, and act on retries or stops from the task drawer.</p>
      </div>
      <div class="hero-actions">
        <label class="toolbar-field">
          <span>Status filter</span>
          <select id="run-filter">
            ${["", "running", "queued", "succeeded", "needs_attention", "failed", "stale", "stopped"].map((status) => `
              <option value="${status}" ${state.runFilter === status ? "selected" : ""}>${status || "all"}</option>
            `).join("")}
          </select>
        </label>
        <button class="button" data-action="collect" type="button" ${state.selectedRunId ? "" : "disabled"}>Collect Run</button>
      </div>
    </section>
    <div class="runs-layout">
      <div class="detail-stack">
        <section class="stack-card list-card">
          <div class="section-header">
            <div>
              <h2>Runs</h2>
              <p class="section-copy">Select a run to inspect task details, dependency flow, and generated reports.</p>
            </div>
            <div class="pill-group">
              ${renderPill("Loaded", state.runs.length)}
              ${renderPill("Current", state.selectedRunId ? 1 : 0, state.selectedRunId ? "active" : "")}
            </div>
          </div>
          ${renderRunTable(state.runs)}
        </section>
        ${detail ? renderRunDetail(detail) : `
          <section class="stack-card detail-card">
            ${emptyState("No run selected", "Pick a run from the table to review tasks and worker output.")}
          </section>
        `}
      </div>
      <aside class="drawer stack-card">
        ${selectedTask ? renderTaskDrawer(selectedTask) : emptyState("No task selected", "Choose a task from the table, board, or graph to inspect logs and results.")}
      </aside>
    </div>
  `;
}

function renderRunDetail(detail) {
  return `
    <section class="stack-card detail-card">
      <div class="section-header">
        <div>
          <p class="eyebrow">Selected run</p>
          <h2>${escapeHtml(detail.run.runId || state.selectedRunId)}</h2>
          <p class="section-copy">${escapeHtml(detail.run.sourcePrd || "No PRD source recorded for this run.")}</p>
        </div>
        <div class="segmented">
          ${["table", "board", "graph"].map((value) => `
            <button type="button" name="task-view" value="${value}" class="${state.taskView === value ? "active" : ""}" data-action="task-view-${value}">${label(value)}</button>
          `).join("")}
        </div>
      </div>
      <div class="stats-grid compact">
        ${metric("Status", label(detail.run.status || "unknown"), "Current run state.", statusTone(detail.run.status))}
        ${metric("Tasks", detail.tasks.length, "Total tasks in this run.")}
        ${metric("Max parallel", detail.run.maxParallel || "-", "Concurrency budget from run metadata.")}
        ${metric("Blocked", detail.summary.blockedTasks.length, detail.summary.blockedTasks.length ? "Queued tasks still waiting on dependencies." : "No blocked tasks right now.", detail.summary.blockedTasks.length ? "warning" : "positive")}
      </div>
      <div class="info-grid">
        ${infoTile("Project", detail.run.project || "-")}
        ${infoTile("Branch", detail.run.branchName || "-")}
        ${infoTile("Updated", formatDate(detail.run.updatedAt))}
        ${infoTile("Report", detail.paths.reportPath)}
      </div>
      <div class="section-header compact">
        <div>
          <h3>Task View</h3>
          <p class="section-copy">Switch between table, board, and dependency graph without losing the selected task.</p>
        </div>
      </div>
      ${renderTaskView(detail.tasks)}
    </section>
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
    return emptyState("No tasks", "This run does not have any task records yet.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Dependencies</th><th>Attempts</th></tr></thead>
        <tbody>
          ${tasks.map((task) => `
            <tr data-task-id="${escapeAttr(task.id)}" class="${task.id === state.selectedTaskId ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong class="mono">${escapeHtml(task.id)}</strong>
                  <span>${escapeHtml(task.title || "Untitled task")}</span>
                </div>
              </td>
              <td>${badge(task.status)}</td>
              <td>${escapeHtml(task.priority ?? "-")}</td>
              <td>${escapeHtml((task.dependencies || []).join(", ") || "-")}</td>
              <td>${escapeHtml(task.attempts ?? "-")}</td>
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
        <div class="lane-header">
          <h3>${label(lane)}</h3>
          <span class="badge ${statusTone(lane)}">${escapeHtml(laneTasks.length)}</span>
        </div>
        ${laneTasks.map((task) => `
          <div class="task-tile ${task.id === state.selectedTaskId ? "selected" : ""}" data-task-id="${escapeAttr(task.id)}">
            <strong>${escapeHtml(task.id)}</strong>
            <p>${escapeHtml(task.title || "Untitled task")}</p>
            <div class="pill-group">
              ${badge(task.status)}
              ${renderPill("Prio", task.priority ?? "-", "")}
            </div>
          </div>
        `).join("") || `<p class="muted">Empty</p>`}
      </section>
    `;
  }).join("")}</div>`;
}

function renderGraph(tasks) {
  if (tasks.length === 0) {
    return emptyState("No graph", "Tasks need ids and dependencies before a graph can be drawn.");
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
      <div class="graph-caption">Dependency graph for the currently selected run.</div>
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
    <div class="section-header">
      <div>
        <p class="eyebrow">Selected task</p>
        <h2>${escapeHtml(task.id)}</h2>
        <p class="section-copy">${escapeHtml(task.title || "Untitled task")}</p>
      </div>
      <div class="row-actions">
        <button class="button" data-action="retry" type="button">Retry</button>
        <button class="button danger" data-action="stop" type="button">Stop</button>
      </div>
    </div>
    <div class="pill-group">
      ${badge(task.status)}
      ${renderPill("Priority", task.priority ?? "-", "")}
      ${renderPill("Attempts", task.attempts ?? "-", "")}
    </div>
    <p class="section-copy">${escapeHtml(task.description || "No task description recorded.")}</p>
    <div class="info-grid">
      ${infoTile("Dependencies", (task.dependencies || []).join(", ") || "-")}
      ${infoTile("Allowed paths", (task.allowedPaths || []).join(", ") || "-")}
      ${infoTile("Branch", task.branch || "-")}
      ${infoTile("Worktree", task.worktree || "-")}
      ${infoTile("PID", task.pid || "-")}
      ${infoTile("Lease", task.leaseExpiresAt || "-")}
      ${infoTile("Started", task.startedAt || "-")}
      ${infoTile("Completed", task.completedAt || "-")}
      ${infoTile("Last error", task.lastError || "-")}
    </div>
    <h3>Acceptance Criteria</h3>
    ${(task.acceptanceCriteria || []).length
      ? `<ul class="timeline-list">${task.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="muted">None</p>`}
    <div class="code-grid">
      <section class="code-card">
        <div class="section-header compact">
          <div>
            <h3>Log Tail</h3>
            <p class="section-copy">Latest worker output.</p>
          </div>
        </div>
        <pre>${escapeHtml(state.taskLogs?.content || "")}</pre>
      </section>
      <section class="code-card">
        <div class="section-header compact">
          <div>
            <h3>Result</h3>
            <p class="section-copy">Captured task artifact or result markdown.</p>
          </div>
        </div>
        <pre>${escapeHtml(state.taskResult?.content || "")}</pre>
      </section>
    </div>
  `;
}

function renderPlanner() {
  const mode = document.querySelector("#planner-mode")?.value || "brief_to_json";
  return `
    <section class="hero hero-compact">
      <div class="hero-copy">
        <p class="eyebrow">Planner control</p>
        <h2>Kick off PRD generation and keep the contract files in view.</h2>
        <p class="section-copy">Start a brief-to-JSON or PRD-to-JSON job and inspect the generated contract and logs below.</p>
      </div>
    </section>
    <div class="split-layout">
      <section class="stack-card detail-card">
        <div class="section-header">
          <div>
            <h2>New Planner Job</h2>
            <p class="section-copy">Choose the input mode, target output directory, and optional model overrides.</p>
          </div>
        </div>
        <form id="planner-form" class="form-grid">
          <label class="toolbar-field">Mode
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
      <section class="stack-card list-card">
        <div class="section-header">
          <div>
            <h2>Planner Jobs</h2>
            <p class="section-copy">Select a job to inspect logs and generated file paths.</p>
          </div>
        </div>
        ${renderPlanTable(state.plans)}
      </section>
    </div>
    ${state.planDetail ? renderPlanDetail(state.planDetail) : `
      <section class="stack-card detail-card">
        ${emptyState("No planner job selected", "Pick a planner job to inspect its contract output and logs.")}
      </section>
    `}
  `;
}

function renderPlanDetail(plan) {
  const contract = plan.result?.contract || {};
  return `
    <section class="stack-card detail-card">
      <div class="section-header">
        <div>
          <p class="eyebrow">Selected planner job</p>
          <h2>${escapeHtml(plan.planJobId)}</h2>
          <p class="section-copy">Keep the generated contract files and logs close while the job is in flight.</p>
        </div>
        <div class="pill-group">
          ${badge(plan.status)}
          ${badge(plan.stage)}
        </div>
      </div>
      <div class="info-grid">
        ${infoTile("Mode", plan.input.mode)}
        ${infoTile("PRD file", contract.PRD_FILE || "-")}
        ${infoTile("PRD JSON", contract.PRD_JSON || "-")}
        ${infoTile("Progress", contract.PROGRESS_FILE || "-")}
        ${infoTile("Updated", formatDate(plan.updatedAt))}
        ${infoTile("Last error", plan.lastError || "-")}
      </div>
      <div class="code-grid">
        <section class="code-card">
          <div class="section-header compact">
            <div>
              <h3>stdout</h3>
              <p class="section-copy">Normal planner output.</p>
            </div>
          </div>
          <pre>${escapeHtml(plan.stdout || "")}</pre>
        </section>
        <section class="code-card">
          <div class="section-header compact">
            <div>
              <h3>stderr</h3>
              <p class="section-copy">Errors and warnings.</p>
            </div>
          </div>
          <pre>${escapeHtml(plan.stderr || "")}</pre>
        </section>
      </div>
    </section>
  `;
}

function renderArtifacts() {
  const selectedArtifact = state.artifacts.find((artifact) => artifact.path === state.selectedArtifactPath) || null;
  return `
    <section class="hero hero-compact">
      <div class="hero-copy">
        <p class="eyebrow">Generated outputs</p>
        <h2>Review reports, task results, and planner contract files in one place.</h2>
        <p class="section-copy">Select an artifact to preview its contents without leaving the control plane.</p>
      </div>
    </section>
    <div class="split-layout">
      <section class="stack-card list-card">
        <div class="section-header">
          <div>
            <h2>Artifacts</h2>
            <p class="section-copy">Sorted by freshest update so the newest output is always near the top.</p>
          </div>
        </div>
        ${renderArtifactTable(state.artifacts)}
      </section>
      <aside class="drawer stack-card">
        <div class="section-header">
          <div>
            <h2>Preview</h2>
            <p class="section-copy">Selected artifact contents.</p>
          </div>
        </div>
        ${selectedArtifact ? `
          <div class="artifact-meta">
            <div><span>Title</span><strong>${escapeHtml(selectedArtifact.title)}</strong></div>
            <div><span>Kind</span><strong>${escapeHtml(label(selectedArtifact.kind))}</strong></div>
            <div><span>Updated</span><strong>${escapeHtml(formatDate(selectedArtifact.updatedAt))}</strong></div>
            <div><span>Size</span><strong>${escapeHtml(formatFileSize(selectedArtifact.size))}</strong></div>
          </div>
        ` : ""}
        <p class="muted mono artifact-path">${escapeHtml(state.artifactPreview?.path || "")}</p>
        <pre>${escapeHtml(state.artifactPreview?.content || "")}</pre>
      </aside>
    </div>
  `;
}

function renderSettings() {
  const health = state.health || {};
  return `
    <section class="hero hero-compact">
      <div class="hero-copy">
        <p class="eyebrow">Runtime configuration</p>
        <h2>Confirm the project roots and Ralph tool paths behind this control plane.</h2>
        <p class="section-copy">Useful when the UI is pointed at a different worktree or shared state directory.</p>
      </div>
      <div class="hero-stats">
        <div>
          <span>Health</span>
          <strong>${escapeHtml(health.ok ? "Ready" : "Unknown")}</strong>
          <p>${escapeHtml(health.projectRoot ? "Project root loaded." : "No project root reported yet.")}</p>
        </div>
      </div>
    </section>
    <section class="stack-card detail-card">
      <div class="section-header">
        <div>
          <h2>Resolved Paths</h2>
          <p class="section-copy">These values come from the current server context and drive every API lookup.</p>
        </div>
      </div>
      <div class="info-grid">
        ${infoTile("Project root", health.projectRoot || "-")}
        ${infoTile("State root", health.stateRoot || "-")}
        ${infoTile("UI state root", health.uiStateRoot || "-")}
        ${infoTile("ralph-run", health.ralphRunCli || "-")}
        ${infoTile("ralph", health.ralphPlanCli || "-")}
      </div>
    </section>
  `;
}

function renderRunTable(runs) {
  if (!runs.length) {
    return emptyState("No runs", "Ralph run state will appear here once the selected project has data.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Status</th><th>Tasks</th><th>Active</th><th>Attention</th><th>Updated</th></tr></thead>
        <tbody>
          ${runs.map((run) => `
            <tr data-run-id="${escapeAttr(run.runId)}" class="${run.runId === state.selectedRunId ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong class="mono">${escapeHtml(run.runId)}</strong>
                  <span>${escapeHtml(run.project || "-")}</span>
                </div>
              </td>
              <td>${badge(run.status)}</td>
              <td>${escapeHtml(run.totalTasks ?? 0)}</td>
              <td>${escapeHtml(sumCounts(run.counts, ["running", "launching", "queued"]))}</td>
              <td>${escapeHtml(sumCounts(run.counts, ["failed", "stale", "stopped", "needs_attention"]))}</td>
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
    return emptyState("No planner jobs", "Start a planner run to capture PRD conversion progress here.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Job</th><th>Status</th><th>Mode</th><th>Stage</th><th>Updated</th></tr></thead>
        <tbody>
          ${plans.map((plan) => `
            <tr data-plan-id="${escapeAttr(plan.planJobId)}" class="${plan.planJobId === state.selectedPlanId ? "selected" : ""}">
              <td class="mono">${escapeHtml(plan.planJobId)}</td>
              <td>${badge(plan.status)}</td>
              <td>${escapeHtml(label(plan.input?.mode || "-"))}</td>
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
    return emptyState("No artifacts", "Run reports, task results, and planner contract files show up here.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Kind</th><th>Artifact</th><th>Size</th><th>Updated</th><th>Path</th></tr></thead>
        <tbody>
          ${artifacts.map((artifact) => `
            <tr data-artifact-path="${escapeAttr(artifact.path)}" class="${artifact.path === state.selectedArtifactPath ? "selected" : ""}">
              <td>${badge(artifact.kind)}</td>
              <td>${escapeHtml(artifact.title)}</td>
              <td>${escapeHtml(formatFileSize(artifact.size))}</td>
              <td>${escapeHtml(formatDate(artifact.updatedAt))}</td>
              <td class="mono">${escapeHtml(artifact.path)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function metric(labelText, value, note = "", tone = "") {
  return `
    <article class="metric ${tone}">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<p>${escapeHtml(note)}</p>` : ""}
    </article>
  `;
}

function renderPill(labelText, value, tone = "") {
  return `
    <span class="pill ${tone}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(labelText)}</span>
    </span>
  `;
}

function infoTile(labelText, value) {
  return `
    <div class="info-tile">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(value ?? "-")}</strong>
    </div>
  `;
}

function emptyState(titleText, copy = "") {
  return `
    <div class="empty empty-state">
      <div>
        <strong>${escapeHtml(titleText)}</strong>
        ${copy ? `<p>${escapeHtml(copy)}</p>` : ""}
      </div>
    </div>
  `;
}

function badge(value) {
  const text = String(value || "unknown");
  return `<span class="badge ${escapeAttr(text)} ${statusTone(text)}">${escapeHtml(label(text))}</span>`;
}

function kv(key, value) {
  return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value ?? "-")}</dd>`;
}

function sumCounts(counts = {}, statuses = []) {
  return statuses.reduce((sum, status) => sum + Number(counts?.[status] || 0), 0);
}

function statusTone(status) {
  if (["succeeded"].includes(status)) {
    return "positive";
  }
  if (["failed", "stale", "stopped", "needs_attention"].includes(status)) {
    return "danger";
  }
  if (["running", "launching", "connected"].includes(status)) {
    return "active";
  }
  if (["queued", "received", "generating_prd", "converting_json"].includes(status)) {
    return "warning";
  }
  return "";
}

function setConnectionState(status, text) {
  connection.dataset.state = status;
  connection.textContent = text;
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

function formatFileSize(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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
    setConnectionState("connected", "Connected");
  });
  events.addEventListener("state.updated", () => {
    refreshAll({ forceRun: true });
  });
  events.onerror = () => {
    setConnectionState("reconnecting", "Reconnecting");
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
