import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
  test: {
    name: "core:unit",
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**/*.test.ts"],
    testTimeout: 30000,  // 30s for unit tests (no containers)
    hookTimeout: 30000,  // 30s for setup/teardown
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "test/**/*.ts"],
      reportsDirectory: "./coverage",
    },
  },
});
