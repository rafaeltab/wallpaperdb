import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: {
		include: ["scripts/check-migration-replay.integration.mjs"],
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 120_000,
	},
});
