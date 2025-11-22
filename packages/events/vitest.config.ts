import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "events",
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "test/**/*.ts"],
      reportsDirectory: "./coverage",
    },
  },
});
