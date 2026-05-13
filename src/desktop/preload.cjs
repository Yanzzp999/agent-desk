const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentDeskDesktop", {
  chooseProjectFolder(options = {}) {
    return ipcRenderer.invoke("agent-desk:choose-project-folder", {
      defaultPath: typeof options.defaultPath === "string" ? options.defaultPath : "",
    });
  },
});
