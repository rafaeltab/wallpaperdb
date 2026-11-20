import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import configure from "../src/vitest.config.mjs";

test.each(["source-vite", "compiled-native"])(
	"runner configuration preserves policy while selecting %s paths",
	async (strategy) => {
		const output = await mkdtemp(join(tmpdir(), "runner-config-"));
		const configFile = join(output, "vitest.config.mjs");
		const policy = {
			resolve: { alias: { service: "/example/service" } },
			plugins: [{ name: "retained-plugin" }],
			test: {
				include: ["test/**/*.unit.test.ts"],
				exclude: ["test/skipped.test.ts"],
				setupFiles: ["test/setup.ts"],
				globalSetup: "test/global.mts",
				testTimeout: 3210,
				maxWorkers: 2,
				isolate: false,
				expect: { requireAssertions: true },
				projects: [{ test: { include: ["test/**/*.integration.test.ts"] } }],
				coverage: {
					include: ["src/**/*.mts", "src/**/*.ts"],
					exclude: ["src/**/*.test.ts"],
					thresholds: { lines: 70 },
				},
			},
		};
		try {
			await writeFile(configFile, `export default ${JSON.stringify(policy)};`);
			vi.stubEnv("WALLPAPERDB_COVERAGE_REPO_CONFIG", configFile);
			vi.stubEnv("WALLPAPERDB_COVERAGE_REPO_OUTPUT", output);
			vi.stubEnv("WALLPAPERDB_COVERAGE_REPO_STRATEGY", strategy);
			vi.stubEnv("WALLPAPERDB_COVERAGE_WORKSPACE", "packages/coverage-runtime");
			const result = await configure();
			expect(result.resolve).toStrictEqual(policy.resolve);
			expect(result.plugins).toStrictEqual(policy.plugins);
			expect(result.test).toMatchObject({
				testTimeout: 3210,
				maxWorkers: 2,
				isolate: false,
				expect: { requireAssertions: true },
				coverage: {
					thresholds: { lines: 70 },
					reportsDirectory: join(output, "coverage"),
				},
			});
			if (strategy === "compiled-native") {
				expect(result.test).toMatchObject({
					include: ["test/**/*.unit.test.js"],
					exclude: ["test/skipped.test.js"],
					setupFiles: ["test/setup.js"],
					globalSetup: "test/global.mjs",
					experimental: { nodeLoader: true, viteModuleRunner: false },
					projects: [
						{
							test: {
								include: ["test/**/*.integration.test.js"],
								experimental: { nodeLoader: true, viteModuleRunner: false },
							},
						},
					],
					coverage: {
						autoAttachSubprocess: true,
						excludeAfterRemap: true,
						allowExternal: true,
					},
				});
			} else {
				expect(result.test).toMatchObject({
					include: policy.test.include,
					exclude: policy.test.exclude,
					setupFiles: policy.test.setupFiles,
					globalSetup: policy.test.globalSetup,
					projects: policy.test.projects,
				});
			}
			const selection = JSON.parse(
				await readFile(join(output, "selection.json"), "utf8"),
			);
			expect(selection.originalCoverage).toMatchObject({
				include: policy.test.coverage.include,
				exclude: policy.test.coverage.exclude,
			});
		} finally {
			vi.unstubAllEnvs();
			await rm(output, { recursive: true, force: true });
		}
	},
);
