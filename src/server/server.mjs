import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRun,
  createPlanJob,
  getCurrentRun,
  getHealth,
  getPlanJob,
  getPlanLogs,
  getRunDetail,
  getRuntimeCapabilities,
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
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export function createControlPlaneServer(context) {
  const clients = new Set();
  let lastStamp = "";

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(context, req, res, clients);
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

async function routeRequest(context, req, res, clients) {
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

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, await getHealth(context));
  }

  if (req.method === "GET" && (url.pathname === "/api/runtime" || url.pathname === "/api/capabilities")) {
    return sendJson(res, 200, await getRuntimeCapabilities(context));
  }

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
  if (/not found/i.test(error.message || "")) {
    return 404;
  }
  if (/outside|forbidden/i.test(error.message || "")) {
    return 403;
  }
  return 500;
}
