import { defaults } from "@wallpaperdb/vitest-config/defaults";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
	defaults,
	defineConfig({
		test: {
			include: ["test/**/*.test.ts"],
			fileParallelism: false,
			maxWorkers: 1,
			testTimeout: 120_000,
			coverage: {
				provider: "v8",
				include: ["src/**/*.ts"],
				reportsDirectory: "coverage/unit",
			},
		},
	}),
);
