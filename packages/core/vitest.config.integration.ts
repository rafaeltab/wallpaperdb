import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
  test: {
    name: "core:integration",
    globals: true,
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 120000,  // 120s for Testcontainers startup
    hookTimeout: 120000,  // 120s for setup/teardown with containers
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "test/**/*.ts"],
      reportsDirectory: "./coverage",
    },
  },
});
