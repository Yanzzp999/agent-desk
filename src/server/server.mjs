import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRun,
  createContext,
  createPlanJob,
  getCurrentRun,
  getHealth,
  getPlanJob,
  getPlanLogs,
  getRunDetail,
  getTaskDetail,
  getTaskLogs,
  getTaskResult,
  listArtifacts,
  listPlanJobs,
  listRuns,
  readArtifact,
  retryTask,
  snapshotStateStamp,
  stopTask,
} from "../lib/control-plane.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(MODULE_DIR, "../web");
const DEFAULT_PROJECTS_STATE_FILE = path.join(os.homedir(), ".agent-desk", "projects.json");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function createControlPlaneServer(initialContext = null, options = {}) {
  const clients = new Set();
  const projects = createProjectRegistry(initialContext, options);
  let lastStamp = "";

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(projects, req, res, clients);
    } catch (error) {
      sendJson(res, statusFromError(error), {
        error: error.message || "request failed",
      });
    }
  });

  const interval = setInterval(async () => {
    if (clients.size === 0) {
      return;
    }
    const context = projects.currentContext();
    if (!context) {
      return;
    }
    const stamp = await snapshotStateStamp(context).catch(() => "");
    if (!stamp || stamp === lastStamp) {
      return;
    }
    lastStamp = stamp;
    const payload = JSON.stringify({
      type: "state.updated",
      updatedAt: new Date().toISOString(),
    });
    for (const client of clients) {
      client.write(`event: state.updated\ndata: ${payload}\n\n`);
    }
  }, 1500);
  interval.unref();

  server.on("close", () => {
    clearInterval(interval);
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  });

  return server;
}

async function routeRequest(projects, req, res, clients) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) {
    return serveStatic(req, res, url.pathname);
  }

  setCommonHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    return openEventStream(res, clients);
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    return sendJson(res, 200, await projects.list());
  }

  if (req.method === "POST" && url.pathname === "/api/projects/select") {
    const result = await projects.select((await readJsonBody(req)).projectRoot);
    notifyClients(clients, "project.changed", {
      type: "project.changed",
      projectRoot: result.current?.projectRoot || "",
      updatedAt: new Date().toISOString(),
    });
    return sendJson(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const context = projects.currentContext();
    if (!context) {
      return sendJson(res, 200, {
        ok: true,
        needsProject: true,
        projectRoot: "",
        stateRoot: "",
        uiStateRoot: "",
        ralphRunCli: "",
        ralphPlanCli: "",
      });
    }
    return sendJson(res, 200, { ...await getHealth(context), needsProject: false });
  }

  const context = requireProjectContext(projects);

  if (req.method === "GET" && url.pathname === "/api/runs") {
    return sendJson(res, 200, await listRuns(context, { status: url.searchParams.get("status") || "" }));
  }

  if (req.method === "GET" && url.pathname === "/api/runs/current") {
    return sendJson(res, 200, await getCurrentRun(context));
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (runMatch && req.method === "GET") {
    return sendJson(res, 200, await getRunDetail(context, decodeURIComponent(runMatch[1])));
  }

  const collectMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/collect$/);
  if (collectMatch && req.method === "POST") {
    return sendJson(res, 200, await collectRun(context, decodeURIComponent(collectMatch[1])));
  }

  const taskMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)$/);
  if (taskMatch && req.method === "GET") {
    return sendJson(res, 200, await getTaskDetail(context, decodeURIComponent(taskMatch[1]), decodeURIComponent(taskMatch[2])));
  }

  const taskLogsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/logs$/);
  if (taskLogsMatch && req.method === "GET") {
    return sendJson(res, 200, await getTaskLogs(context, decodeURIComponent(taskLogsMatch[1]), decodeURIComponent(taskLogsMatch[2]), {
      lines: url.searchParams.get("lines"),
    }));
  }

  const taskResultMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/result$/);
  if (taskResultMatch && req.method === "GET") {
    return sendJson(res, 200, await getTaskResult(context, decodeURIComponent(taskResultMatch[1]), decodeURIComponent(taskResultMatch[2])));
  }

  const taskRetryMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/retry$/);
  if (taskRetryMatch && req.method === "POST") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await retryTask(context, decodeURIComponent(taskRetryMatch[1]), decodeURIComponent(taskRetryMatch[2]), {
      force: Boolean(body.force),
    }));
  }

  const taskStopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tasks\/([^/]+)\/stop$/);
  if (taskStopMatch && req.method === "POST") {
    return sendJson(res, 200, await stopTask(context, decodeURIComponent(taskStopMatch[1]), decodeURIComponent(taskStopMatch[2])));
  }

  if (url.pathname === "/api/plans" && req.method === "GET") {
    return sendJson(res, 200, await listPlanJobs(context));
  }

  if (url.pathname === "/api/plans" && req.method === "POST") {
    return sendJson(res, 202, await createPlanJob(context, await readJsonBody(req)));
  }

  const planLogsMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/logs$/);
  if (planLogsMatch && req.method === "GET") {
    return sendJson(res, 200, await getPlanLogs(context, decodeURIComponent(planLogsMatch[1])));
  }

  const planMatch = url.pathname.match(/^\/api\/plans\/([^/]+)$/);
  if (planMatch && req.method === "GET") {
    return sendJson(res, 200, await getPlanJob(context, decodeURIComponent(planMatch[1]), {
      includeLogs: url.searchParams.get("logs") === "1",
    }));
  }

  if (url.pathname === "/api/artifacts" && req.method === "GET") {
    return sendJson(res, 200, await listArtifacts(context));
  }

  if (url.pathname === "/api/artifacts/preview" && req.method === "GET") {
    return sendJson(res, 200, await readArtifact(context, url.searchParams.get("path")));
  }

  sendJson(res, 404, { error: "not found" });
}

function openEventStream(res, clients) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ type: "connected", updatedAt: new Date().toISOString() })}\n\n`);
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
  });
}

function notifyClients(clients, event, payload) {
  const body = JSON.stringify(payload);
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${body}\n\n`);
  }
}

function requireProjectContext(projects) {
  const context = projects.currentContext();
  if (!context) {
    throw new Error("select a project before using this endpoint");
  }
  return context;
}

function createProjectRegistry(initialContext, options = {}) {
  const stateFile = options.stateFile || DEFAULT_PROJECTS_STATE_FILE;
  const contextOptions = {
    stateRoot: options.stateRoot,
    uiStateRoot: options.uiStateRoot,
  };
  let context = initialContext || null;
  let recent = [];

  async function loadRecent() {
    if (recent.length > 0) {
      return recent;
    }
    const saved = await readJsonFile(stateFile);
    recent = Array.isArray(saved?.projects) ? saved.projects.filter((item) => item?.projectRoot).slice(0, 12) : [];
    if (context) {
      rememberContext(context);
    }
    return recent;
  }

  async function saveRecent() {
    await fs.promises.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.promises.writeFile(stateFile, `${JSON.stringify({ projects: recent }, null, 2)}\n`, "utf8");
  }

  function rememberContext(nextContext) {
    const item = summarizeProject(nextContext);
    recent = [
      item,
      ...recent.filter((candidate) => path.resolve(candidate.projectRoot) !== item.projectRoot),
    ].slice(0, 12);
  }

  return {
    currentContext() {
      return context;
    },
    async list() {
      await loadRecent();
      return {
        current: context ? summarizeProject(context) : null,
        items: await Promise.all(recent.map(refreshProjectSummary)),
      };
    },
    async select(projectRoot) {
      const requested = String(projectRoot || "").trim();
      if (!requested) {
        throw new Error("projectRoot is required");
      }
      const resolved = path.resolve(requested);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new Error(`project root is not a directory: ${resolved}`);
      }
      await loadRecent();
      context = createContext({
        ...contextOptions,
        projectRoot: resolved,
      });
      rememberContext(context);
      await saveRecent();
      return this.list();
    },
  };
}

async function refreshProjectSummary(item) {
  return {
    ...item,
    hasState: await isDirectory(item.stateRoot || path.join(item.projectRoot, ".ralph")),
    hasUiState: await isDirectory(item.uiStateRoot || path.join(item.projectRoot, ".ralph-ui")),
  };
}

function summarizeProject(context) {
  return {
    projectRoot: path.resolve(context.projectRoot),
    name: path.basename(context.projectRoot) || context.projectRoot,
    stateRoot: context.stateRoot,
    uiStateRoot: context.uiStateRoot,
    ralphRunCli: context.ralphRunCli,
    ralphPlanCli: context.ralphPlanCli,
    hasState: fs.existsSync(context.stateRoot),
    hasUiState: fs.existsSync(context.uiStateRoot),
    selectedAt: new Date().toISOString(),
  };
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function isDirectory(dirPath) {
  const stat = await fs.promises.stat(dirPath).catch(() => null);
  return Boolean(stat?.isDirectory());
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(WEB_ROOT, `.${decodeURIComponent(cleanPath)}`);
  if (!(resolved === WEB_ROOT || resolved.startsWith(`${WEB_ROOT}${path.sep}`))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? resolved
    : path.join(WEB_ROOT, "index.html");
  const extension = path.extname(target);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(target).pipe(res);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

function sendJson(res, statusCode, payload) {
  setCommonHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function statusFromError(error) {
  if (/select a project|projectRoot is required|project root is not a directory/i.test(error.message || "")) {
    return 400;
  }
  if (/not found/i.test(error.message || "")) {
    return 404;
  }
  if (/outside|forbidden/i.test(error.message || "")) {
    return 403;
  }
  return 500;
}
