import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "src/web",
  test: {
    environment: "node",
    include: ["api/**/*.test.ts"],
  },
});
