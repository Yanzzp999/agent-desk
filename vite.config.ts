import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

declare const process: {
  env: Record<string, string | undefined>;
};

const apiHost = process.env.AGENT_DESK_TASK_API_HOST || "127.0.0.1";
const apiPort = process.env.AGENT_DESK_TASK_API_PORT || "19731";
const apiBasePath = process.env.AGENT_DESK_TASK_API_BASE_PATH || "/api/agentdesk";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      [`^${escapeRegex(apiBasePath)}`]: {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
