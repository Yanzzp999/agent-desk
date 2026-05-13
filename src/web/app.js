const STARTABLE_TASK_STATUSES = new Set(["ready", "running", "succeeded", "failed"]);
const STORAGE_KEYS = Object.freeze({
  locale: "agentDesk.locale",
  theme: "agentDesk.theme",
});
const LOCALES = Object.freeze(["en", "zh"]);
const THEMES = Object.freeze(["dark", "light"]);

const I18N = Object.freeze({
  en: {
    "app.subtitle": "Project Orchestrator",
    "nav.openProject": "Open project",
    "nav.projects": "Projects",
    "nav.sessions": "Sessions",
    "nav.settings": "Settings",
    "nav.settingsSubtitle": "Runtime and paths",
    "prefs.aria": "Display preferences",
    "prefs.language.next": "中文",
    "prefs.theme.dark": "Dark",
    "prefs.theme.light": "Light",
    "connection.connected": "Connected",
    "connection.offline": "Offline",
    "connection.reconnecting": "Updating",
    "connection.projectChanged": "Project changed",
    "connection.projectsReordered": "Projects reordered",
    "action.refresh": "Refresh",
    "action.chooseFolder": "Choose folder",
    "action.useTypedPath": "Use typed path",
    "action.launchSession": "Launch session",
    "action.startSession": "Start session",
    "action.generateTask": "Generate task.md",
    "action.addContext": "Add context",
    "action.reviewLatestRun": "Review the latest AgentDesk run",
    "action.openMatchingCodex": "Open the matching Codex conversation",
    "action.moveUp": "Move up",
    "action.moveDown": "Move down",
    "message.nativeFolder": "Native folder selection is available in the AgentDesk desktop app.",
    "message.projectPathRequired": "Project path is required.",
    "message.selectedProject": "Selected {name}",
    "message.startedTask": "Started task generation for {name}",
    "message.chooseTask": "Choose a task before starting a session.",
    "message.startedSession": "Started session {id}",
    "empty.sidebarProjects": "Open a project once and its sessions will stay here.",
    "empty.noDeskState": "No AgentDesk state yet",
    "empty.noDeskSessions": "No AgentDesk sessions",
    "empty.noCodeSessions": "No Code sessions",
    "empty.noMatchingCode": "No matching local sessions.",
    "empty.noSessions": "No sessions",
    "empty.noTasks": "No tasks",
    "empty.noTaskSelected": "No task selected",
    "empty.noSessionSelected": "No session selected",
    "empty.noCodeSessionSelected": "No Code session selected",
    "empty.noTelemetry": "No live telemetry",
    "empty.noAgents": "No agents yet",
    "empty.noChangedFiles": "No changed files",
    "empty.noPromptPreview": "No prompt preview",
    "empty.noRecentProjects": "No recent projects",
    "empty.noCodeSessionBody": "Local Code conversations will appear here.",
    "empty.noTaskBrief": "No brief available.",
    "empty.noPromptPreviewBody": "This local session did not expose readable prompt text.",
    "empty.noWorkspacePath": "No workspace path recorded.",
    "empty.noTitle": "No title",
    "section.project": "Project",
    "section.recent": "Recent",
    "section.workspaceOverview": "Workspace overview",
    "section.recentSessions": "Recent sessions",
    "section.taskQueue": "Task queue",
    "section.workspaceMap": "Workspace map",
    "section.generateTask": "Generate task markdown",
    "section.projectTasks": "Project tasks",
    "section.selectedTask": "Selected task",
    "section.previousSessions": "Previous sessions",
    "section.launchSession": "Launch session",
    "section.contextStack": "Context stack",
    "section.currentUsage": "Current session usage",
    "section.codeSessions": "Code sessions",
    "section.selectedSession": "Selected session",
    "section.subagents": "Subagents",
    "section.sessionDocumentation": "Session documentation",
    "section.launchContext": "Launch context",
    "section.sessionInfo": "Session info",
    "section.conversationPreview": "Conversation preview",
    "section.recentPrompts": "Recent prompts",
    "section.sessionFile": "Session file",
    "section.projectPaths": "Project paths",
    "section.workspaceRoots": "Workspace roots",
    "section.executionDefaults": "Execution defaults",
    "section.switchProject": "Switch project",
    "section.runtimeMetadata": "Runtime metadata",
    "section.preferences": "Preferences",
    "section.launchable": "Launchable",
    "section.activeRuns": "Active runs",
    "copy.workspaceOverview": "This workspace keeps task planning, session execution, and subagent follow-through close together so you can move from idea to integration without leaving the desk.",
    "copy.recentSessions": "Jump back into the latest execution runs.",
    "copy.taskQueue": "Tasks stay reusable so you can relaunch from the same planning doc later.",
    "copy.workspaceMap": "Important runtime paths and fixed execution defaults.",
    "copy.generateTask": "Describe the feature once. AgentDesk keeps the result markdown-first and ready for subagent fan-out.",
    "copy.projectTasks": "Every generated planning doc stays available for later launches and review.",
    "copy.taskEmpty": "Generate a task markdown file to start orchestrating work.",
    "copy.taskDetailEmpty": "Choose a task to inspect its markdown, previous sessions, and launch controls.",
    "copy.launchParallel": "Pick a parallelism cap. AgentDesk still launches fresh subagents in batches of six.",
    "copy.taskLaunchable": "This task can be launched immediately.",
    "copy.taskNotReady": "This task must finish generation before it can start a session.",
    "copy.previousSessions": "Reopen earlier execution runs for the same task at any time.",
    "copy.taskMd": "Generated markdown used as the source of truth for subagent work.",
    "copy.promptTitle": "What should {project} run next?",
    "copy.selectedTaskFallback": "Generate a task.md first, then launch a session from a reusable planning document.",
    "copy.selectedTaskDefault": "Task markdown is ready for launch and subagent orchestration.",
    "copy.launchPlaceholder": "Ask AgentDesk to launch this task with any repo-specific notes, constraints, or acceptance details.",
    "copy.contextStack": "The launch combines the project root, selected task markdown, and extra context.",
    "copy.noCodexPrompt": "No local Codex session matched this project root yet.",
    "copy.usage": "Live token telemetry from the latest local Codex conversation.",
    "copy.noTelemetry": "Start or reopen a local Codex session in this project to show context window and token usage here.",
    "copy.reopenRecent": "Reopen recent execution runs without relying only on the sidebar.",
    "copy.launchFirstSession": "Launch your first session from the composer above.",
    "copy.codeSessions": "Local Codex conversations associated with this project root.",
    "copy.noSessionSelected": "Choose a session from the sidebar or recent sessions list.",
    "copy.sessionUpdate": "{task} · {time} update",
    "copy.noRecentUpdate": "No recent update",
    "copy.agentsFinished": "{finished}/{total} agents finished",
    "copy.waitingAgents": "Waiting for subagents",
    "copy.configuredCap": "Configured agent cap",
    "copy.freshLaunches": "Fresh launches per wave",
    "copy.allAgentsPercent": "{percent}% of all agents",
    "copy.noCompletedAgents": "No completed agents yet",
    "copy.failedNeedReview": "Failed agents need review",
    "copy.stillInFlight": "{count} still in flight",
    "copy.noFailures": "No failures recorded",
    "copy.launchContext": "Extra run-specific guidance that was attached when this session was started.",
    "copy.subagents": "Review the latest execution wave, then drill into a single subagent for branches, logs, and verification notes.",
    "copy.sessionDocumentation": "The generated session markdown remains the source of truth after orchestration finishes.",
    "copy.noChangedFiles": "The subagent has not produced repository changes yet.",
    "copy.codeSessionEmpty": "Choose a Code session from the current project rail.",
    "copy.preferences": "Choose your language and color theme. Preferences are saved on this machine.",
    "copy.selectedWorkspaces": "Selected workspaces will appear here.",
    "copy.noLocalCodeSessions": "AgentDesk did not find local Codex conversation files yet.",
    "copy.tasksStartNow": "Tasks that can start a session right now.",
    "copy.queuedRunning": "Queued or running sessions need attention here.",
    "copy.nothingRunning": "Nothing currently running.",
    "copy.startBuildingHistory": "Launch a session from a task to start building history.",
    "copy.populateQueue": "Generate your first task.md to populate the queue.",
    "copy.launchFirstFromTask": "Launch the first session from this task when you're ready.",
    "copy.noSummary": "No summary yet.",
    "copy.agentListEmpty": "Agents will appear here once the session expands task.md into executable subtasks.",
    "label.projectPath": "Project path",
    "label.taskTitle": "Task title",
    "label.featureBrief": "Feature brief",
    "label.parallelAgents": "Parallel agents",
    "label.task": "Task",
    "label.model": "Model",
    "label.thinking": "Thinking",
    "label.agents": "Agents",
    "label.mode": "Mode",
    "label.branch": "Branch",
    "label.projectRoot": "Project root",
    "label.worktreesRoot": "Worktrees root",
    "label.codexCli": "Codex CLI",
    "label.reasoning": "Reasoning",
    "label.serviceTier": "Service tier",
    "label.batchSize": "Batch size",
    "label.batch": "Batch",
    "label.taskId": "Task ID",
    "label.subtasks": "Subtasks",
    "label.started": "Started",
    "label.completed": "Completed",
    "label.sessionDoc": "Session doc",
    "label.parallelism": "Parallelism",
    "label.succeeded": "Succeeded",
    "label.attention": "Attention",
    "label.failed": "Failed",
    "label.running": "Running",
    "label.branchDetail": "Branch",
    "label.worktree": "Worktree",
    "label.baseCommit": "Base commit",
    "label.integratedMaster": "Integrated master",
    "label.changedFiles": "Changed files",
    "label.testsAndRisks": "Tests and risks",
    "label.source": "Source",
    "label.contextWindow": "Context window",
    "label.updated": "Updated",
    "label.totalTokens": "Total tokens",
    "label.workingDirectory": "Working directory",
    "label.conversationId": "Conversation ID",
    "label.messages": "Messages",
    "label.toolCalls": "Tool calls",
    "label.lastTurnTokens": "Last turn tokens",
    "label.contextUsed": "Context used",
    "label.userMessages": "User messages",
    "label.assistantMessages": "Assistant messages",
    "label.projectMatches": "Project matches",
    "label.recentLocal": "Recent local",
    "label.activeSource": "Active source",
    "label.archiveSource": "Archive source",
    "label.discoverySource": "Discovery source",
    "label.fastTier": "Fast tier",
    "label.modelCount": "Model count",
    "label.reasoningOptions": "Reasoning options",
    "label.language": "Language",
    "label.theme": "Theme",
    "label.input": "Input",
    "label.cached": "Cached",
    "label.output": "Output",
    "label.total": "Total",
    "label.tracked": "Tracked",
    "label.code": "Code",
    "label.tests": "Tests",
    "label.risks": "Risks",
    "label.notes": "Notes",
    "label.noneRecorded": "None recorded",
    "placeholder.projectPath": "/absolute/path/to/project",
    "placeholder.optionalTitle": "Optional title",
    "placeholder.featureBrief": "Describe the feature, constraints, and expected outcome",
    "meta.tasks": "{count} tasks",
    "meta.sessions": "{count} sessions",
    "meta.parallel": "{count} parallel",
    "meta.agentResults": "{ok} ok · {failed} failed",
    "meta.tokens": "{count} tokens",
    "meta.messages": "{count} messages",
    "meta.changedFiles": "{count} changed files",
    "status.ready": "Ready",
    "status.running": "Running",
    "status.succeeded": "Succeeded",
    "status.failed": "Failed",
    "status.stopped": "Stopped",
    "status.queued": "Queued",
    "status.launching": "Launching",
    "status.received": "Received",
    "status.generating": "Generating",
    "status.needs_attention": "Needs Attention",
    "status.empty": "Empty",
    "status.unknown": "Unknown",
    "reasoning.auto": "Auto",
    "reasoning.default": "Default",
    "reasoning.low": "Low",
    "reasoning.medium": "Medium",
    "reasoning.high": "High",
    "reasoning.xhigh": "Extra High",
    "reasoning.extraHigh": "Extra High",
    "theme.dark": "Dark",
    "theme.light": "Light",
    "locale.en": "English",
    "locale.zh": "中文",
    "topbar.projects": "Projects",
    "topbar.openProject": "Open project",
    "topbar.chooseFolder": "Choose a local folder.",
    "topbar.settingsPath": "Runtime and paths.",
    "topbar.taskWorkspace": "Task workspace",
    "topbar.tasks": "Tasks",
    "topbar.codeSession": "Code session",
    "topbar.localCode": "Local Code conversation",
    "topbar.projectSessions": "Project sessions",
    "topbar.sessionWorkbench": "Session workbench",
  },
  zh: {
    "app.subtitle": "项目编排工作台",
    "nav.openProject": "打开项目",
    "nav.projects": "项目",
    "nav.sessions": "会话",
    "nav.settings": "设置",
    "nav.settingsSubtitle": "运行时与路径",
    "prefs.aria": "显示偏好",
    "prefs.language.next": "EN",
    "prefs.theme.dark": "深色",
    "prefs.theme.light": "浅色",
    "connection.connected": "已连接",
    "connection.offline": "离线",
    "connection.reconnecting": "更新中",
    "connection.projectChanged": "项目已切换",
    "connection.projectsReordered": "项目已排序",
    "action.refresh": "刷新",
    "action.chooseFolder": "选择文件夹",
    "action.useTypedPath": "使用输入路径",
    "action.launchSession": "启动会话",
    "action.startSession": "开始会话",
    "action.generateTask": "生成 task.md",
    "action.addContext": "添加上下文",
    "action.reviewLatestRun": "查看最近的 AgentDesk 运行",
    "action.openMatchingCodex": "打开匹配的 Codex 会话",
    "action.moveUp": "上移",
    "action.moveDown": "下移",
    "message.nativeFolder": "原生文件夹选择仅在 AgentDesk 桌面应用中可用。",
    "message.projectPathRequired": "请输入项目路径。",
    "message.selectedProject": "已选择 {name}",
    "message.startedTask": "已开始为 {name} 生成任务",
    "message.chooseTask": "启动会话前请先选择一个任务。",
    "message.startedSession": "已启动会话 {id}",
    "empty.sidebarProjects": "打开一次项目后，它的会话会留在这里。",
    "empty.noDeskState": "还没有 AgentDesk 状态",
    "empty.noDeskSessions": "暂无 AgentDesk 会话",
    "empty.noCodeSessions": "暂无 Code 会话",
    "empty.noMatchingCode": "没有匹配的本地会话。",
    "empty.noSessions": "暂无会话",
    "empty.noTasks": "暂无任务",
    "empty.noTaskSelected": "未选择任务",
    "empty.noSessionSelected": "未选择会话",
    "empty.noCodeSessionSelected": "未选择 Code 会话",
    "empty.noTelemetry": "暂无实时用量",
    "empty.noAgents": "暂无子代理",
    "empty.noChangedFiles": "暂无变更文件",
    "empty.noPromptPreview": "暂无提示词预览",
    "empty.noRecentProjects": "暂无最近项目",
    "empty.noCodeSessionBody": "本地 Code 会话会显示在这里。",
    "empty.noTaskBrief": "暂无简介。",
    "empty.noPromptPreviewBody": "这个本地会话没有可读取的提示词文本。",
    "empty.noWorkspacePath": "未记录工作区路径。",
    "empty.noTitle": "无标题",
    "section.project": "项目",
    "section.recent": "最近",
    "section.workspaceOverview": "工作区概览",
    "section.recentSessions": "最近会话",
    "section.taskQueue": "任务队列",
    "section.workspaceMap": "工作区地图",
    "section.generateTask": "生成任务 Markdown",
    "section.projectTasks": "项目任务",
    "section.selectedTask": "已选任务",
    "section.previousSessions": "历史会话",
    "section.launchSession": "启动会话",
    "section.contextStack": "上下文栈",
    "section.currentUsage": "当前会话用量",
    "section.codeSessions": "Code 会话",
    "section.selectedSession": "已选会话",
    "section.subagents": "子代理",
    "section.sessionDocumentation": "会话文档",
    "section.launchContext": "启动上下文",
    "section.sessionInfo": "会话信息",
    "section.conversationPreview": "对话预览",
    "section.recentPrompts": "最近提示词",
    "section.sessionFile": "会话文件",
    "section.projectPaths": "项目路径",
    "section.workspaceRoots": "工作区根目录",
    "section.executionDefaults": "执行默认值",
    "section.switchProject": "切换项目",
    "section.runtimeMetadata": "运行时元数据",
    "section.preferences": "偏好设置",
    "section.launchable": "可启动",
    "section.activeRuns": "活跃运行",
    "copy.workspaceOverview": "这个工作区把任务规划、会话执行和子代理跟进放在一起，让你不用离开工作台就能从想法推进到集成。",
    "copy.recentSessions": "快速回到最近的执行运行。",
    "copy.taskQueue": "任务会保持可复用，之后可以从同一份规划文档重新启动。",
    "copy.workspaceMap": "重要运行路径和固定执行默认值。",
    "copy.generateTask": "只描述一次功能。AgentDesk 会保留 Markdown 优先的结果，并准备好子代理分发。",
    "copy.projectTasks": "每份生成的规划文档都会保留，方便之后启动和审阅。",
    "copy.taskEmpty": "生成一个任务 Markdown 文件即可开始编排。",
    "copy.taskDetailEmpty": "选择一个任务来查看 Markdown、历史会话和启动控件。",
    "copy.launchParallel": "选择并行上限。AgentDesk 仍会按每批 6 个启动新的子代理。",
    "copy.taskLaunchable": "这个任务可以立即启动。",
    "copy.taskNotReady": "这个任务需要生成完成后才能启动会话。",
    "copy.previousSessions": "随时重新打开同一任务的早期执行运行。",
    "copy.taskMd": "生成的 Markdown 是子代理工作的事实来源。",
    "copy.promptTitle": "{project} 接下来要运行什么？",
    "copy.selectedTaskFallback": "先生成 task.md，再从可复用的规划文档启动会话。",
    "copy.selectedTaskDefault": "任务 Markdown 已准备好启动和编排子代理。",
    "copy.launchPlaceholder": "告诉 AgentDesk 启动此任务，并补充仓库相关说明、约束或验收细节。",
    "copy.contextStack": "启动会组合项目根目录、已选任务 Markdown 和额外上下文。",
    "copy.noCodexPrompt": "没有匹配此项目根目录的本地 Codex 会话。",
    "copy.usage": "来自最近本地 Codex 对话的实时 token 遥测。",
    "copy.noTelemetry": "在此项目中启动或重新打开本地 Codex 会话后，会在这里显示上下文窗口和 token 用量。",
    "copy.reopenRecent": "不用只依赖侧边栏，也可以重新打开最近的执行运行。",
    "copy.launchFirstSession": "从上方编排器启动第一个会话。",
    "copy.codeSessions": "与此项目根目录关联的本地 Codex 对话。",
    "copy.noSessionSelected": "从侧边栏或最近会话列表中选择一个会话。",
    "copy.sessionUpdate": "{task} · {time} 更新",
    "copy.noRecentUpdate": "暂无最近更新",
    "copy.agentsFinished": "{finished}/{total} 个子代理已完成",
    "copy.waitingAgents": "等待子代理",
    "copy.configuredCap": "配置的子代理上限",
    "copy.freshLaunches": "每轮新启动数量",
    "copy.allAgentsPercent": "占全部子代理 {percent}%",
    "copy.noCompletedAgents": "暂无已完成子代理",
    "copy.failedNeedReview": "失败的子代理需要检查",
    "copy.stillInFlight": "还有 {count} 个运行中",
    "copy.noFailures": "未记录失败",
    "copy.launchContext": "启动此会话时附加的运行专属说明。",
    "copy.subagents": "查看最近的执行轮次，再进入单个子代理查看分支、日志和验证说明。",
    "copy.sessionDocumentation": "编排完成后，生成的会话 Markdown 仍是事实来源。",
    "copy.noChangedFiles": "这个子代理还没有产生仓库变更。",
    "copy.codeSessionEmpty": "从当前项目栏中选择一个 Code 会话。",
    "copy.preferences": "选择语言和颜色主题。偏好会保存在本机。",
    "copy.selectedWorkspaces": "选过的工作区会显示在这里。",
    "copy.noLocalCodeSessions": "AgentDesk 还没有找到本地 Codex 对话文件。",
    "copy.tasksStartNow": "现在可以启动会话的任务。",
    "copy.queuedRunning": "排队或运行中的会话需要在这里关注。",
    "copy.nothingRunning": "当前没有运行中的内容。",
    "copy.startBuildingHistory": "从任务启动会话后即可开始积累历史。",
    "copy.populateQueue": "生成第一个 task.md 来填充队列。",
    "copy.launchFirstFromTask": "准备好后，从这个任务启动第一个会话。",
    "copy.noSummary": "暂无总结。",
    "copy.agentListEmpty": "当会话把 task.md 展开成可执行子任务后，子代理会显示在这里。",
    "label.projectPath": "项目路径",
    "label.taskTitle": "任务标题",
    "label.featureBrief": "功能简介",
    "label.parallelAgents": "并行代理",
    "label.task": "任务",
    "label.model": "模型",
    "label.thinking": "思考深度",
    "label.agents": "代理",
    "label.mode": "模式",
    "label.branch": "分支",
    "label.projectRoot": "项目根目录",
    "label.worktreesRoot": "工作树根目录",
    "label.codexCli": "Codex CLI",
    "label.reasoning": "推理",
    "label.serviceTier": "服务层级",
    "label.batchSize": "批量大小",
    "label.batch": "批次",
    "label.taskId": "任务 ID",
    "label.subtasks": "子任务",
    "label.started": "开始时间",
    "label.completed": "完成时间",
    "label.sessionDoc": "会话文档",
    "label.parallelism": "并行度",
    "label.succeeded": "成功",
    "label.attention": "需关注",
    "label.failed": "失败",
    "label.running": "运行中",
    "label.branchDetail": "分支",
    "label.worktree": "工作树",
    "label.baseCommit": "基准提交",
    "label.integratedMaster": "已集成 master",
    "label.changedFiles": "变更文件",
    "label.testsAndRisks": "测试与风险",
    "label.source": "来源",
    "label.contextWindow": "上下文窗口",
    "label.updated": "更新时间",
    "label.totalTokens": "总 token",
    "label.workingDirectory": "工作目录",
    "label.conversationId": "对话 ID",
    "label.messages": "消息",
    "label.toolCalls": "工具调用",
    "label.lastTurnTokens": "上一轮 token",
    "label.contextUsed": "上下文占用",
    "label.userMessages": "用户消息",
    "label.assistantMessages": "助手消息",
    "label.projectMatches": "项目匹配",
    "label.recentLocal": "最近本地",
    "label.activeSource": "活跃来源",
    "label.archiveSource": "归档来源",
    "label.discoverySource": "发现来源",
    "label.fastTier": "快速层级",
    "label.modelCount": "模型数量",
    "label.reasoningOptions": "思考选项",
    "label.language": "语言",
    "label.theme": "主题",
    "label.input": "输入",
    "label.cached": "缓存",
    "label.output": "输出",
    "label.total": "总计",
    "label.tracked": "已跟踪",
    "label.code": "Code",
    "label.tests": "测试",
    "label.risks": "风险",
    "label.notes": "备注",
    "label.noneRecorded": "暂无记录",
    "placeholder.projectPath": "/absolute/path/to/project",
    "placeholder.optionalTitle": "可选标题",
    "placeholder.featureBrief": "描述功能、约束和预期结果",
    "meta.tasks": "{count} 个任务",
    "meta.sessions": "{count} 个会话",
    "meta.parallel": "{count} 并行",
    "meta.agentResults": "{ok} 成功 · {failed} 失败",
    "meta.tokens": "{count} tokens",
    "meta.messages": "{count} 条消息",
    "meta.changedFiles": "{count} 个变更文件",
    "status.ready": "就绪",
    "status.running": "运行中",
    "status.succeeded": "成功",
    "status.failed": "失败",
    "status.stopped": "已停止",
    "status.queued": "排队中",
    "status.launching": "启动中",
    "status.received": "已接收",
    "status.generating": "生成中",
    "status.needs_attention": "需关注",
    "status.empty": "空",
    "status.unknown": "未知",
    "reasoning.auto": "自动",
    "reasoning.default": "默认",
    "reasoning.low": "低",
    "reasoning.medium": "中",
    "reasoning.high": "高",
    "reasoning.xhigh": "超高",
    "reasoning.extraHigh": "超高",
    "theme.dark": "深色",
    "theme.light": "浅色",
    "locale.en": "English",
    "locale.zh": "中文",
    "topbar.projects": "项目",
    "topbar.openProject": "打开项目",
    "topbar.chooseFolder": "选择一个本地文件夹。",
    "topbar.settingsPath": "运行时与路径。",
    "topbar.taskWorkspace": "任务工作区",
    "topbar.tasks": "任务",
    "topbar.codeSession": "Code 会话",
    "topbar.localCode": "本地 Code 对话",
    "topbar.projectSessions": "项目会话",
    "topbar.sessionWorkbench": "会话工作台",
  },
});

const state = {
  view: "sessions",
  preferences: {
    locale: normalizeStoredValue(readPreference(STORAGE_KEYS.locale), LOCALES, "en"),
    theme: normalizeStoredValue(readPreference(STORAGE_KEYS.theme), THEMES, "dark"),
  },
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
  sessionComposer: {
    model: "",
    reasoning: "",
    parallelism: 6,
    launchPrompt: "",
  },
  message: "",
};

const app = document.querySelector("#app");
const title = document.querySelector("#page-title");
const pageKicker = document.querySelector("#page-kicker");
const projectRoot = document.querySelector("#project-root");
const connection = document.querySelector("#connection-state");
const sidebarProjects = document.querySelector("#sidebar-projects");
const brandSubtitle = document.querySelector("#brand-subtitle");
const openProjectButton = document.querySelector("#open-project-button");
const refreshButton = document.querySelector("#refresh-button");
const sidebarProjectsSection = document.querySelector(".sidebar-projects-section");
const sidebarProjectsLabel = document.querySelector("#sidebar-projects-label");
const sidebarSessionsLabel = document.querySelector("#sidebar-sessions-label");
const settingsNavLabel = document.querySelector("#settings-nav-label");
const settingsNavSubtitle = document.querySelector("#settings-nav-subtitle");
const preferenceSwitches = document.querySelector(".preference-switches");
const localeToggle = document.querySelector("#locale-toggle");
const localeToggleLabel = document.querySelector("#locale-toggle-label");
const themeToggle = document.querySelector("#theme-toggle");
const themeToggleLabel = document.querySelector("#theme-toggle-label");

refreshButton.addEventListener("click", () => refreshAll({ forceSelections: true }));
openProjectButton.addEventListener("click", () => {
  state.view = "picker";
  render();
});
localeToggle.addEventListener("click", () => {
  setLocale(state.preferences.locale === "en" ? "zh" : "en");
});
themeToggle.addEventListener("click", () => {
  setTheme(state.preferences.theme === "dark" ? "light" : "dark");
});
document.querySelectorAll("[data-sidebar-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.view = button.dataset.sidebarView;
    render();
  });
});

document.body.addEventListener("click", async (event) => {
  const preferenceButton = event.target.closest("[data-preference]");
  if (preferenceButton) {
    if (preferenceButton.dataset.preference === "locale") {
      setLocale(preferenceButton.dataset.value);
    }
    if (preferenceButton.dataset.preference === "theme") {
      setTheme(preferenceButton.dataset.value);
    }
    return;
  }

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
    await startSession(String(form.get("taskId") || ""), {
      parallelism: Number(form.get("parallelism") || 6),
      model: String(form.get("model") || ""),
      reasoning: String(form.get("reasoning") || ""),
      launchPrompt: String(form.get("launchPrompt") || ""),
    });
  }
});

document.body.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === "parallelism") {
    syncSessionComposer();
    state.sessionComposer.parallelism = normalizeComposerParallelism(event.target.value);
    return;
  }

  if (event.target instanceof HTMLTextAreaElement && event.target.name === "launchPrompt") {
    syncSessionComposer();
    state.sessionComposer.launchPrompt = event.target.value;
  }
});

document.body.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.name === "taskId") {
    state.selectedTaskId = String(event.target.value || "");
    render();
    return;
  }

  if (event.target instanceof HTMLSelectElement && event.target.name === "model") {
    syncSessionComposer();
    state.sessionComposer.model = String(event.target.value || "");
    state.sessionComposer.reasoning = defaultReasoningForModel(
      state.sessionComposer.model,
      state.sessionComposer.reasoning,
    );
    render();
    return;
  }

  if (event.target instanceof HTMLSelectElement && event.target.name === "reasoning") {
    syncSessionComposer();
    state.sessionComposer.reasoning = String(event.target.value || "");
    render();
  }
});

applyPreferences();
start();

async function start() {
  await refreshAll({ forceSelections: true });
  connectEvents();
  setInterval(() => refreshAll(), 7000);
}

function setLocale(locale) {
  const nextLocale = normalizeStoredValue(locale, LOCALES, state.preferences.locale);
  if (nextLocale === state.preferences.locale) {
    return;
  }
  state.preferences.locale = nextLocale;
  writePreference(STORAGE_KEYS.locale, nextLocale);
  applyPreferences();
  render();
}

function setTheme(theme) {
  const nextTheme = normalizeStoredValue(theme, THEMES, state.preferences.theme);
  if (nextTheme === state.preferences.theme) {
    return;
  }
  state.preferences.theme = nextTheme;
  writePreference(STORAGE_KEYS.theme, nextTheme);
  applyPreferences();
  render();
}

function applyPreferences() {
  document.documentElement.lang = state.preferences.locale === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.locale = state.preferences.locale;
  document.documentElement.dataset.theme = state.preferences.theme;
  renderChrome();
}

function renderChrome() {
  brandSubtitle.textContent = t("app.subtitle");
  openProjectButton.textContent = t("nav.openProject");
  refreshButton.textContent = t("action.refresh");
  sidebarProjectsSection.setAttribute("aria-label", t("nav.projects"));
  sidebarProjectsLabel.textContent = t("nav.projects");
  sidebarSessionsLabel.textContent = t("nav.sessions");
  settingsNavLabel.textContent = t("nav.settings");
  settingsNavSubtitle.textContent = t("nav.settingsSubtitle");
  preferenceSwitches.setAttribute("aria-label", t("prefs.aria"));
  localeToggle.setAttribute("aria-label", t("label.language"));
  localeToggleLabel.textContent = t("prefs.language.next");
  themeToggle.setAttribute("aria-label", t("label.theme"));
  themeToggleLabel.textContent = t(state.preferences.theme === "dark" ? "prefs.theme.light" : "prefs.theme.dark");
  const connectionState = connection.dataset.state || "reconnecting";
  const connectionLabel = connection.dataset.labelKey || `connection.${connectionState}`;
  connection.textContent = t(connectionLabel);
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
      setConnectionState("connected");
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

    setConnectionState("connected");
  } catch (error) {
    state.message = error.message;
    setConnectionState("offline");
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
  state.sessionComposer = {
    model: "",
    reasoning: "",
    parallelism: 6,
    launchPrompt: "",
  };
}

async function chooseProjectFolder() {
  if (!window.agentDeskDesktop?.chooseProjectFolder) {
    state.message = t("message.nativeFolder");
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
    state.message = t("message.projectPathRequired");
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
    state.message = t("message.selectedProject", { name: result.current?.name || trimmed });
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
    state.message = t("message.startedTask", { name: task.title || task.taskId });
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

async function startSession(taskId, request = {}) {
  if (!taskId) {
    state.message = t("message.chooseTask");
    render();
    return;
  }

  try {
    const session = await api(`/api/tasks/${encodeURIComponent(taskId)}/sessions`, {
      method: "POST",
      body: request,
    });
    state.message = t("message.startedSession", { id: session.sessionId });
    syncSessionComposer();
    state.sessionComposer.launchPrompt = "";
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
    setConnectionState("reconnecting");
    refreshAll();
  });
  events.addEventListener("project.changed", () => {
    setConnectionState("reconnecting", "connection.projectChanged");
    refreshAll({ forceSelections: true });
  });
  events.addEventListener("projects.reordered", () => {
    setConnectionState("reconnecting", "connection.projectsReordered");
    refreshAll();
  });
  events.onerror = () => {
    setConnectionState("offline");
  };
}

function setConnectionState(nextState, labelKey = `connection.${nextState}`) {
  connection.dataset.state = nextState;
  connection.dataset.labelKey = labelKey;
  connection.textContent = t(labelKey);
}

function render() {
  renderChrome();
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
    return `<p class="sidebar-empty">${escapeHtml(t("empty.sidebarProjects"))}</p>`;
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
                  <small>${escapeHtml(project.hasDeskState
                    ? `${t("meta.tasks", { count: project.taskCount || 0 })} · ${t("meta.sessions", { count: project.sessionCount || 0 })}`
                    : t("empty.noDeskState"))}</small>
                </div>
              </button>
              <div class="project-order-controls" aria-label="${escapeAttr(t("action.moveUp"))}">
                <button
                  class="project-order-button"
                  data-project-order="up"
                  data-project-root="${escapeAttr(project.projectRoot)}"
                  type="button"
                  title="${escapeAttr(t("action.moveUp"))}"
                  ${projectIndex <= 0 ? "disabled" : ""}
                >↑</button>
                <button
                  class="project-order-button"
                  data-project-order="down"
                  data-project-root="${escapeAttr(project.projectRoot)}"
                  type="button"
                  title="${escapeAttr(t("action.moveDown"))}"
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
                    : `<p class="sidebar-subempty">${escapeHtml(t("empty.noDeskSessions"))}</p>`}
                </div>
                <div class="project-child-group">
                  <p class="project-child-heading">${escapeHtml(t("label.code"))}</p>
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
                    : `<p class="sidebar-subempty">${escapeHtml(t("empty.noCodeSessions"))}</p>`}
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
            <p class="eyebrow">${escapeHtml(t("section.project"))}</p>
            <h2>${escapeHtml(t("topbar.openProject"))}</h2>
          </div>
        </div>
        <form id="project-form" class="stack-form">
          <label>
            ${escapeHtml(t("label.projectPath"))}
            <input name="projectRoot" placeholder="${escapeAttr(t("placeholder.projectPath"))}" autocomplete="off">
          </label>
          <div class="button-row">
            <button class="button primary" data-choose-project-folder type="button">${escapeHtml(t("action.chooseFolder"))}</button>
            <button class="button" type="submit">${escapeHtml(t("action.useTypedPath"))}</button>
          </div>
        </form>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.recent"))}</h2>
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
        <p class="eyebrow">${escapeHtml(t("section.workspaceOverview"))}</p>
        <h2>${escapeHtml(currentProject()?.name || t("topbar.taskWorkspace"))}</h2>
        <p class="section-copy">${escapeHtml(t("copy.workspaceOverview"))}</p>
      </div>
      <div class="metric-grid">
        ${metricTile(t("topbar.tasks"), String(state.health?.counts?.tasks || 0), latestTask ? latestTask.title : t("empty.noTasks"), "accent")}
        ${metricTile(t("section.launchable"), String(readyTasks), t("copy.tasksStartNow"), "positive")}
        ${metricTile(t("nav.sessions"), String(state.health?.counts?.sessions || 0), latestSession ? latestSession.taskTitle || latestSession.sessionId : t("empty.noSessions"), "active")}
        ${metricTile(t("section.activeRuns"), String(activeSessions), activeSessions ? t("copy.queuedRunning") : t("copy.nothingRunning"), "warning")}
      </div>
    </section>
    <section class="content-grid three">
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.recentSessions"))}</h2>
            <p class="section-copy">${escapeHtml(t("copy.recentSessions"))}</p>
          </div>
        </div>
        ${renderSessionList(state.sessions.slice(0, 8), { emptyTitle: t("empty.noSessions"), emptyBody: t("copy.startBuildingHistory") })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.taskQueue"))}</h2>
            <p class="section-copy">${escapeHtml(t("copy.taskQueue"))}</p>
          </div>
        </div>
        ${renderTaskList(state.tasks.slice(0, 8), { emptyTitle: t("empty.noTasks"), emptyBody: t("copy.populateQueue") })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.workspaceMap"))}</h2>
            <p class="section-copy">${escapeHtml(t("copy.workspaceMap"))}</p>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile(t("label.projectRoot"), state.health?.projectRoot || "-")}
          ${infoTile(".agent-desk", state.health?.deskRoot || "-")}
          ${infoTile(t("label.worktreesRoot"), state.health?.worktreesRoot || "-")}
          ${infoTile(t("label.codexCli"), state.health?.runtime?.metadata?.codexCliPath || state.health?.runtime?.codexBin || "-")}
        </div>
        <div class="pill-row">
          ${renderRuntimeCapability(t("label.model"), "enabled", "gpt-5.5")}
          ${renderRuntimeCapability(t("label.reasoning"), "enabled", "xhigh")}
          ${renderRuntimeCapability(t("label.serviceTier"), "enabled", "fast")}
          ${renderRuntimeCapability(t("label.batchSize"), "enabled", "6")}
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
              <p class="eyebrow">${escapeHtml(t("section.generateTask"))}</p>
              <h2>${escapeHtml(t("section.generateTask"))}</h2>
              <p class="section-copy">${escapeHtml(t("copy.generateTask"))}</p>
            </div>
          </div>
          <form id="task-form" class="stack-form">
            <label>
              ${escapeHtml(t("label.taskTitle"))}
              <input name="title" placeholder="${escapeAttr(t("placeholder.optionalTitle"))}">
            </label>
            <label>
              ${escapeHtml(t("label.featureBrief"))}
              <textarea name="brief" placeholder="${escapeAttr(t("placeholder.featureBrief"))}"></textarea>
            </label>
            <button class="button primary" type="submit">${escapeHtml(t("action.generateTask"))}</button>
          </form>
        </div>
        <div class="surface">
          <div class="section-head">
            <div>
              <h2>${escapeHtml(t("section.projectTasks"))}</h2>
              <p class="section-copy">${escapeHtml(t("copy.projectTasks"))}</p>
            </div>
          </div>
          ${renderTaskList(state.tasks, {
            emptyTitle: t("empty.noTasks"),
            emptyBody: t("copy.taskEmpty"),
          })}
        </div>
      </div>
      ${state.taskDetail ? renderTaskDetail(state.taskDetail) : renderEmptyDetail(t("empty.noTaskSelected"), t("copy.taskDetailEmpty"))}
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
          <p class="eyebrow">${escapeHtml(t("section.selectedTask"))}</p>
          <h2>${escapeHtml(task.title || task.taskId)}</h2>
          <p class="section-copy">${escapeHtml(task.brief || t("empty.noTaskBrief"))}</p>
        </div>
        ${badge(task.status)}
      </header>
      <div class="info-grid">
        ${infoTile(t("label.taskId"), task.taskId)}
        ${infoTile(t("label.subtasks"), String(task.subtaskCount || 0))}
        ${infoTile(t("nav.sessions"), String(task.sessionCount || sessions.length || 0))}
        ${infoTile("task.md", task.paths?.taskMd || "-")}
      </div>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(t("section.launchSession"))}</h3>
            <p class="section-copy">${escapeHtml(t("copy.launchParallel"))}</p>
          </div>
        </div>
        <form id="session-form" class="stack-form compact-form">
          <input type="hidden" name="taskId" value="${escapeAttr(task.taskId)}">
          <div class="inline-fields">
            <label>
              ${escapeHtml(t("label.parallelAgents"))}
              <input name="parallelism" type="number" min="1" max="24" value="6">
            </label>
            <button class="button primary" type="submit"${launchable ? "" : " disabled"}>${escapeHtml(t("action.startSession"))}</button>
          </div>
        </form>
        ${launchable
          ? `<p class="field-hint">${escapeHtml(t("copy.taskLaunchable"))}</p>`
          : `<p class="field-hint">${escapeHtml(t("copy.taskNotReady"))}</p>`}
      </section>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(t("section.previousSessions"))}</h3>
            <p class="section-copy">${escapeHtml(t("copy.previousSessions"))}</p>
          </div>
        </div>
        ${renderSessionList(sessions, {
          emptyTitle: t("empty.noSessions"),
          emptyBody: t("copy.launchFirstFromTask"),
        })}
      </section>
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>task.md</h3>
            <p class="section-copy">${escapeHtml(t("copy.taskMd"))}</p>
          </div>
        </div>
        <pre class="markdown-preview">${escapeHtml(task.markdown || "")}</pre>
      </section>
    </div>
  `;
}

function renderSessions() {
  syncSessionComposer();
  const project = currentProject();
  const selectedTask = state.tasks.find((task) => task.taskId === state.selectedTaskId) || state.tasks[0] || null;
  const canLaunchSelectedTask = selectedTask ? isTaskStartable(selectedTask) : false;
  const codeSessions = projectCodeSessions();
  const liveCodeSession = currentProjectCodeSession();
  const composerModel = findRuntimeModel(state.sessionComposer.model);
  const reasoningChoices = reasoningChoicesForModel(state.sessionComposer.model);
  const selectedTaskTitle = selectedTask?.title || selectedTask?.taskId || t("empty.noTaskSelected");
  const selectedTaskSummary = selectedTask
    ? excerpt(selectedTask.brief || t("copy.selectedTaskDefault"), 150)
    : t("copy.selectedTaskFallback");
  const tokenUsage = liveCodeSession?.tokenUsage?.total || null;
  const tokenUsagePercent = contextWindowUsagePercent(liveCodeSession);

  return `
    <section class="codex-session-workbench">
      <div class="codex-prompt-stage">
        <div class="prompt-title-block">
          <p class="eyebrow">AgentDesk</p>
          <h2>${escapeHtml(t("copy.promptTitle", { project: project?.name || t("section.project") }))}</h2>
        </div>
        <form id="session-form" class="codex-prompt-composer">
          <div class="prompt-task-strip ${canLaunchSelectedTask ? "launchable" : "waiting"}">
            <div class="prompt-task-copy">
              <span>${escapeHtml(t("section.selectedTask"))}</span>
              <strong>${escapeHtml(selectedTaskTitle)}</strong>
              <p>${escapeHtml(selectedTaskSummary)}</p>
            </div>
            <div class="prompt-task-actions">
              ${selectedTask ? badge(selectedTask.status) : `<span class="badge">${escapeHtml(t("empty.noTaskSelected"))}</span>`}
              <label class="task-menu">
                <span>${escapeHtml(t("label.task"))}</span>
                <select name="taskId" aria-label="${escapeAttr(t("label.task"))}">
                  ${state.tasks.length
                    ? state.tasks.map((task) => `
                      <option value="${escapeAttr(task.taskId)}"${task.taskId === selectedTask?.taskId ? " selected" : ""}>
                        ${escapeHtml(`${task.title || task.taskId} · ${label(task.status)}`)}
                      </option>
                    `).join("")
                    : `<option value="">${escapeHtml(t("empty.noTasks"))}</option>`}
                </select>
              </label>
            </div>
          </div>
          <label class="prompt-input-label">
            <span>${escapeHtml(t("section.launchContext"))}</span>
            <textarea
              class="composer-input"
              name="launchPrompt"
              placeholder="${escapeAttr(t("copy.launchPlaceholder"))}"
            >${escapeHtml(state.sessionComposer.launchPrompt || "")}</textarea>
          </label>
          <div class="prompt-toolbar">
            <button class="prompt-tool-button" type="button" title="${escapeAttr(t("action.addContext"))}" aria-label="${escapeAttr(t("action.addContext"))}">+</button>
            <div class="prompt-picker-cluster">
              <label class="codex-picker">
                <span>${escapeHtml(t("label.model"))}</span>
                <select name="model" aria-label="${escapeAttr(t("label.model"))}">
                  ${runtimeModelChoices().map((model) => `
                    <option value="${escapeAttr(model.value)}"${model.value === state.sessionComposer.model ? " selected" : ""}>
                      ${escapeHtml(model.label || model.value)}
                    </option>
                  `).join("")}
                </select>
              </label>
              <label class="codex-picker reasoning-picker">
                <span>${escapeHtml(t("label.thinking"))}</span>
                <select name="reasoning" aria-label="${escapeAttr(t("label.thinking"))}">
                  ${reasoningChoices.map((entry) => {
                    const value = entry.value || entry.effort || "";
                    return `
                    <option value="${escapeAttr(value)}"${value === state.sessionComposer.reasoning ? " selected" : ""}>
                      ${escapeHtml(reasoningDisplayLabel(entry.label || value))}
                    </option>
                  `;
                  }).join("")}
                </select>
              </label>
              <label class="codex-picker compact-number-picker">
                <span>${escapeHtml(t("label.agents"))}</span>
                <input name="parallelism" aria-label="${escapeAttr(t("label.parallelAgents"))}" type="number" min="1" max="24" value="${escapeAttr(String(state.sessionComposer.parallelism || 6))}">
              </label>
              <span class="codex-static-pill">fast</span>
            </div>
            <button class="codex-send-button" type="submit" title="${escapeAttr(t("action.launchSession"))}" aria-label="${escapeAttr(t("action.launchSession"))}"${canLaunchSelectedTask ? "" : " disabled"}>↑</button>
          </div>
        </form>
        <div class="prompt-context-bar">
          ${contextPill(project?.name || t("section.project"), basename(state.health?.projectRoot || "workspace"))}
          ${contextPill(t("label.mode"), "local")}
          ${contextPill(t("label.branch"), "master")}
          ${contextPill(t("label.model"), `${composerModel?.label || state.sessionComposer.model || "GPT-5.5"} · ${reasoningCompactLabel(state.sessionComposer.reasoning || "xhigh")}`)}
        </div>
        <div class="prompt-suggestions">
          <button type="button" data-session-id="${escapeAttr(state.selectedSessionId || "")}"${state.selectedSessionId ? "" : " disabled"}>${escapeHtml(t("action.reviewLatestRun"))}</button>
          <button type="button" data-code-session-id="${escapeAttr(liveCodeSession?.id || "")}"${liveCodeSession?.id ? "" : " disabled"}>${escapeHtml(t("action.openMatchingCodex"))}</button>
        </div>
      </div>
      <div class="composer-shell-grid">
        <div class="composer-sidecard">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(t("section.contextStack"))}</h3>
              <p class="section-copy">${escapeHtml(t("copy.contextStack"))}</p>
            </div>
          </div>
          <div class="context-stack">
            ${contextResource(t("label.projectRoot"), state.health?.projectRoot || "-", { mono: true })}
            ${contextResource("task.md", selectedTask?.paths?.taskMd || "-", { mono: true })}
            ${contextResource(t("label.featureBrief"), selectedTaskSummary)}
            ${liveCodeSession
              ? contextResource("Latest Codex prompt", liveCodeSession.prompts?.[0] || liveCodeSession.title || t("empty.noPromptPreview"))
              : contextResource("Latest Codex prompt", t("copy.noCodexPrompt"))}
          </div>
        </div>
        <div class="composer-sidecard token-usage-card">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(t("section.currentUsage"))}</h3>
              <p class="section-copy">${escapeHtml(t("copy.usage"))}</p>
            </div>
          </div>
          ${liveCodeSession
            ? `
              <div class="token-hero">
                <strong>${escapeHtml(formatTokenCount(tokenUsage?.totalTokens || 0))}</strong>
                <span>${escapeHtml(t("label.totalTokens"))}</span>
              </div>
              <div class="token-meter">
                <div class="token-meter-fill" style="width: ${escapeAttr(String(tokenUsagePercent))}%"></div>
              </div>
              <div class="token-meta-row">
                <span>${escapeHtml(`${tokenUsagePercent}% of ${formatTokenCount(liveCodeSession.contextWindow || 0)} context`)}</span>
                <span>${escapeHtml(formatRelativeDate(liveCodeSession.tokenUsage?.updatedAt || liveCodeSession.updatedAt))}</span>
              </div>
              <div class="token-grid">
                ${tokenStat(t("label.input"), tokenUsage?.inputTokens || 0)}
                ${tokenStat(t("label.cached"), tokenUsage?.cachedInputTokens || 0)}
                ${tokenStat(t("label.output"), tokenUsage?.outputTokens || 0)}
                ${tokenStat(t("label.reasoning"), tokenUsage?.reasoningOutputTokens || 0)}
              </div>
            `
            : emptyState(t("empty.noTelemetry"), t("copy.noTelemetry"))}
        </div>
      </div>
      <div class="session-workbench-grid">
        <div class="column-stack">
          <div class="surface">
            <div class="section-head">
              <div>
                <h2>${escapeHtml(t("section.recentSessions"))}</h2>
                <p class="section-copy">${escapeHtml(t("copy.reopenRecent"))}</p>
              </div>
            </div>
            ${renderSessionList(state.sessions, {
              emptyTitle: t("empty.noSessions"),
              emptyBody: t("copy.launchFirstSession"),
            })}
          </div>
          <div class="surface">
            <div class="section-head">
              <div>
                <h2>${escapeHtml(t("section.codeSessions"))}</h2>
                <p class="section-copy">${escapeHtml(t("copy.codeSessions"))}</p>
              </div>
              <span class="pill active">
                <strong>${escapeHtml(String(codeSessions.length))}</strong>
                <span>${escapeHtml(t("label.tracked"))}</span>
              </span>
            </div>
            ${renderCodeSessionList(codeSessions, {
              emptyTitle: t("empty.noCodeSessions"),
              emptyBody: t("empty.noMatchingCode"),
            })}
          </div>
        </div>
        ${state.sessionDetail ? renderSessionDetail(state.sessionDetail) : renderEmptyDetail(t("empty.noSessionSelected"), t("copy.noSessionSelected"))}
      </div>
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
            <p class="eyebrow">${escapeHtml(t("section.selectedSession"))}</p>
            <span class="session-key mono">${escapeHtml(session.sessionId)}</span>
          </div>
          <h2>${escapeHtml(session.task?.title || session.title || session.sessionId)}</h2>
          <p class="section-copy">${escapeHtml(activityTimestamp
            ? t("copy.sessionUpdate", { task: session.task?.taskId || session.taskId || t("label.task"), time: formatRelativeDate(activityTimestamp) })
            : t("copy.noRecentUpdate"))}</p>
        </div>
        <div class="session-status-panel">
          ${badge(session.status)}
          <strong>${escapeHtml(progressLabel)}</strong>
          <span>${escapeHtml(totalAgents ? t("copy.agentsFinished", { finished: finishedAgents, total: totalAgents }) : t("copy.waitingAgents"))}</span>
        </div>
      </header>
      <div class="session-scoreboard">
        ${summaryStat(t("label.parallelism"), String(session.parallelism || 0), t("copy.configuredCap"))}
        ${summaryStat(t("label.batchSize"), String(session.batchSize || 0), t("copy.freshLaunches"))}
        ${summaryStat(t("label.succeeded"), String(succeededAgents), totalAgents ? t("copy.allAgentsPercent", { percent: Math.round((succeededAgents / totalAgents) * 100) }) : t("copy.noCompletedAgents"), "positive")}
        ${summaryStat(t("label.attention"), String(failedAgents), failedAgents ? t("copy.failedNeedReview") : (inFlightAgents ? t("copy.stillInFlight", { count: inFlightAgents }) : t("copy.noFailures")), failedAgents ? "danger" : "")}
      </div>
      <div class="detail-card-grid">
        ${detailCard(t("label.model"), session.model || "gpt-5.5")}
        ${detailCard(t("label.reasoning"), session.reasoning || "xhigh")}
        ${detailCard(t("label.started"), formatDate(session.startedAt))}
        ${detailCard(t("label.completed"), formatDate(session.completedAt))}
        ${detailCard(t("label.task"), session.task?.taskId || session.taskId)}
        ${detailCard(t("label.sessionDoc"), session.paths?.docMd || "-", { mono: true, wide: true })}
      </div>
      ${session.launchPrompt
        ? `
          <section class="detail-section">
            <div class="section-head">
              <div>
                <h3>${escapeHtml(t("section.launchContext"))}</h3>
                <p class="section-copy">${escapeHtml(t("copy.launchContext"))}</p>
              </div>
            </div>
            <div class="context-note">${escapeHtml(session.launchPrompt)}</div>
          </section>
        `
        : ""}
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(t("section.subagents"))}</h3>
            <p class="section-copy">${escapeHtml(t("copy.subagents"))}</p>
          </div>
          <div class="pill-row compact">
            <span class="pill ${succeededAgents ? "positive" : ""}">
              <strong>${escapeHtml(String(succeededAgents))}</strong>
              <span>${escapeHtml(t("label.succeeded"))}</span>
            </span>
            <span class="pill ${failedAgents ? "warning" : ""}">
              <strong>${escapeHtml(String(failedAgents))}</strong>
              <span>${escapeHtml(t("label.failed"))}</span>
            </span>
            <span class="pill ${inFlightAgents ? "active" : ""}">
              <strong>${escapeHtml(String(inFlightAgents))}</strong>
              <span>${escapeHtml(t("label.running"))}</span>
            </span>
          </div>
        </div>
        ${renderAgentList(session.agents || [])}
      </section>
      ${selectedAgent ? renderAgentDetail(selectedAgent) : ""}
      <section class="detail-section">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(t("section.sessionDocumentation"))}</h3>
            <p class="section-copy">${escapeHtml(t("copy.sessionDocumentation"))}</p>
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
          <p class="section-copy">${escapeHtml(agent.summary || t("copy.noSummary"))}</p>
        </div>
        ${badge(agent.status)}
      </div>
      <div class="detail-card-grid">
        ${detailCard(t("label.branchDetail"), agent.branchName || "-", { mono: true })}
        ${detailCard(t("label.worktree"), agent.worktreePath || "-", { mono: true, wide: true })}
        ${detailCard(t("label.baseCommit"), agent.baseCommit || "-", { mono: true })}
        ${detailCard(t("label.integratedMaster"), agent.mergedCommit || "-", { mono: true })}
      </div>
      <div class="detail-split">
        <div class="content-block">
          <h4>${escapeHtml(t("label.changedFiles"))}</h4>
          ${agent.changedFiles?.length
            ? `<pre class="markdown-preview">${escapeHtml(agent.changedFiles.join("\n"))}</pre>`
            : emptyState(t("empty.noChangedFiles"), t("copy.noChangedFiles"))}
        </div>
        <div class="content-block">
          <h4>${escapeHtml(t("label.testsAndRisks"))}</h4>
          <pre class="markdown-preview">${escapeHtml([
            `${t("label.tests")}:`,
            ...(agent.testsRun?.length ? agent.testsRun.map((entry) => `- ${entry}`) : [`- ${t("label.noneRecorded")}`]),
            "",
            `${t("label.risks")}:`,
            ...(agent.risks?.length ? agent.risks.map((entry) => `- ${entry}`) : [`- ${t("label.noneRecorded")}`]),
            "",
            `${t("label.notes")}:`,
            ...(agent.notes?.length ? agent.notes.map((entry) => `- ${entry}`) : [`- ${t("label.noneRecorded")}`]),
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
    return renderEmptyDetail(t("empty.noCodeSessionSelected"), t("copy.codeSessionEmpty"));
  }
  const totalTokens = session.tokenUsage?.total || {};
  const lastTokens = session.tokenUsage?.last || {};
  const usagePercent = contextWindowUsagePercent(session);

  return `
    <section class="workspace-layout compact-workspace">
      <div class="column-stack">
        <div class="surface compact-surface">
          <div class="section-head">
            <div>
              <h2>${escapeHtml(t("section.sessionInfo"))}</h2>
              <p class="path-copy mono">${escapeHtml(session.cwd || t("empty.noWorkspacePath"))}</p>
            </div>
          </div>
          <div class="info-grid">
            ${infoTile(t("label.source"), session.source || "-")}
            ${infoTile(t("label.model"), session.model || "-")}
            ${infoTile(t("label.reasoning"), session.effort || "-")}
            ${infoTile(t("label.contextWindow"), formatTokenCount(session.contextWindow || 0))}
            ${infoTile(t("label.updated"), formatDate(session.updatedAt))}
            ${infoTile(t("label.totalTokens"), formatTokenCount(totalTokens.totalTokens || 0))}
          </div>
        </div>
        <div class="surface compact-surface">
          <div class="section-head">
            <div>
              <h2>${escapeHtml(t("section.project"))}</h2>
            </div>
          </div>
          <div class="info-grid">
            ${infoTile(t("label.workingDirectory"), session.cwd || "-")}
            ${infoTile(t("label.conversationId"), session.conversationId || session.id)}
            ${infoTile(t("label.messages"), String(session.messageCount || 0))}
            ${infoTile(t("label.toolCalls"), String(session.toolCallCount || 0))}
            ${infoTile(t("label.lastTurnTokens"), formatTokenCount(lastTokens.totalTokens || 0))}
            ${infoTile(t("label.contextUsed"), `${usagePercent}%`)}
          </div>
        </div>
      </div>
      <div class="surface detail-pane">
        <header class="detail-header">
          <div>
            <p class="eyebrow">${escapeHtml(t("section.conversationPreview"))}</p>
            <h2>${escapeHtml(session.title || t("topbar.codeSession"))}</h2>
            <p class="path-copy mono">${escapeHtml(session.relativePath || session.sourcePath || "")}</p>
          </div>
          <span class="badge active">${escapeHtml(t("label.code"))}</span>
        </header>
        <div class="info-grid session-facts">
          ${infoTile(t("label.started"), formatDate(session.createdAt))}
          ${infoTile(t("label.updated"), formatDate(session.updatedAt))}
          ${infoTile(t("label.userMessages"), String(session.userMessageCount || 0))}
          ${infoTile(t("label.assistantMessages"), String(session.assistantMessageCount || 0))}
        </div>
        <section class="detail-section">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(t("section.recentPrompts"))}</h3>
            </div>
          </div>
          ${session.prompts?.length
            ? `<pre class="markdown-preview">${escapeHtml(session.prompts.map((prompt) => `- ${prompt}`).join("\n"))}</pre>`
            : emptyState(t("empty.noPromptPreview"), t("empty.noPromptPreviewBody"))}
        </section>
        <section class="detail-section">
          <div class="section-head">
            <div>
              <h3>${escapeHtml(t("section.sessionFile"))}</h3>
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
      <div class="surface preferences-panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${escapeHtml(t("section.preferences"))}</p>
            <h2>${escapeHtml(t("section.preferences"))}</h2>
            <p class="section-copy">${escapeHtml(t("copy.preferences"))}</p>
          </div>
        </div>
        <div class="preference-grid">
          ${preferenceControl(t("label.language"), [
            { value: "en", label: t("locale.en"), active: state.preferences.locale === "en", preference: "locale" },
            { value: "zh", label: t("locale.zh"), active: state.preferences.locale === "zh", preference: "locale" },
          ])}
          ${preferenceControl(t("label.theme"), [
            { value: "dark", label: t("theme.dark"), active: state.preferences.theme === "dark", preference: "theme" },
            { value: "light", label: t("theme.light"), active: state.preferences.theme === "light", preference: "theme" },
          ])}
        </div>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <p class="eyebrow">${escapeHtml(t("section.projectPaths"))}</p>
            <h2>${escapeHtml(t("section.workspaceRoots"))}</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile(t("label.projectRoot"), state.health?.projectRoot || "-")}
          ${infoTile(".agent-desk", state.health?.deskRoot || "-")}
          ${infoTile(t("label.worktreesRoot"), state.health?.worktreesRoot || "-")}
          ${infoTile(t("label.codexCli"), runtime.codexCliPath || state.health?.runtime?.codexBin || "-")}
        </div>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.executionDefaults"))}</h2>
          </div>
        </div>
        <div class="pill-row settings-pills">
          ${renderRuntimeCapability(t("label.model"), "enabled", "gpt-5.5")}
          ${renderRuntimeCapability(t("label.reasoning"), "enabled", "xhigh")}
          ${renderRuntimeCapability(t("label.serviceTier"), "enabled", "fast")}
          ${renderRuntimeCapability(t("label.batchSize"), "enabled", "6")}
        </div>
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.switchProject"))}</h2>
          </div>
        </div>
        <form id="project-form" class="stack-form compact-form">
          <label>
            ${escapeHtml(t("label.projectPath"))}
            <input name="projectRoot" value="${escapeAttr(state.health?.projectRoot || "")}" placeholder="${escapeAttr(t("placeholder.projectPath"))}" autocomplete="off">
          </label>
          <div class="button-row">
            <button class="button primary" data-choose-project-folder type="button">${escapeHtml(t("action.chooseFolder"))}</button>
            <button class="button" type="submit">${escapeHtml(t("action.useTypedPath"))}</button>
          </div>
        </form>
        ${renderProjectList(state.projects?.items || [], {
          emptyTitle: t("empty.noRecentProjects"),
          emptyBody: t("copy.selectedWorkspaces"),
        })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.codeSessions"))}</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile(t("label.projectMatches"), String(state.codeSessions?.exactCount || 0))}
          ${infoTile(t("label.recentLocal"), String(state.codeSessions?.recentCount || 0))}
          ${infoTile(t("label.activeSource"), codeSessionRootLabel(0))}
          ${infoTile(t("label.archiveSource"), codeSessionRootLabel(1))}
        </div>
        ${renderCodeSessionList((state.codeSessions?.recentItems || []).slice(0, 4), {
          emptyTitle: t("empty.noCodeSessions"),
          emptyBody: t("copy.noLocalCodeSessions"),
        })}
      </div>
      <div class="surface">
        <div class="section-head">
          <div>
            <h2>${escapeHtml(t("section.runtimeMetadata"))}</h2>
          </div>
        </div>
        <div class="info-grid">
          ${infoTile(t("label.discoverySource"), runtime.source || "-")}
          ${infoTile(t("label.fastTier"), runtime.fast?.tier || "-")}
          ${infoTile(t("label.modelCount"), String(runtime.modelChoices?.length || 0))}
          ${infoTile(t("label.reasoningOptions"), String(runtime.reasoningEfforts?.length || 0))}
        </div>
      </div>
    </section>
  `;
}

function renderProjectList(projects, options = {}) {
  if (!projects.length) {
    return emptyState(options.emptyTitle || t("empty.noRecentProjects"), options.emptyBody || t("empty.sidebarProjects"));
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
            <span>${escapeHtml(t("meta.tasks", { count: project.taskCount || 0 }))}</span>
            <span>${escapeHtml(t("meta.sessions", { count: project.sessionCount || 0 }))}</span>
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
    return emptyState(options.emptyTitle || t("empty.noTasks"), options.emptyBody || t("copy.taskEmpty"));
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
          <p class="list-description">${escapeHtml(excerpt(task.brief || t("copy.selectedTaskDefault"), 150))}</p>
          <div class="meta-row">
            <span>${escapeHtml(`${task.subtaskCount || 0} ${t("label.subtasks").toLowerCase()}`)}</span>
            <span>${escapeHtml(t("meta.sessions", { count: task.sessionCount || 0 }))}</span>
            <span>${escapeHtml(formatDate(task.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderSessionList(sessions, options = {}) {
  if (!sessions.length) {
    return emptyState(options.emptyTitle || t("empty.noSessions"), options.emptyBody || t("copy.startBuildingHistory"));
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
            <span>${escapeHtml(t("meta.parallel", { count: session.parallelism || 0 }))}</span>
            <span>${escapeHtml(t("meta.agentResults", { ok: session.succeededAgents || 0, failed: session.failedAgents || 0 }))}</span>
            <span>${escapeHtml(formatDate(session.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderCodeSessionList(sessions, options = {}) {
  if (!sessions.length) {
    return emptyState(options.emptyTitle || t("empty.noCodeSessions"), options.emptyBody || t("empty.noCodeSessionBody"));
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
            <span class="badge active">${escapeHtml(t("label.code"))}</span>
          </div>
          <div class="meta-row">
            <span>${escapeHtml(session.model || "model unknown")}</span>
            <span>${escapeHtml(t("meta.tokens", { count: formatTokenCount(session.tokenUsage?.total?.totalTokens || 0) }))}</span>
            <span>${escapeHtml(t("meta.messages", { count: session.messageCount || 0 }))}</span>
            <span>${escapeHtml(formatRelativeDate(session.updatedAt))}</span>
          </div>
        </button>
      `).join("")}
    </div>
  `;
}

function renderAgentList(agents) {
  if (!agents.length) {
    return emptyState(t("empty.noAgents"), t("copy.agentListEmpty"));
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
              <span>${escapeHtml(agent.title || t("empty.noTitle"))}</span>
            </div>
            ${badge(agent.status)}
          </div>
          <p class="list-description">${escapeHtml(excerpt(agent.summary || t("copy.noSummary"), 150))}</p>
          <div class="meta-row">
            <span class="mono">${escapeHtml(agent.branchName || "-")}</span>
            <span>${escapeHtml(formatDate(agent.updatedAt || agent.completedAt || agent.startedAt))}</span>
            <span>${escapeHtml(t("meta.changedFiles", { count: agent.changedFiles?.length || 0 }))}</span>
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

function preferenceControl(labelText, options) {
  return `
    <div class="preference-control">
      <span>${escapeHtml(labelText)}</span>
      <div class="segmented-control">
        ${options.map((option) => `
          <button
            class="${option.active ? "active" : ""}"
            data-preference="${escapeAttr(option.preference)}"
            data-value="${escapeAttr(option.value)}"
            type="button"
          >${escapeHtml(option.label)}</button>
        `).join("")}
      </div>
    </div>
  `;
}

function contextPill(labelText, value) {
  return `
    <span class="context-pill">
      <strong>${escapeHtml(labelText)}</strong>
      <span>${escapeHtml(value || "-")}</span>
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

function tokenStat(labelText, value) {
  return `
    <div class="token-stat">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(formatTokenCount(value || 0))}</strong>
    </div>
  `;
}

function contextResource(labelText, value, options = {}) {
  return `
    <div class="context-resource ${options.mono ? "mono" : ""}">
      <span>${escapeHtml(labelText)}</span>
      <strong>${escapeHtml(value || "-")}</strong>
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
  const normalized = String(value || "unknown").toLowerCase();
  const statusKey = `status.${normalized}`;
  if (I18N[state.preferences.locale]?.[statusKey]) {
    return t(statusKey);
  }
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function t(key, values = {}) {
  const localeStrings = I18N[state.preferences.locale] || I18N.en;
  const template = localeStrings[key] || I18N.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function readPreference(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "";
  }
}

function writePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; the app still works when storage is unavailable.
  }
}

function normalizeStoredValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function reasoningDisplayLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized || normalized === "default") {
    return t("reasoning.auto");
  }
  if (normalized === "xhigh" || normalized === "extra high") {
    return t("reasoning.xhigh");
  }
  if (I18N[state.preferences.locale]?.[`reasoning.${normalized}`]) {
    return t(`reasoning.${normalized}`);
  }
  return label(value);
}

function reasoningCompactLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized || normalized === "default") {
    return t("reasoning.auto");
  }
  if (normalized === "xhigh" || normalized === "extra high") {
    return t("reasoning.xhigh");
  }
  if (I18N[state.preferences.locale]?.[`reasoning.${normalized}`]) {
    return t(`reasoning.${normalized}`);
  }
  return label(value);
}

function runtimeMetadata() {
  return state.health?.runtime?.metadata || {};
}

function runtimeModelChoices() {
  const choices = runtimeMetadata().modelChoices || [];
  if (choices.length > 0) {
    return choices;
  }
  return [{
    value: "gpt-5.5",
    label: "GPT-5.5",
    defaultReasoning: "xhigh",
    reasoningEfforts: [{ value: "xhigh", label: "xhigh" }],
  }];
}

function findRuntimeModel(modelValue) {
  return runtimeModelChoices().find((model) => model.value === modelValue) || runtimeModelChoices()[0] || null;
}

function reasoningChoicesForModel(modelValue) {
  const runtime = runtimeMetadata();
  const model = findRuntimeModel(modelValue);
  const modelChoices = Array.isArray(model?.reasoningEfforts) && model.reasoningEfforts.length
    ? model.reasoningEfforts
    : [];
  if (modelChoices.length > 0) {
    return modelChoices;
  }
  return runtime.reasoningOptions || runtime.reasoningEfforts || [{ value: "xhigh", label: "xhigh" }];
}

function defaultReasoningForModel(modelValue, currentValue = "") {
  const choices = reasoningChoicesForModel(modelValue);
  const currentSupported = choices.some((entry) => (entry.value || entry.effort) === currentValue);
  if (currentSupported) {
    return currentValue;
  }
  const model = findRuntimeModel(modelValue);
  return model?.defaultReasoning
    || choices[0]?.value
    || choices[0]?.effort
    || "xhigh";
}

function syncSessionComposer() {
  const defaults = runtimeMetadata().defaults || {};
  const nextModel = state.sessionComposer.model || defaults.model || runtimeModelChoices()[0]?.value || "gpt-5.5";
  state.sessionComposer.model = findRuntimeModel(nextModel)?.value || "gpt-5.5";
  state.sessionComposer.reasoning = defaultReasoningForModel(
    state.sessionComposer.model,
    state.sessionComposer.reasoning || defaults.reasoning || "",
  );
  state.sessionComposer.parallelism = normalizeComposerParallelism(
    state.sessionComposer.parallelism || defaults.parallelism || 6,
  );
  state.sessionComposer.launchPrompt = String(state.sessionComposer.launchPrompt || "");
}

function normalizeComposerParallelism(value) {
  const number = Number(value || 6);
  if (!Number.isFinite(number)) {
    return 6;
  }
  return Math.max(1, Math.min(24, Math.floor(number)));
}

function currentProjectCodeSession() {
  return projectCodeSessions()[0] || null;
}

function contextWindowUsagePercent(session) {
  const total = Number(session?.tokenUsage?.total?.totalTokens || 0);
  const windowSize = Number(session?.contextWindow || 0);
  if (!windowSize || !Number.isFinite(windowSize) || windowSize <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((total / windowSize) * 100)));
}

function formatTokenCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return new Intl.NumberFormat(intlLocale()).format(number);
}

function topbarMeta() {
  if (state.view === "picker" || !state.health?.projectRoot) {
    return {
      kicker: t("topbar.projects"),
      title: t("topbar.openProject"),
      path: t("topbar.chooseFolder"),
    };
  }

  if (state.view === "settings") {
    return {
      kicker: t("nav.settings"),
      title: t("nav.settings"),
      path: state.health?.projectRoot || t("topbar.settingsPath"),
    };
  }

  if (state.view === "tasks") {
    return {
      kicker: currentProject()?.name || t("topbar.taskWorkspace"),
      title: state.taskDetail?.title || t("topbar.tasks"),
      path: state.taskDetail?.taskId ? `${t("label.task")} ${state.taskDetail.taskId}` : (state.health?.projectRoot || t("topbar.taskWorkspace")),
    };
  }

  if (state.view === "code-session") {
    const session = state.codeSessionDetail || findCodeSession(state.selectedCodeSessionId);
    return {
      kicker: currentProject()?.name || t("topbar.codeSession"),
      title: session?.title || t("topbar.codeSession"),
      path: session?.cwd || state.health?.projectRoot || t("topbar.localCode"),
    };
  }

  return {
    kicker: currentProject()?.name || t("topbar.projectSessions"),
    title: t("topbar.sessionWorkbench"),
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
  return date.toLocaleString(intlLocale());
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
  const formatter = new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" });
  const match = ranges.find((range) => absMs < range.limit) || { unit: "year", size: 31_536_000_000 };
  return formatter.format(Math.round(diffMs / match.size), match.unit);
}

function intlLocale() {
  return state.preferences.locale === "zh" ? "zh-CN" : "en-US";
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
