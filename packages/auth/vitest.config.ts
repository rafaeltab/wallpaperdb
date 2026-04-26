import { defineBaseConfig } from "@wallpaperdb/vitest-config";

export default defineBaseConfig({
	test: {
		name: "auth",
		globals: true,
		environment: "node",
		include: ["test/**/*.test.ts"],
		testTimeout: 10000,
		hookTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "test/**/*.ts"],
			reportsDirectory: "./coverage",
		},
	},
});
