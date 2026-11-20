import { defineBaseConfig } from "@wallpaperdb/vitest-config";
export default defineBaseConfig({
	test: {
		include: ["test/**/*.test.mts"],
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 120_000,
		coverage: {
			include: ["src/**/*.mts", "src/**/*.ts"],
			reportsDirectory: "coverage/unit",
		},
	},
});
