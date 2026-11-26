import { defineBaseConfig } from "@wallpaperdb/vitest-config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const workspace = process.env.EXPERIMENT_WORKSPACE;
if (!workspace) throw new Error("EXPERIMENT_WORKSPACE required");
export default defineBaseConfig({
	root: resolve(root, ".coverage-experiment/build", workspace),
	test: {
		globals: true,
		environment: "node",
		include: (process.env.EXPERIMENT_FILES || "test/**/*.test.js").split(","),
		maxWorkers: 1,
		fileParallelism: false,
		maxConcurrency:
			workspace === "apps/wallpaper" &&
			process.env.EXPERIMENT_FILES?.includes("integration")
				? 1
				: 5,
		testTimeout:
			workspace === "packages/crap-typescript-core"
				? 5000
				: workspace === "apps/wallpaper"
					? 30000
					: 60000,
		hookTimeout: 60000,
		// Explicit per-workspace qualification strategy, never retry/fallback.
		// This tooling package requires Vite's module reset and dynamic mocks.
		experimental: {
			viteModuleRunner: workspace === "packages/crap-typescript-core",
			nodeLoader: workspace !== "packages/crap-typescript-core",
		},
		coverage: {
			provider: "v8",
			autoAttachSubprocess: true,
			include: ["src/**/*.js"],
			reporter: ["json"],
			reportsDirectory: resolve(
				root,
				".coverage-experiment/reports/compat",
				workspace,
			),
		},
	},
});
