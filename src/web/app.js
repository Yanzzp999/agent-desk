const state = {
  view: "overview",
  health: null,
  projects: { current: null, items: [] },
  tasks: [],
  selectedTaskId: "",
  taskDetail: null,
  sessions: [],
  selectedSessionId: "",
  sessionDetail: null,
  selectedAgentId: "",
  agentLogs: null,
  message: "",
};

const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const projectRoot = document.querySelector("#project-root");
const connection = document.querySelector("#connection-state");

document.querySelector("#refresh-button").addEventListener("click", () => refreshAll({ forceSelections: true }));
document.querySelectorAll(".nav button").forEach((button) => {
  button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    render();
    await refreshAll();
  });
});

document.body.addEventListener("click", async (event) => {
  const projectRow = event.target.closest("[data-project-root]");
  if (projectRow) {
    await selectProject(projectRow.dataset.projectRoot);
    return;
  }

  const taskRow = event.target.closest("[data-task-id]");
  if (taskRow) {
    await selectTask(taskRow.dataset.taskId);
    return;
  }

  const sessionRow = event.target.closest("[data-session-id]");
  if (sessionRow) {
    await selectSession(sessionRow.dataset.sessionId);
    return;
  }

  const agentRow = event.target.closest("[data-agent-id]");
  if (agentRow && state.sessionDetail) {
    await selectAgent(agentRow.dataset.agentId);
  }
});

document.body.addEventListener("submit", async (event) => {
  if (event.target.id === "project-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    await selectProject(String(form.get("projectRoot") || ""));
    return;
  }

  if (event.target.id === "task-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    await createTask({
      title: String(form.get("title") || ""),
      brief: String(form.get("brief") || ""),
    });
    return;
  }

  if (event.target.id === "session-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    await startSession(String(form.get("taskId") || ""), Number(form.get("parallelism") || 6));
  }
});

start();

async function start() {
  hydrateShell();
  await refreshAll({ forceSelections: true });
  connectEvents();
  setInterval(() => refreshAll(), 7000);
}

function hydrateShell() {
  projectRoot.classList.add("project-path");
}

async function refreshAll(options = {}) {
  try {
    state.projects = await api("/api/projects");
    state.health = await api("/api/health");
    const hasProject = Boolean(state.health.projectRoot);
    projectRoot.textContent = hasProject ? state.health.projectRoot : "Choose a project";
    projectRoot.title = hasProject ? state.health.projectRoot : "";

    if (!hasProject) {
      clearLoadedProjectState();
      setConnectionState("connected", "Connected");
      render();
      return;
    }

    await Promise.all([loadTasks(), loadSessions()]);

    if ((options.forceSelections || state.selectedTaskId) && state.selectedTaskId) {
      await selectTask(state.selectedTaskId, { quiet: true });
    } else if (state.tasks[0]?.taskId) {
      await selectTask(state.tasks[0].taskId, { quiet: true });
    }

    if ((options.forceSelections || state.selectedSessionId) && state.selectedSessionId) {
      await selectSession(state.selectedSessionId, { quiet: true });
    } else if (state.sessions[0]?.sessionId) {
      await selectSession(state.sessions[0].sessionId, { quiet: true });
    }

    setConnectionState("connected", "Connected");
  } catch (error) {
    state.message = error.message;
    setConnectionState("offline", "Offline");
  }

  render();
}

function clearLoadedProjectState() {
  state.tasks = [];
  state.selectedTaskId = "";
  state.taskDetail = null;
  state.sessions = [];
  state.selectedSessionId = "";
  state.sessionDetail = null;
  state.selectedAgentId = "";
  state.agentLogs = null;
}

async function selectProject(projectPath) {
  const trimmed = String(projectPath || "").trim();
  if (!trimmed) {
    state.message = "Project path is required.";
    render();
    return;
  }

  try {
    const result = await api("/api/projects/select", {
      method: "POST",
      body: { projectRoot: trimmed },
    });
    state.projects = result;
    state.message = `Selected ${result.current?.name || trimmed}`;
    state.view = "overview";
    clearLoadedProjectState();
    await refreshAll({ forceSelections: true });
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function createTask(payload) {
  try {
    const task = await api("/api/tasks", {
      method: "POST",
      body: payload,
    });
    state.message = `Started task generation for ${task.title || task.taskId}`;
    await loadTasks();
    state.selectedTaskId = task.taskId;
    await selectTask(task.taskId, { quiet: true });
    state.view = "tasks";
    render();
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function startSession(taskId, parallelism) {
  if (!taskId) {
    return;
  }
  try {
    const session = await api(`/api/tasks/${encodeURIComponent(taskId)}/sessions`, {
      method: "POST",
      body: { parallelism },
    });
    state.message = `Started session ${session.sessionId}`;
    await loadSessions();
    await selectTask(taskId, { quiet: true });
    await selectSession(session.sessionId, { quiet: true });
    state.view = "sessions";
    render();
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function loadTasks() {
  const result = await api("/api/tasks");
  state.tasks = result.items || [];
  if (!state.tasks.some((task) => task.taskId === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0]?.taskId || "";
    state.taskDetail = null;
  }
}

async function loadSessions() {
  const result = await api("/api/sessions");
  state.sessions = result.items || [];
  if (!state.sessions.some((session) => session.sessionId === state.selectedSessionId)) {
    state.selectedSessionId = state.sessions[0]?.sessionId || "";
    state.sessionDetail = null;
    state.selectedAgentId = "";
    state.agentLogs = null;
  }
}

async function selectTask(taskId, options = {}) {
  if (!taskId) {
    state.taskDetail = null;
    render();
    return;
  }
  state.selectedTaskId = taskId;
  state.taskDetail = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (!options.quiet) {
    state.view = "tasks";
  }
  render();
}

async function selectSession(sessionId, options = {}) {
  if (!sessionId) {
    state.sessionDetail = null;
    state.selectedAgentId = "";
    state.agentLogs = null;
    render();
    return;
  }
  state.selectedSessionId = sessionId;
  state.sessionDetail = await api(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!state.sessionDetail.agents.some((agent) => agent.id === state.selectedAgentId)) {
    state.selectedAgentId = state.sessionDetail.agents[0]?.id || "";
    state.agentLogs = null;
  }
  if (state.selectedAgentId) {
    await selectAgent(state.selectedAgentId, { quiet: true });
  }
  if (!options.quiet) {
    state.view = "sessions";
  }
  render();
}

async function selectAgent(agentId, options = {}) {
  if (!state.sessionDetail || !agentId) {
    return;
  }
  state.selectedAgentId = agentId;
  state.agentLogs = await api(
    `/api/sessions/${encodeURIComponent(state.sessionDetail.sessionId)}/agents/${encodeURIComponent(agentId)}/logs`,
  );
  if (!options.quiet) {
    render();
  }
}

function connectEvents() {
  const events = new EventSource("/api/events");
  events.addEventListener("state.updated", () => {
    setConnectionState("reconnecting", "Updating");
    refreshAll();
  });
  events.addEventListener("project.changed", () => {
    setConnectionState("reconnecting", "Project changed");
    refreshAll({ forceSelections: true });
  });
  events.onerror = () => {
    setConnectionState("offline", "Offline");
  };
}

function setConnectionState(nextState, label) {
  connection.dataset.state = nextState;
  connection.textContent = label;
}

function render() {
  title.textContent = viewTitle(state.view);
  document.querySelectorAll(".nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  if (!state.health?.projectRoot) {
    app.innerHTML = [renderMessage(), renderProjectPicker()].filter(Boolean).join("");
    return;
  }

  const views = {
    overview: renderOverview,
    tasks: renderTasks,
    sessions: renderSessions,
    settings: renderSettings,
  };

  app.innerHTML = [renderMessage(), views[state.view]?.() || renderOverview()].filter(Boolean).join("");
}

function renderMessage() {
  if (!state.message) {
    return "";
  }
  return `<div class="message">${escapeHtml(state.message)}</div>`;
}

function renderProjectPicker() {
  const items = state.projects?.items || [];
  return `
    <section class="hero project-picker">
      <div class="hero-copy">
        <p class="eyebrow">Project selection</p>
        <h2>Choose a project root to manage tasks and subagent sessions.</h2>
        <p class="section-copy">Each project keeps its own task markdown files, session history, and orchestration state inside <code>.agent-desk/</code>.</p>
      </div>
      <form id="project-form" class="project-form">
        <label>
          Project path
          <input name="projectRoot" placeholder="/absolute/path/to/project" autocomplete="off">
        </label>
        <button class="button primary" type="submit">Select project</button>
      </form>
    </section>
    ${renderProjectTable(items)}
  `;
}

function renderOverview() {
  const latestTask = state.tasks[0] || null;
  const latestSession = state.sessions[0] || null;
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Workspace overview</p>
        <h2>Generate task markdown, launch Codex subagents, and review session history from one place.</h2>
        <p class="section-copy">Task generation is markdown-first, sessions run on <code>gpt-5.5</code> with <code>xhigh</code> reasoning and <code>fast</code> service tier, and every subagent keeps its own git worktree.</p>
      </div>
      <div class="hero-stats">
        <div>
          <span>Tasks</span>
          <strong>${escapeHtml(String(state.health?.counts?.tasks || 0))}</strong>
          <p>${escapeHtml(latestTask ? latestTask.title : "No generated task yet")}</p>
        </div>
        <div>
          <span>Sessions</span>
          <strong>${escapeHtml(String(state.health?.counts?.sessions || 0))}</strong>
          <p>${escapeHtml(latestSession ? `${label(latestSession.status)} · ${latestSession.taskTitle}` : "No execution session yet")}</p>
        </div>
        <div>
          <span>Default batch</span>
          <strong>6 agents</strong>
          <p>New subagents are launched in batches of six while respecting the selected parallelism.</p>
        </div>
        <div>
          <span>Integration target</span>
          <strong>master</strong>
          <p>Finished subagent branches are rebased and integrated into <code>master</code>; worktrees are kept.</p>
        </div>
      </div>
    </section>
    <section class="split-layout secondary">
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Recent tasks</h2>
            <p class="section-copy">Pick one to inspect markdown and launch a new session.</p>
          </div>
        </div>
        ${renderTasksTable(state.tasks.slice(0, 6))}
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Recent sessions</h2>
            <p class="section-copy">Review the latest subagent execution batches.</p>
          </div>
        </div>
        ${renderSessionsTable(state.sessions.slice(0, 6))}
      </div>
    </section>
  `;
}

function renderTasks() {
  return `
    <section class="runs-layout">
      <div class="detail-stack">
        <div class="stack-card">
          <div class="section-header">
            <div>
              <p class="eyebrow">Generate task markdown</p>
              <h2>Create a new <code>task.md</code> with Codex</h2>
              <p class="section-copy">This replaces the old PRD JSON workflow. Describe the feature once and AgentDesk will generate subagent-ready markdown.</p>
            </div>
          </div>
          <form id="task-form" class="form-grid">
            <label>
              Task title
              <input name="title" placeholder="Optional title">
            </label>
            <label>
              Feature brief
              <textarea name="brief" placeholder="Describe the feature, constraints, and expected outcome"></textarea>
            </label>
            <button class="button primary" type="submit">Generate task.md</button>
          </form>
        </div>
        <div class="stack-card">
          <div class="section-header">
            <div>
              <h2>Project tasks</h2>
              <p class="section-copy">Each project can keep multiple task markdown files and revisit earlier ones later.</p>
            </div>
          </div>
          ${renderTasksTable(state.tasks)}
        </div>
      </div>
      <div class="drawer">
        ${state.taskDetail ? renderTaskDetail(state.taskDetail) : emptyState("No task selected", "Choose a task to inspect its markdown and execution history.")}
      </div>
    </section>
  `;
}

function renderTaskDetail(task) {
  const sessions = task.sessions || [];
  return `
    <div class="detail-stack">
      <div class="stack-card">
        <div class="section-header">
          <div>
            <p class="eyebrow">Selected task</p>
            <h2>${escapeHtml(task.title || task.taskId)}</h2>
            <p class="section-copy">${escapeHtml(task.brief || "")}</p>
          </div>
          ${badge(task.status)}
        </div>
        <div class="info-grid">
          ${infoTile("Task ID", task.taskId)}
          ${infoTile("Subtasks", String(task.subtaskCount || 0))}
          ${infoTile("Sessions", String(task.sessionCount || sessions.length || 0))}
          ${infoTile("task.md", task.paths?.taskMd || "-")}
        </div>
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Launch session</h2>
            <p class="section-copy">Choose how many agents may run in parallel. AgentDesk still launches new subagents in batches of six.</p>
          </div>
        </div>
        <form id="session-form" class="project-form">
          <input type="hidden" name="taskId" value="${escapeAttr(task.taskId)}">
          <label>
            Parallel agents
            <input name="parallelism" type="number" min="1" max="24" value="6">
          </label>
          <button class="button primary" type="submit">Start session</button>
        </form>
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Previous sessions</h2>
            <p class="section-copy">You can reopen earlier sessions for the same task at any time.</p>
          </div>
        </div>
        ${renderSessionsTable(sessions)}
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>task.md</h2>
            <p class="section-copy">Generated markdown used to fan work out to subagents.</p>
          </div>
        </div>
        <pre class="markdown-preview">${escapeHtml(task.markdown || "")}</pre>
      </div>
    </div>
  `;
}

function renderSessions() {
  return `
    <section class="runs-layout">
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Sessions</h2>
            <p class="section-copy">Inspect all subagent runs across the current project.</p>
          </div>
        </div>
        ${renderSessionsTable(state.sessions)}
      </div>
      <div class="drawer">
        ${state.sessionDetail ? renderSessionDetail(state.sessionDetail) : emptyState("No session selected", "Choose a session to inspect agent results, docs, and logs.")}
      </div>
    </section>
  `;
}

function renderSessionDetail(session) {
  const selectedAgent = session.agents.find((agent) => agent.id === state.selectedAgentId) || null;
  return `
    <div class="detail-stack">
      <div class="stack-card">
        <div class="section-header">
          <div>
            <p class="eyebrow">Selected session</p>
            <h2>${escapeHtml(session.task?.title || session.title || session.sessionId)}</h2>
            <p class="section-copy">Session <code>${escapeHtml(session.sessionId)}</code></p>
          </div>
          ${badge(session.status)}
        </div>
        <div class="info-grid">
          ${infoTile("Parallelism", String(session.parallelism || 0))}
          ${infoTile("Batch size", String(session.batchSize || 0))}
          ${infoTile("Succeeded", String(session.succeededAgents || 0))}
          ${infoTile("Failed", String(session.failedAgents || 0))}
          ${infoTile("Started", formatDate(session.startedAt))}
          ${infoTile("Completed", formatDate(session.completedAt))}
          ${infoTile("Session doc", session.paths?.docMd || "-")}
          ${infoTile("Task", session.task?.taskId || session.taskId)}
        </div>
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Subagents</h2>
            <p class="section-copy">Each subtask runs in its own git worktree and integrates into <code>master</code> when done.</p>
          </div>
        </div>
        ${renderAgentsTable(session.agents || [])}
      </div>
      ${selectedAgent ? renderAgentDetail(selectedAgent) : ""}
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Session documentation</h2>
            <p class="section-copy">This file is updated by the main orchestrator after subagents finish.</p>
          </div>
        </div>
        <pre class="markdown-preview">${escapeHtml(session.docContent || "")}</pre>
      </div>
    </div>
  `;
}

function renderAgentDetail(agent) {
  return `
    <div class="stack-card">
      <div class="section-header">
        <div>
          <h2>${escapeHtml(agent.id)} · ${escapeHtml(agent.title)}</h2>
          <p class="section-copy">${escapeHtml(agent.summary || "No summary yet.")}</p>
        </div>
        ${badge(agent.status)}
      </div>
      <div class="info-grid">
        ${infoTile("Branch", agent.branchName || "-")}
        ${infoTile("Worktree", agent.worktreePath || "-")}
        ${infoTile("Base commit", agent.baseCommit || "-")}
        ${infoTile("Integrated master", agent.mergedCommit || "-")}
      </div>
      <div class="grid two">
        <div class="stack-card">
          <h3>Changed files</h3>
          ${agent.changedFiles?.length
            ? `<pre class="markdown-preview">${escapeHtml(agent.changedFiles.join("\n"))}</pre>`
            : emptyState("No changed files", "The subagent has not produced repository changes yet.")}
        </div>
        <div class="stack-card">
          <h3>Tests and risks</h3>
          <pre class="markdown-preview">${escapeHtml([
            "Tests:",
            ...(agent.testsRun || []).map((entry) => `- ${entry}`),
            "",
            "Risks:",
            ...(agent.risks || []).map((entry) => `- ${entry}`),
            "",
            "Notes:",
            ...(agent.notes || []).map((entry) => `- ${entry}`),
          ].join("\n"))}</pre>
        </div>
      </div>
      <div class="code-grid">
        <div class="code-card">
          <h3>stdout</h3>
          <pre>${escapeHtml(state.agentLogs?.stdout || "")}</pre>
        </div>
        <div class="code-card">
          <h3>stderr</h3>
          <pre>${escapeHtml(state.agentLogs?.stderr || "")}</pre>
        </div>
      </div>
    </div>
  `;
}

function renderSettings() {
  const runtime = state.health?.runtime?.metadata || {};
  return `
    <section class="detail-stack">
      <div class="stack-card">
        <div class="section-header">
          <div>
            <p class="eyebrow">Project paths</p>
            <h2>Current runtime roots</h2>
            <p class="section-copy">Project-specific state is stored in <code>.agent-desk</code>. Subagent worktrees are kept outside the repo and never auto-deleted.</p>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile("Project root", state.health?.projectRoot || "-")}
          ${infoTile(".agent-desk", state.health?.deskRoot || "-")}
          ${infoTile("Worktrees root", state.health?.worktreesRoot || "-")}
          ${infoTile("Codex CLI", runtime.codexCliPath || state.health?.runtime?.codexBin || "-")}
        </div>
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Execution defaults</h2>
            <p class="section-copy">Session execution is fixed to the Codex runtime requested in the product requirements.</p>
          </div>
        </div>
        <div class="runtime-capabilities">
          ${renderRuntimeCapability("Model", "enabled", "gpt-5.5")}
          ${renderRuntimeCapability("Reasoning", "enabled", "xhigh")}
          ${renderRuntimeCapability("Service tier", "enabled", "fast")}
          ${renderRuntimeCapability("Batch size", "enabled", "6")}
        </div>
      </div>
      <div class="stack-card">
        <div class="section-header">
          <div>
            <h2>Switch project</h2>
            <p class="section-copy">You can jump between different directories and keep each project's tasks and sessions separate.</p>
          </div>
        </div>
        <form id="project-form" class="project-form inline">
          <label>
            Project path
            <input name="projectRoot" value="${escapeAttr(state.health?.projectRoot || "")}" placeholder="/absolute/path/to/project" autocomplete="off">
          </label>
          <button class="button primary" type="submit">Switch</button>
        </form>
        ${renderProjectTable(state.projects?.items || [])}
      </div>
    </section>
  `;
}

function renderProjectTable(projects) {
  if (!projects.length) {
    return emptyState("No recent projects", "Select a project once and it will stay available here.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            <th>State</th>
            <th>Tasks</th>
            <th>Sessions</th>
            <th>Selected</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map((project) => `
            <tr data-project-root="${escapeAttr(project.projectRoot)}" class="${project.projectRoot === state.health?.projectRoot ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong>${escapeHtml(project.name || "Project")}</strong>
                  <span>${escapeHtml(project.hasDeskState ? "AgentDesk state found" : "No .agent-desk state yet")}</span>
                </div>
              </td>
              <td>${project.hasDeskState ? badge("ready") : badge("empty")}</td>
              <td>${escapeHtml(String(project.taskCount || 0))}</td>
              <td>${escapeHtml(String(project.sessionCount || 0))}</td>
              <td>${escapeHtml(formatDate(project.selectedAt))}</td>
              <td class="mono">${escapeHtml(project.projectRoot)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTasksTable(tasks) {
  if (!tasks.length) {
    return emptyState("No tasks", "Generate a task markdown file to start orchestrating work.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Subtasks</th>
            <th>Sessions</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((task) => `
            <tr data-task-id="${escapeAttr(task.taskId)}" class="${task.taskId === state.selectedTaskId ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong>${escapeHtml(task.title || task.taskId)}</strong>
                  <span>${escapeHtml(task.taskId)}</span>
                </div>
              </td>
              <td>${badge(task.status)}</td>
              <td>${escapeHtml(String(task.subtaskCount || 0))}</td>
              <td>${escapeHtml(String(task.sessionCount || 0))}</td>
              <td>${escapeHtml(formatDate(task.updatedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSessionsTable(sessions) {
  if (!sessions.length) {
    return emptyState("No sessions", "Start a session from a task to launch Codex subagents.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Status</th>
            <th>Parallel</th>
            <th>Succeeded</th>
            <th>Failed</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${sessions.map((session) => `
            <tr data-session-id="${escapeAttr(session.sessionId)}" class="${session.sessionId === state.selectedSessionId ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong>${escapeHtml(session.taskTitle || session.title || session.sessionId)}</strong>
                  <span>${escapeHtml(session.sessionId)}</span>
                </div>
              </td>
              <td>${badge(session.status)}</td>
              <td>${escapeHtml(String(session.parallelism || 0))}</td>
              <td>${escapeHtml(String(session.succeededAgents || 0))}</td>
              <td>${escapeHtml(String(session.failedAgents || 0))}</td>
              <td>${escapeHtml(formatDate(session.updatedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAgentsTable(agents) {
  if (!agents.length) {
    return emptyState("No agents yet", "Agents will appear here once the session expands task.md into subtasks.");
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Branch</th>
            <th>Worktree</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${agents.map((agent) => `
            <tr data-agent-id="${escapeAttr(agent.id)}" class="${agent.id === state.selectedAgentId ? "selected" : ""}">
              <td>
                <div class="row-title">
                  <strong>${escapeHtml(agent.id)}</strong>
                  <span>${escapeHtml(agent.title)}</span>
                </div>
              </td>
              <td>${badge(agent.status)}</td>
              <td class="mono">${escapeHtml(agent.branchName || "-")}</td>
              <td class="mono">${escapeHtml(agent.worktreePath || "-")}</td>
              <td>${escapeHtml(formatDate(agent.updatedAt || agent.completedAt || agent.startedAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRuntimeCapability(labelText, stateText, description) {
  return `
    <span class="runtime-capability ${escapeAttr(stateText)}" data-state="${escapeAttr(stateText)}">
      <strong>${escapeHtml(labelText)}</strong>
      <span>${escapeHtml(description)}</span>
    </span>
  `;
}

function infoTile(labelText, value) {
  return `
    <div class="info-tile">
      <span>${escapeHtml(labelText)}</span>
      <strong class="mono">${escapeHtml(value || "-")}</strong>
    </div>
  `;
}

function emptyState(titleText, bodyText) {
  return `
    <div class="empty empty-state">
      <div>
        <strong>${escapeHtml(titleText)}</strong>
        <p>${escapeHtml(bodyText)}</p>
      </div>
    </div>
  `;
}

function badge(status) {
  const normalized = String(status || "unknown").toLowerCase();
  return `<span class="badge ${escapeAttr(normalized)}">${escapeHtml(label(normalized))}</span>`;
}

function label(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function viewTitle(view) {
  const titles = {
    overview: "Overview",
    tasks: "Tasks",
    sessions: "Sessions",
    settings: "Settings",
  };
  return titles[view] || "Overview";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

async function api(pathname, options = {}) {
  const response = await fetch(pathname, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
