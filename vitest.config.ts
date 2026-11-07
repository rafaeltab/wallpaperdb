import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: {
		include: ["scripts/**/*.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 120_000,
		hookTimeout: 30_000,
	},
});
