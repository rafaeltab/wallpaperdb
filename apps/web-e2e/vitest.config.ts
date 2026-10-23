import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
  test: { include: ["test/**/*.test.ts"] },
});
