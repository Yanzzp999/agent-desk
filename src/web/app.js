const STARTABLE_TASK_STATUSES = new Set(["ready", "running", "succeeded", "failed"]);

const state = {
  view: "sessions",
  health: null,
  projects: { current: null, items: [] },
  tasks: [],
  selectedTaskId: "",
  taskDetail: null,
  sessions: [],
  selectedSessionId: "",
  sessionDetail: null,
  codeSessions: { items: [], recentItems: [], exactCount: 0, recentCount: 0, roots: [] },
  selectedCodeSessionId: "",
  codeSessionDetail: null,
  selectedAgentId: "",
  agentLogs: null,
  message: "",
};

const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const pageKicker = document.querySelector("#page-kicker");
const projectRoot = document.querySelector("#project-root");
const connection = document.querySelector("#connection-state");
const sidebarProjects = document.querySelector("#sidebar-projects");

document.querySelector("#refresh-button").addEventListener("click", () => refreshAll({ forceSelections: true }));
document.querySelector("#open-project-button").addEventListener("click", () => {
  state.view = "picker";
  render();
});
document.querySelectorAll("[data-sidebar-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.view = button.dataset.sidebarView;
    render();
  });
});

document.body.addEventListener("click", async (event) => {
  const folderButton = event.target.closest("[data-choose-project-folder]");
  if (folderButton) {
    await chooseProjectFolder();
    return;
  }

  const projectOrderButton = event.target.closest("[data-project-order]");
  if (projectOrderButton) {
    await moveProject(projectOrderButton.dataset.projectRoot, projectOrderButton.dataset.projectOrder);
    return;
  }

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

  const codeSessionRow = event.target.closest("[data-code-session-id]");
  if (codeSessionRow) {
    selectCodeSession(codeSessionRow.dataset.codeSessionId);
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

document.body.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.name === "taskId") {
    state.selectedTaskId = String(event.target.value || "");
    render();
  }
});

start();

async function start() {
  await refreshAll({ forceSelections: true });
  connectEvents();
  setInterval(() => refreshAll(), 7000);
}

async function refreshAll(options = {}) {
  try {
    const [projects, health] = await Promise.all([
      api("/api/projects"),
      api("/api/health"),
    ]);

    state.projects = projects;
    state.health = health;

    const hasProject = Boolean(state.health.projectRoot);
    if (!hasProject) {
      clearLoadedProjectState();
      setConnectionState("connected", "Connected");
      render();
      return;
    }

    await Promise.all([loadTasks(), loadSessions(), loadCodeSessions()]);

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
  state.codeSessions = { items: [], recentItems: [], exactCount: 0, recentCount: 0, roots: [] };
  state.selectedCodeSessionId = "";
  state.codeSessionDetail = null;
  state.selectedAgentId = "";
  state.agentLogs = null;
}

async function chooseProjectFolder() {
  if (!window.agentDeskDesktop?.chooseProjectFolder) {
    state.message = "Native folder selection is available in the AgentDesk desktop app.";
    render();
    return;
  }

  try {
    const result = await window.agentDeskDesktop.chooseProjectFolder({
      defaultPath: state.health?.projectRoot || "",
    });
    if (result?.projectRoot) {
      await selectProject(result.projectRoot);
    }
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function selectProject(projectPath) {
  const trimmed = String(projectPath || "").trim();
  if (!trimmed) {
    state.message = "Project path is required.";
    render();
    return;
  }

  if (trimmed === state.health?.projectRoot) {
    state.view = "sessions";
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
    state.view = "sessions";
    clearLoadedProjectState();
    await refreshAll({ forceSelections: true });
  } catch (error) {
    state.message = error.message;
    render();
  }
}

async function moveProject(projectPath, direction) {
  if (!projectPath || !direction) {
    return;
  }

  try {
    state.projects = await api("/api/projects/reorder", {
      method: "POST",
      body: { projectRoot: projectPath, direction },
    });
    render();
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
    state.message = "Choose a task before starting a session.";
    render();
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

async function loadCodeSessions() {
  const result = await api("/api/code-sessions");
  state.codeSessions = result;
  if (state.selectedCodeSessionId) {
    state.codeSessionDetail = findCodeSession(state.selectedCodeSessionId);
  }
  if (state.selectedCodeSessionId && !state.codeSessionDetail) {
    state.selectedCodeSessionId = "";
    state.codeSessionDetail = null;
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
    state.selectedCodeSessionId = "";
    state.codeSessionDetail = null;
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
    state.selectedCodeSessionId = "";
    state.codeSessionDetail = null;
    state.view = "sessions";
  }
  render();
}

function selectCodeSession(sessionId) {
  const session = findCodeSession(sessionId);
  if (!session) {
    return;
  }
  state.selectedCodeSessionId = sessionId;
  state.codeSessionDetail = session;
  state.view = "code-session";
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
  events.addEventListener("projects.reordered", () => {
    setConnectionState("reconnecting", "Projects reordered");
    refreshAll();
  });
  events.onerror = () => {
    setConnectionState("offline", "Offline");
  };
}

function setConnectionState(nextState, labelText) {
  connection.dataset.state = nextState;
  connection.textContent = labelText;
}

function render() {
  const meta = topbarMeta();
  title.textContent = meta.title;
  pageKicker.textContent = meta.kicker;
  projectRoot.textContent = meta.path;
  projectRoot.title = meta.path;

  renderSidebar();

  if (state.view === "picker" || (!state.health?.projectRoot && state.view !== "settings")) {
    app.innerHTML = [renderMessage(), renderProjectPicker()].filter(Boolean).join("");
    return;
  }

  const views = {
    overview: renderOverview,
    tasks: renderTasks,
    sessions: renderSessions,
    "code-session": renderCodeSession,
    settings: renderSettings,
  };

  app.innerHTML = [renderMessage(), (views[state.view] || renderOverview)()].filter(Boolean).join("");
}

function renderSidebar() {
  sidebarProjects.innerHTML = renderSidebarProjectTree(state.projects?.items || []);
  document.querySelectorAll("[data-sidebar-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.sidebarView === state.view);
  });
}

function renderSidebarProjectTree(projects) {
  if (!projects.length) {
    return `<p class="sidebar-empty">Open a project once and its sessions will stay here.</p>`;
  }

  const currentRoot = state.health?.projectRoot || "";
  return `
    <div class="project-tree">
      ${projects.slice(0, 12).map((project) => {
        const isCurrent = project.projectRoot === currentRoot;
        const projectIndex = projects.findIndex((candidate) => candidate.projectRoot === project.projectRoot);
        const childSessions = isCurrent ? state.sessions.slice(0, 12) : [];
        const childCodeSessions = isCurrent ? projectCodeSessions().slice(0, 10) : [];
        return `
          <section class="project-group ${isCurrent ? "selected" : ""}">
            <div class="project-trigger-row">
              <button
                class="project-trigger ${isCurrent ? "selected" : ""}"
                data-project-root="${escapeAttr(project.projectRoot)}"
                type="button"
              >
                <div class="project-trigger-copy">
                  <strong>${escapeHtml(project.name || basename(project.projectRoot))}</strong>
                  <small>${escapeHtml(project.hasDeskState ? `${project.taskCount || 0} tasks · ${project.sessionCount || 0} sessions` : "No AgentDesk state yet")}</small>
                </div>
              </button>
              <div class="project-order-controls" aria-label="Move project">
                <button
                  class="project-order-button"
                  data-project-order="up"
                  data-project-root="${escapeAttr(project.projectRoot)}"
                  type="button"
                  title="Move up"
                  ${projectIndex <= 0 ? "disabled" : ""}
                >↑</button>
                <button
                  class="project-order-button"
                  data-project-order="down"
                  data-project-root="${escapeAttr(project.projectRoot)}"
                  type="button"
                  title="Move down"
                  ${projectIndex >= projects.length - 1 ? "disabled" : ""}
                >↓</button>
              </div>
            </div>
            ${isCurrent ? `
              <div class="project-children">
                <div class="project-child-group">
                  <p class="project-child-heading">AgentDesk</p>
                  ${childSessions.length
                    ? childSessions.map((session) => `
                      <button
                        class="session-node ${session.sessionId === state.selectedSessionId && state.view === "sessions" ? "selected" : ""}"
                        data-session-id="${escapeAttr(session.sessionId)}"
                        type="button"
                      >
                        <span class="session-node-title">${escapeHtml(session.taskTitle || session.title || session.sessionId)}</span>
                        <span class="session-node-time">${escapeHtml(formatRelativeDate(session.updatedAt))}</span>
                      </button>
                    `).join("")
                    : `<p class="sidebar-subempty">No AgentDesk sessions</p>`}
                </div>
                <div class="project-child-group">
                  <p class="project-child-heading">Code</p>
                  ${childCodeSessions.length
                    ? childCodeSessions.map((session) => `
                      <button
                        class="session-node code-session-node ${session.id === state.selectedCodeSessionId && state.view === "code-session" ? "selected" : ""}"
                        data-code-session-id="${escapeAttr(session.id)}"
                        type="button"
                      >
                        <span class="session-node-title">${escapeHtml(session.title || session.conversationId || session.id)}</span>
                        <span class="session-node-time">${escapeHtml(formatRelativeDate(session.updatedAt))}</span>
                      </button>
                    `).join("")
                    : `<p class="sidebar-subempty">No Code sessions</p>`}
                </div>
              </div>
            ` : ""}
          </section>
        `;
      }).join("")}
    </div>
  `;
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
    <section class="start-layout">
      <div class="surface connect-panel primary-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Project</p>
            <h2>Open a folder</h2>
          </div>
        </div>
        <form id="project-form" class="stack-form">
          <label>
            Project path
            <input name="projectRoot" placeholder="/absolute/path/to/project" autocomplete="off">
          </label>
          <div class="button-row">
            <button class="button primary" data-choose-project-folder type="button">Choose folder</button>
            <button class="button" type="submit">Use typed path</button>
          </div>
        </form>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Recent</h2>
          </div>
        </div>
        ${renderProjectList(items)}
      </div>
    </section>
  `;
}

function renderOverview() {
  const readyTasks = countStatuses(state.tasks, ["ready", "running", "succeeded", "failed"]);
  const activeSessions = countStatuses(state.sessions, ["queued", "running"]);
  const latestSession = state.sessions[0] || null;
  const latestTask = state.tasks[0] || null;

  return `
    <section class="surface hero-panel">
      <div class="hero-copy">
        <p class="eyebrow">Workspace overview</p>
        <h2>${escapeHtml(currentProject()?.name || "Project workspace")}</h2>
        <p class="section-copy">This workspace keeps task planning, session execution, and subagent follow-through close together so you can move from idea to integration without leaving the desk.</p>
      </div>
      <div class="metric-grid">
        ${metricTile("Tasks", String(state.health?.counts?.tasks || 0), latestTask ? latestTask.title : "No generated task yet", "accent")}
        ${metricTile("Launchable", String(readyTasks), "Tasks that can start a session right now.", "positive")}
        ${metricTile("Sessions", String(state.health?.counts?.sessions || 0), latestSession ? latestSession.taskTitle || latestSession.sessionId : "No execution history yet", "active")}
        ${metricTile("Active runs", String(activeSessions), activeSessions ? "Queued or running sessions need attention here." : "Nothing currently running.", "warning")}
      </div>
    </section>
    <section class="content-grid three">
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Recent sessions</h2>
            <p class="section-copy">Jump back into the latest execution runs.</p>
          </div>
        </div>
        ${renderSessionList(state.sessions.slice(0, 8), { emptyTitle: "No sessions", emptyBody: "Launch a session from a task to start building history." })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Task queue</h2>
            <p class="section-copy">Tasks stay reusable so you can relaunch from the same planning doc later.</p>
          </div>
        </div>
        ${renderTaskList(state.tasks.slice(0, 8), { emptyTitle: "No tasks", emptyBody: "Generate your first task.md to populate the queue." })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Workspace map</h2>
            <p class="section-copy">Important runtime paths and fixed execution defaults.</p>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile("Project root", state.health?.projectRoot || "-")}
          ${infoTile(".agent-desk", state.health?.deskRoot || "-")}
          ${infoTile("Worktrees root", state.health?.worktreesRoot || "-")}
          ${infoTile("Codex CLI", state.health?.runtime?.metadata?.codexCliPath || state.health?.runtime?.codexBin || "-")}
        </div>
        <div class="pill-row">
          ${renderRuntimeCapability("Model", "enabled", "gpt-5.5")}
          ${renderRuntimeCapability("Reasoning", "enabled", "xhigh")}
          ${renderRuntimeCapability("Service tier", "enabled", "fast")}
          ${renderRuntimeCapability("Batch size", "enabled", "6")}
        </div>
      </div>
    </section>
  `;
}

function renderTasks() {
  return `
    <section class="workbench two-pane">
      <div class="column-stack">
        <div class="surface">
          <div class="section-head">
            <div>
              <p class="eyebrow">Generate task markdown</p>
              <h2>Create a new <code>task.md</code></h2>
              <p class="section-copy">Describe the feature once. AgentDesk keeps the result markdown-first and ready for subagent fan-out.</p>
            </div>
          </div>
          <form id="task-form" class="stack-form">
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
        <div class="surface">
          <div class="section-head">
            <div>
              <h2>Project tasks</h2>
              <p class="section-copy">Every generated planning doc stays available for later launches and review.</p>
            </div>
          </div>
          ${renderTaskList(state.tasks, {
            emptyTitle: "No tasks",
            emptyBody: "Generate a task markdown file to start orchestrating work.",
          })}
        </div>
      </div>
      ${state.taskDetail ? renderTaskDetail(state.taskDetail) : renderEmptyDetail("No task selected", "Choose a task to inspect its markdown, previous sessions, and launch controls.")}
    </section>
  `;
}

function renderTaskDetail(task) {
  const sessions = task.sessions || [];
  const launchable = isTaskStartable(task);
  return `
    <div class="surface detail-pane">
      <header class="detail-header">
        <div>
          <p class="eyebrow">Selected task</p>
          <h2>${escapeHtml(task.title || task.taskId)}</h2>
          <p class="section-copy">${escapeHtml(task.brief || "No brief available.")}</p>
        </div>
        ${badge(task.status)}
      </header>
      <div class="info-grid">
        ${infoTile("Task ID", task.taskId)}
        ${infoTile("Subtasks", String(task.subtaskCount || 0))}
        ${infoTile("Sessions", String(task.sessionCount || sessions.length || 0))}
        ${infoTile("task.md", task.paths?.taskMd || "-")}
      </div>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>Launch session</h3>
            <p class="section-copy">Pick a parallelism cap. AgentDesk still launches fresh subagents in batches of six.</p>
          </div>
        </div>
        <form id="session-form" class="stack-form compact-form">
          <input type="hidden" name="taskId" value="${escapeAttr(task.taskId)}">
          <div class="inline-fields">
            <label>
              Parallel agents
              <input name="parallelism" type="number" min="1" max="24" value="6">
            </label>
            <button class="button primary" type="submit"${launchable ? "" : " disabled"}>Start session</button>
          </div>
        </form>
        ${launchable
          ? `<p class="field-hint">This task can be launched immediately.</p>`
          : `<p class="field-hint">This task must finish generation before it can start a session.</p>`}
      </section>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>Previous sessions</h3>
            <p class="section-copy">Reopen earlier execution runs for the same task at any time.</p>
          </div>
        </div>
        ${renderSessionList(sessions, {
          emptyTitle: "No sessions",
          emptyBody: "Launch the first session from this task when you're ready.",
        })}
      </section>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>task.md</h3>
            <p class="section-copy">Generated markdown used as the source of truth for subagent work.</p>
          </div>
        </div>
        <pre class="markdown-preview">${escapeHtml(task.markdown || "")}</pre>
      </section>
    </div>
  `;
}

function renderSessions() {
  const project = currentProject();
  const selectedTask = state.tasks.find((task) => task.taskId === state.selectedTaskId) || state.tasks[0] || null;
  const canLaunchSelectedTask = selectedTask ? isTaskStartable(selectedTask) : false;
  const codeSessions = projectCodeSessions();
  const readyTasks = countStatuses(state.tasks, ["ready", "running", "succeeded", "failed"]);
  const activeSessions = countStatuses(state.sessions, ["queued", "running"]);
  const selectedTaskTitle = selectedTask?.title || selectedTask?.taskId || "No task selected";
  const selectedTaskSummary = selectedTask
    ? excerpt(selectedTask.brief || "Task markdown is ready for launch and subagent orchestration.", 150)
    : "Generate a task.md first, then launch a session from a reusable planning document.";
  const launchHint = selectedTask
    ? `${selectedTask.title || selectedTask.taskId}${canLaunchSelectedTask ? " is ready to launch." : " is not ready yet."}`
    : "Generate a task first to enable session launch.";

  return `
    <section class="session-dashboard">
      <div class="surface session-command">
        <div class="session-command-copy">
          <p class="eyebrow">Session command center</p>
          <h2>${escapeHtml(project?.name || "Project workspace")}</h2>
          <p class="section-copy">Launch parallel work, inspect subagent outcomes, and keep Codex execution history close to the task source of truth.</p>
          <div class="session-command-meta">
            <span class="meta-kv">
              <span>Project root</span>
              <strong class="mono">${escapeHtml(state.health?.projectRoot || "-")}</strong>
            </span>
            <span class="meta-kv">
              <span>Runtime defaults</span>
              <strong>gpt-5.5 · xhigh · fast · batch 6</strong>
            </span>
          </div>
        </div>
        <div class="metric-grid session-command-metrics">
          ${metricTile("Tasks", String(state.health?.counts?.tasks || 0), selectedTask ? `Selected: ${selectedTaskTitle}` : "No generated task yet.", "accent")}
          ${metricTile("Ready to launch", String(readyTasks), readyTasks ? "Planning docs that can start a session immediately." : "Nothing launch-ready yet.", "positive")}
          ${metricTile("Sessions", String(state.health?.counts?.sessions || 0), state.sessions[0] ? state.sessions[0].taskTitle || state.sessions[0].sessionId : "No execution history yet.", "active")}
          ${metricTile("Live runs", String(activeSessions), activeSessions ? "Queued or running sessions need attention here." : "No session is currently running.", "warning")}
        </div>
      </div>
      <section class="workspace-layout compact-workspace session-workspace">
        <div class="column-stack session-left-rail">
          <div class="surface compact-surface project-summary project-summary-hero">
            <div class="section-head">
              <div>
                <p class="eyebrow">Current workspace</p>
                <h2>${escapeHtml(project?.name || "Project")}</h2>
                <p class="path-copy mono">${escapeHtml(state.health?.projectRoot || "-")}</p>
              </div>
            </div>
            <div class="pill-row">
              ${renderRuntimeCapability("Model", "enabled", "gpt-5.5")}
              ${renderRuntimeCapability("Reasoning", "enabled", "xhigh")}
              ${renderRuntimeCapability("Tier", "enabled", "fast")}
              ${renderRuntimeCapability("Batch", "enabled", "6")}
            </div>
          </div>
          <div class="surface compact-surface launch-panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Launch lane</p>
                <h2>Start a new session</h2>
                <p class="section-copy">Pick a reusable task and choose how many subagents you want active in parallel.</p>
              </div>
            </div>
            <div class="task-focus ${canLaunchSelectedTask ? "launchable" : "waiting"}">
              <div class="task-focus-head">
                <span>Selected task</span>
                ${selectedTask ? badge(selectedTask.status) : `<span class="badge">No Task</span>`}
              </div>
              <strong>${escapeHtml(selectedTaskTitle)}</strong>
              <p>${escapeHtml(selectedTaskSummary)}</p>
            </div>
            <form id="session-form" class="stack-form compact-form">
              <label>
                Task
                <select name="taskId">
                  ${state.tasks.length
                    ? state.tasks.map((task) => `
                      <option value="${escapeAttr(task.taskId)}"${task.taskId === selectedTask?.taskId ? " selected" : ""}>
                        ${escapeHtml(`${task.title || task.taskId} · ${label(task.status)}`)}
                      </option>
                    `).join("")
                    : `<option value="">No tasks available</option>`}
                </select>
              </label>
              <label>
                Parallel agents
                <input name="parallelism" type="number" min="1" max="24" value="6">
              </label>
              <button class="button primary" type="submit"${canLaunchSelectedTask ? "" : " disabled"}>Launch session</button>
            </form>
            <p class="field-hint">${escapeHtml(launchHint)}</p>
          </div>
          <div class="surface compact-surface">
            <div class="section-head">
              <div>
                <h2>Code sessions</h2>
                <p class="section-copy">Local Codex conversations associated with this project root.</p>
              </div>
              <span class="pill active">
                <strong>${escapeHtml(String(codeSessions.length))}</strong>
                <span>Tracked</span>
              </span>
            </div>
            ${renderCodeSessionList(codeSessions, {
              emptyTitle: "No Code sessions",
              emptyBody: "No matching local sessions.",
            })}
          </div>
        </div>
        ${state.sessionDetail ? renderSessionDetail(state.sessionDetail) : renderEmptyDetail("No session selected", "Choose a session from the left rail.")}
      </section>
    </section>
  `;
}

function renderSessionDetail(session) {
  const selectedAgent = session.agents.find((agent) => agent.id === state.selectedAgentId) || null;
  const totalAgents = session.agents?.length || 0;
  const succeededAgents = session.succeededAgents || 0;
  const failedAgents = session.failedAgents || 0;
  const finishedAgents = succeededAgents + failedAgents;
  const inFlightAgents = Math.max(0, totalAgents - finishedAgents);
  const progressLabel = totalAgents ? `${Math.round((finishedAgents / totalAgents) * 100)}%` : "0%";
  const activityTimestamp = session.completedAt || session.updatedAt || session.startedAt;

  return `
    <div class="surface detail-pane session-detail-pane">
      <header class="detail-header session-detail-header">
        <div class="session-heading">
          <div class="eyebrow-row">
            <p class="eyebrow">Selected session</p>
            <span class="session-key mono">${escapeHtml(session.sessionId)}</span>
          </div>
          <h2>${escapeHtml(session.task?.title || session.title || session.sessionId)}</h2>
          <p class="section-copy">${escapeHtml(session.task?.taskId || session.taskId || "Task")} · ${escapeHtml(activityTimestamp ? `${formatRelativeDate(activityTimestamp)} update` : "No recent update")}</p>
        </div>
        <div class="session-status-panel">
          ${badge(session.status)}
          <strong>${escapeHtml(progressLabel)}</strong>
          <span>${escapeHtml(totalAgents ? `${finishedAgents}/${totalAgents} agents finished` : "Waiting for subagents")}</span>
        </div>
      </header>
      <div class="session-scoreboard">
        ${summaryStat("Parallelism", String(session.parallelism || 0), "Configured agent cap")}
        ${summaryStat("Batch size", String(session.batchSize || 0), "Fresh launches per wave")}
        ${summaryStat("Succeeded", String(succeededAgents), totalAgents ? `${Math.round((succeededAgents / totalAgents) * 100)}% of all agents` : "No completed agents yet", "positive")}
        ${summaryStat("Attention", String(failedAgents), failedAgents ? "Failed agents need review" : (inFlightAgents ? `${inFlightAgents} still in flight` : "No failures recorded"), failedAgents ? "danger" : "")}
      </div>
      <div class="detail-card-grid">
        ${detailCard("Started", formatDate(session.startedAt))}
        ${detailCard("Completed", formatDate(session.completedAt))}
        ${detailCard("Task", session.task?.taskId || session.taskId)}
        ${detailCard("Session doc", session.paths?.docMd || "-", { mono: true, wide: true })}
      </div>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>Subagents</h3>
            <p class="section-copy">Review the latest execution wave, then drill into a single subagent for branches, logs, and verification notes.</p>
          </div>
          <div class="pill-row compact">
            <span class="pill ${succeededAgents ? "positive" : ""}">
              <strong>${escapeHtml(String(succeededAgents))}</strong>
              <span>Succeeded</span>
            </span>
            <span class="pill ${failedAgents ? "warning" : ""}">
              <strong>${escapeHtml(String(failedAgents))}</strong>
              <span>Failed</span>
            </span>
            <span class="pill ${inFlightAgents ? "active" : ""}">
              <strong>${escapeHtml(String(inFlightAgents))}</strong>
              <span>Running</span>
            </span>
          </div>
        </div>
        ${renderAgentList(session.agents || [])}
      </section>
      ${selectedAgent ? renderAgentDetail(selectedAgent) : ""}
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>Session documentation</h3>
            <p class="section-copy">The generated session markdown remains the source of truth after orchestration finishes.</p>
          </div>
        </div>
        <pre class="markdown-preview">${escapeHtml(session.docContent || "")}</pre>
      </section>
    </div>
  `;
}

function renderAgentDetail(agent) {
  return `
    <section class="detail-section">
      <div class="section-head">
        <div>
          <h3>${escapeHtml(agent.id)} · ${escapeHtml(agent.title)}</h3>
          <p class="section-copy">${escapeHtml(agent.summary || "No summary yet.")}</p>
        </div>
        ${badge(agent.status)}
      </div>
      <div class="detail-card-grid">
        ${detailCard("Branch", agent.branchName || "-", { mono: true })}
        ${detailCard("Worktree", agent.worktreePath || "-", { mono: true, wide: true })}
        ${detailCard("Base commit", agent.baseCommit || "-", { mono: true })}
        ${detailCard("Integrated master", agent.mergedCommit || "-", { mono: true })}
      </div>
      <div class="detail-split">
        <div class="content-block">
          <h4>Changed files</h4>
          ${agent.changedFiles?.length
            ? `<pre class="markdown-preview">${escapeHtml(agent.changedFiles.join("\n"))}</pre>`
            : emptyState("No changed files", "The subagent has not produced repository changes yet.")}
        </div>
        <div class="content-block">
          <h4>Tests and risks</h4>
          <pre class="markdown-preview">${escapeHtml([
            "Tests:",
            ...(agent.testsRun?.length ? agent.testsRun.map((entry) => `- ${entry}`) : ["- None recorded"]),
            "",
            "Risks:",
            ...(agent.risks?.length ? agent.risks.map((entry) => `- ${entry}`) : ["- None recorded"]),
            "",
            "Notes:",
            ...(agent.notes?.length ? agent.notes.map((entry) => `- ${entry}`) : ["- None recorded"]),
          ].join("\n"))}</pre>
        </div>
      </div>
      <div class="log-grid">
        <div class="content-block">
          <h4>stdout</h4>
          <pre>${escapeHtml(state.agentLogs?.stdout || "")}</pre>
        </div>
        <div class="content-block">
          <h4>stderr</h4>
          <pre>${escapeHtml(state.agentLogs?.stderr || "")}</pre>
        </div>
      </div>
    </section>
  `;
}

function renderCodeSession() {
  const session = state.codeSessionDetail || findCodeSession(state.selectedCodeSessionId);
  if (!session) {
    return renderEmptyDetail("No Code session selected", "Choose a Code session from the current project rail.");
  }

  return `
    <section class="workspace-layout compact-workspace">
      <div class="column-stack">
        <div class="surface compact-surface">
          <div class="section-head">
            <div>
              <h2>Session info</h2>
              <p class="path-copy mono">${escapeHtml(session.cwd || "No workspace path recorded.")}</p>
            </div>
          </div>
          <div class="info-grid">
            ${infoTile("Source", session.source || "-")}
            ${infoTile("Model", session.model || "-")}
            ${infoTile("Reasoning", session.effort || "-")}
            ${infoTile("Updated", formatDate(session.updatedAt))}
          </div>
        </div>
        <div class="surface compact-surface">
          <div class="section-head">
            <div>
              <h2>Project</h2>
            </div>
          </div>
          <div class="info-grid">
            ${infoTile("Working directory", session.cwd || "-")}
            ${infoTile("Conversation ID", session.conversationId || session.id)}
            ${infoTile("Messages", String(session.messageCount || 0))}
            ${infoTile("Tool calls", String(session.toolCallCount || 0))}
          </div>
        </div>
      </div>
      <div class="surface detail-pane">
        <header class="detail-header">
          <div>
            <p class="eyebrow">Conversation preview</p>
            <h2>${escapeHtml(session.title || "Code session")}</h2>
            <p class="path-copy mono">${escapeHtml(session.relativePath || session.sourcePath || "")}</p>
          </div>
          <span class="badge active">Code</span>
        </header>
        <div class="info-grid session-facts">
          ${infoTile("Started", formatDate(session.createdAt))}
          ${infoTile("Updated", formatDate(session.updatedAt))}
          ${infoTile("User messages", String(session.userMessageCount || 0))}
          ${infoTile("Assistant messages", String(session.assistantMessageCount || 0))}
        </div>
        <section class="detail-section">
          <div class="section-head">
            <div>
              <h3>Recent prompts</h3>
            </div>
          </div>
          ${session.prompts?.length
            ? `<pre class="markdown-preview">${escapeHtml(session.prompts.map((prompt) => `- ${prompt}`).join("\n"))}</pre>`
            : emptyState("No prompt preview", "This local session did not expose readable prompt text.")}
        </section>
        <section class="detail-section">
          <div class="section-head">
            <div>
              <h3>Session file</h3>
            </div>
          </div>
          <pre class="markdown-preview">${escapeHtml(session.sourcePath || "")}</pre>
        </section>
      </div>
    </section>
  `;
}

function renderSettings() {
  const runtime = state.health?.runtime?.metadata || {};
  return `
    <section class="content-grid two">
      <div class="surface">
        <div class="section-head">
          <div>
            <p class="eyebrow">Project paths</p>
            <h2>Workspace roots</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile("Project root", state.health?.projectRoot || "-")}
          ${infoTile(".agent-desk", state.health?.deskRoot || "-")}
          ${infoTile("Worktrees root", state.health?.worktreesRoot || "-")}
          ${infoTile("Codex CLI", runtime.codexCliPath || state.health?.runtime?.codexBin || "-")}
        </div>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Execution defaults</h2>
          </div>
        </div>
        <div class="pill-row settings-pills">
          ${renderRuntimeCapability("Model", "enabled", "gpt-5.5")}
          ${renderRuntimeCapability("Reasoning", "enabled", "xhigh")}
          ${renderRuntimeCapability("Service tier", "enabled", "fast")}
          ${renderRuntimeCapability("Batch size", "enabled", "6")}
        </div>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Switch project</h2>
          </div>
        </div>
        <form id="project-form" class="stack-form compact-form">
          <label>
            Project path
            <input name="projectRoot" value="${escapeAttr(state.health?.projectRoot || "")}" placeholder="/absolute/path/to/project" autocomplete="off">
          </label>
          <div class="button-row">
            <button class="button primary" data-choose-project-folder type="button">Choose folder</button>
            <button class="button" type="submit">Use typed path</button>
          </div>
        </form>
        ${renderProjectList(state.projects?.items || [], {
          emptyTitle: "No recent projects",
          emptyBody: "Selected workspaces will appear here.",
        })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Code sessions</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile("Project matches", String(state.codeSessions?.exactCount || 0))}
          ${infoTile("Recent local", String(state.codeSessions?.recentCount || 0))}
          ${infoTile("Active source", codeSessionRootLabel(0))}
          ${infoTile("Archive source", codeSessionRootLabel(1))}
        </div>
        ${renderCodeSessionList((state.codeSessions?.recentItems || []).slice(0, 4), {
          emptyTitle: "No local Code sessions",
          emptyBody: "AgentDesk did not find local Codex conversation files yet.",
        })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>Runtime metadata</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile("Discovery source", runtime.source || "-")}
          ${infoTile("Fast tier", runtime.fast?.tier || "-")}
          ${infoTile("Model count", String(runtime.modelChoices?.length || 0))}
          ${infoTile("Reasoning options", String(runtime.reasoningEfforts?.length || 0))}
        </div>
      </div>
    </section>
  `;
}

function renderProjectList(projects, options = {}) {
  if (!projects.length) {
    return emptyState(options.emptyTitle || "No recent projects", options.emptyBody || "Select a project once and it will stay available here.");
  }

  return `
    <div class="list-stack">
      ${projects.map((project) => `
        <button
          class="list-item project-item ${project.projectRoot === state.health?.projectRoot ? "selected" : ""}"
          data-project-root="${escapeAttr(project.projectRoot)}"
          type="button"
        >
          <div class="list-item-head">
            <div class="list-copy">
              <strong>${escapeHtml(project.name || basename(project.projectRoot))}</strong>
            </div>
            ${badge(project.hasDeskState ? "ready" : "empty")}
          </div>
          <div class="meta-row">
            <span>${escapeHtml(`${project.taskCount || 0} tasks`)}</span>
            <span>${escapeHtml(`${project.sessionCount || 0} sessions`)}</span>
            <span>${escapeHtml(formatRelativeDate(project.selectedAt))}</span>
          </div>
          <p class="path-copy mono">${escapeHtml(project.projectRoot)}</p>
        </button>
      `).join("")}
    </div>
  `;
}

function renderTaskList(tasks, options = {}) {
  if (!tasks.length) {
    return emptyState(options.emptyTitle || "No tasks", options.emptyBody || "Generate a task markdown file to start orchestrating work.");
  }

  return `
    <div class="list-stack">
      ${tasks.map((task) => `
        <button
          class="list-item ${task.taskId === state.selectedTaskId ? "selected" : ""}"
          data-task-id="${escapeAttr(task.taskId)}"
          type="button"
        >
          <div class="list-item-head">
            <div class="list-copy">
              <strong>${escapeHtml(task.title || task.taskId)}</strong>
              <span>${escapeHtml(task.taskId)}</span>
            </div>
            ${badge(task.status)}
          </div>
          <p class="list-description">${escapeHtml(excerpt(task.brief || "Task markdown ready for review and launch.", 150))}</p>
          <div class="meta-row">
            <span>${escapeHtml(`${task.subtaskCount || 0} subtasks`)}</span>
            <span>${escapeHtml(`${task.sessionCount || 0} sessions`)}</span>
            <span>${escapeHtml(formatDate(task.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderSessionList(sessions, options = {}) {
  if (!sessions.length) {
    return emptyState(options.emptyTitle || "No sessions", options.emptyBody || "Start a session from a task to launch Codex subagents.");
  }

  return `
    <div class="list-stack">
      ${sessions.map((session) => `
        <button
          class="list-item session-item ${session.sessionId === state.selectedSessionId ? "selected" : ""}"
          data-session-id="${escapeAttr(session.sessionId)}"
          type="button"
        >
          <div class="list-item-head">
            <div class="list-copy">
              <strong>${escapeHtml(session.taskTitle || session.title || session.sessionId)}</strong>
              <span>${escapeHtml(session.sessionId)}</span>
            </div>
            ${badge(session.status)}
          </div>
          <div class="meta-row">
            <span>${escapeHtml(`${session.parallelism || 0} parallel`)}</span>
            <span>${escapeHtml(`${session.succeededAgents || 0} ok · ${session.failedAgents || 0} failed`)}</span>
            <span>${escapeHtml(formatDate(session.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderCodeSessionList(sessions, options = {}) {
  if (!sessions.length) {
    return emptyState(options.emptyTitle || "No Code sessions", options.emptyBody || "Local Code conversations will appear here.");
  }

  return `
    <div class="list-stack">
      ${sessions.map((session) => `
        <button
          class="list-item code-session-item ${session.id === state.selectedCodeSessionId ? "selected" : ""}"
          data-code-session-id="${escapeAttr(session.id)}"
          type="button"
        >
          <div class="list-item-head">
            <div class="list-copy">
              <strong>${escapeHtml(session.title || session.conversationId || session.id)}</strong>
            </div>
            <span class="badge active">Code</span>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(session.model || "model unknown")}</span>
            <span>${escapeHtml(`${session.messageCount || 0} messages`)}</span>
            <span>${escapeHtml(formatRelativeDate(session.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderAgentList(agents) {
  if (!agents.length) {
    return emptyState("No agents yet", "Agents will appear here once the session expands task.md into executable subtasks.");
  }

  return `
    <div class="list-stack dense">
      ${agents.map((agent) => `
        <button
          class="list-item agent-item ${agent.id === state.selectedAgentId ? "selected" : ""}"
          data-agent-id="${escapeAttr(agent.id)}"
          type="button"
        >
          <div class="list-item-head">
            <div class="list-copy">
              <strong>${escapeHtml(agent.id)}</strong>
              <span>${escapeHtml(agent.title || "No title")}</span>
            </div>
            ${badge(agent.status)}
          </div>
          <p class="list-description">${escapeHtml(excerpt(agent.summary || "No summary yet.", 150))}</p>
          <div class="meta-row">
            <span class="mono">${escapeHtml(agent.branchName || "-")}</span>
            <span>${escapeHtml(formatDate(agent.updatedAt || agent.completedAt || agent.startedAt))}</span>
            <span>${escapeHtml(`${agent.changedFiles?.length || 0} changed files`)}</span>
          </div>
        </button>
      `).join("")}
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

function renderMiniPoint(titleText, bodyText) {
  return `
    <div class="mini-point">
      <strong>${escapeHtml(titleText)}</strong>
      <p>${escapeHtml(bodyText)}</p>
    </div>
  `;
}

function renderFlowStep(index, titleText, bodyText) {
  return `
    <div class="flow-step">
      <span>${escapeHtml(index)}</span>
      <div>
        <strong>${escapeHtml(titleText)}</strong>
        <p>${escapeHtml(bodyText)}</p>
      </div>
    </div>
  `;
}

function metricTile(labelText, value, bodyText, tone = "") {
  return `
    <div class="metric ${escapeAttr(tone)}">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(bodyText)}</p>
    </div>
  `;
}

function compactStat(labelText, value) {
  return `
    <span class="compact-stat">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(labelText)}</span>
    </span>
  `;
}

function summaryStat(labelText, value, detailText, tone = "") {
  return `
    <div class="summary-stat ${escapeAttr(tone)}">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
      <small>${escapeHtml(detailText || "")}</small>
    </div>
  `;
}

function detailCard(labelText, value, options = {}) {
  const classes = [
    "detail-card",
    options.wide ? "wide" : "",
  ].filter(Boolean).join(" ");

  return `
    <div class="${classes}">
      <span>${escapeHtml(labelText)}</span>
      <strong class="${options.mono ? "mono" : ""}">${escapeHtml(value || "-")}</strong>
    </div>
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

function renderEmptyDetail(titleText, bodyText) {
  return `
    <div class="surface detail-pane empty-pane">
      ${emptyState(titleText, bodyText)}
    </div>
  `;
}

function emptyState(titleText, bodyText) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(titleText)}</strong>
      <p>${escapeHtml(bodyText)}</p>
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

function topbarMeta() {
  if (state.view === "picker" || !state.health?.projectRoot) {
    return {
      kicker: "Projects",
      title: "Open project",
      path: "Choose a local folder.",
    };
  }

  if (state.view === "settings") {
    return {
      kicker: "Settings",
      title: "Settings",
      path: state.health?.projectRoot || "Runtime and paths.",
    };
  }

  if (state.view === "tasks") {
    return {
      kicker: currentProject()?.name || "Task workspace",
      title: state.taskDetail?.title || "Tasks",
      path: state.taskDetail?.taskId ? `Task ${state.taskDetail.taskId}` : (state.health?.projectRoot || "Task workspace"),
    };
  }

  if (state.view === "code-session") {
    const session = state.codeSessionDetail || findCodeSession(state.selectedCodeSessionId);
    return {
      kicker: currentProject()?.name || "Code session",
      title: session?.title || "Code session",
      path: session?.cwd || state.health?.projectRoot || "Local Code conversation",
    };
  }

  return {
    kicker: currentProject()?.name || "Project sessions",
    title: "Session workbench",
    path: state.sessionDetail?.sessionId
      ? `${state.sessionDetail.task?.title || state.sessionDetail.taskId || state.sessionDetail.sessionId} · ${state.sessionDetail.sessionId}`
      : state.health?.projectRoot,
  };
}

function currentProject() {
  const currentRoot = state.health?.projectRoot;
  if (!currentRoot) {
    return null;
  }
  return state.projects?.items?.find((item) => item.projectRoot === currentRoot)
    || state.projects?.current
    || {
      projectRoot: currentRoot,
      name: basename(currentRoot),
      taskCount: state.health?.counts?.tasks || 0,
      sessionCount: state.health?.counts?.sessions || 0,
    };
}

function projectCodeSessions() {
  return state.codeSessions?.items || [];
}

function allCodeSessions() {
  const byId = new Map();
  for (const session of [
    ...(state.codeSessions?.items || []),
    ...(state.codeSessions?.recentItems || []),
  ]) {
    byId.set(session.id, session);
  }
  return [...byId.values()];
}

function findCodeSession(sessionId) {
  return allCodeSessions().find((session) => session.id === sessionId) || null;
}

function codeSessionRootLabel(index) {
  const root = state.codeSessions?.roots?.[index];
  if (!root) {
    return "-";
  }
  return root.exists ? root.path : `${root.path} (missing)`;
}

function isTaskStartable(task) {
  return STARTABLE_TASK_STATUSES.has(String(task?.status || "").toLowerCase());
}

function countStatuses(items, statuses) {
  const allowed = new Set(statuses.map((status) => String(status).toLowerCase()));
  return (items || []).filter((item) => allowed.has(String(item?.status || "").toLowerCase())).length;
}

function basename(pathname) {
  return String(pathname || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() || String(pathname || "");
}

function excerpt(value, max = 120) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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

function formatRelativeDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const ranges = [
    { limit: 60_000, unit: "second", size: 1000 },
    { limit: 3_600_000, unit: "minute", size: 60_000 },
    { limit: 86_400_000, unit: "hour", size: 3_600_000 },
    { limit: 604_800_000, unit: "day", size: 86_400_000 },
    { limit: 2_592_000_000, unit: "week", size: 604_800_000 },
    { limit: 31_536_000_000, unit: "month", size: 2_592_000_000 },
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const match = ranges.find((range) => absMs < range.limit) || { unit: "year", size: 31_536_000_000 };
  return formatter.format(Math.round(diffMs / match.size), match.unit);
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
