import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // These tests share one real database, so file-level parallelism causes
    // schema creation and table resets to race each other.
    fileParallelism: false,
  },
});
