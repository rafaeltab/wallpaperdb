import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
  test: {
    name: "crap-typescript-core",
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reportsDirectory: "./coverage/unit",
    },
  },
});
