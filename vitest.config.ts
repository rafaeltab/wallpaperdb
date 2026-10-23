import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: { include: ["scripts/**/*.test.ts"] },
});
