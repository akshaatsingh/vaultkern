import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // Run integration suites in sequence so they don't corrupt shared test DB
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
    },
  },
});
