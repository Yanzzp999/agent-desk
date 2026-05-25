import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "^/api/agentdesk": {
        target: "http://127.0.0.1:19731",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
