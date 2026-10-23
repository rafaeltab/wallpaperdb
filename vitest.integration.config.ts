import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: {
		name: "repository-integration",
		include: ["test/integration/**/*.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
	},
});
