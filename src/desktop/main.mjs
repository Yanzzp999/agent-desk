import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import process from "node:process";
import { createContext } from "../lib/control-plane.mjs";
import { createControlPlaneServer } from "../server/server.mjs";

let mainWindow = null;
let controlPlaneServer = null;
let controlPlaneUrl = "";

app.setName("AgentDesk");

main().catch((error) => {
  console.error(`AgentDesk: ${error.message}`);
  app.exit(1);
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  await app.whenReady();

  Menu.setApplicationMenu(createApplicationMenu());

  const serverInfo = await startControlPlane(parsed);
  controlPlaneServer = serverInfo.server;
  controlPlaneUrl = serverInfo.url;

  await createMainWindow(parsed);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow(parsed);
    }
  });
}

async function startControlPlane(parsed) {
  const host = parsed.host || "127.0.0.1";
  const preferredPort = Number(parsed.port || 4317);
  const initialContext = parsed.project ? createContext({
    projectRoot: parsed.project,
    stateRoot: parsed["state-dir"],
    uiStateRoot: parsed["ui-state-dir"],
  }) : null;
  const serverOptions = {
    stateRoot: parsed["state-dir"],
    uiStateRoot: parsed["ui-state-dir"],
  };

  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    const server = createControlPlaneServer(initialContext, serverOptions);
    try {
      await listen(server, host, port);
      const url = `http://${host}:${port}`;
      console.log(`AgentDesk desktop app: ${url}`);
      console.log(initialContext ? `Project: ${initialContext.projectRoot}` : "Project: choose in the app");
      return { server, url };
    } catch (error) {
      await closeServer(server);
      if (error.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error(`could not find an available port starting at ${preferredPort}`);
}

async function createMainWindow(parsed) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "AgentDesk",
    backgroundColor: "#f3f5f1",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle("AgentDesk");
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(controlPlaneUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(controlPlaneUrl);

  if (parsed.devtools) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const keyValue = arg.slice(2);
    const equals = keyValue.indexOf("=");
    if (equals !== -1) {
      result[keyValue.slice(0, equals)] = keyValue.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[keyValue] = next;
      index += 1;
    } else {
      result[keyValue] = true;
    }
  }
  return result;
}

function createApplicationMenu() {
  return Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{
      label: "AgentDesk",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" },
      ],
    },
  ]);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  if (controlPlaneServer) {
    const server = controlPlaneServer;
    controlPlaneServer = null;
    await closeServer(server);
  }
});
