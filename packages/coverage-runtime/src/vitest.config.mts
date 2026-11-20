import { repositoryRoot, repositoryConfiguration } from "./repository-root.mjs";
import type { ViteUserConfig } from "vitest/config";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = repositoryRoot();
const require = createRequire(resolve(root, "package.json"));
const { loadConfigFromFile }: typeof import("vite") = await import(
	pathToFileURL(createRequire(require.resolve("vitest")).resolve("vite")).href
);
export default async function (): Promise<ViteUserConfig> {
	const configFile = process.env.WALLPAPERDB_COVERAGE_REPO_CONFIG;
	const loaded = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		configFile,
	);
	if (!loaded) throw new Error(`Could not load configured tier: ${configFile}`);
	const base: ViteUserConfig = loaded.config;
	const native =
		process.env.WALLPAPERDB_COVERAGE_REPO_STRATEGY === "compiled-native";
	const rewrite = (value: string): string =>
		value
			.replace(/\.mts\b/g, ".mjs")
			.replace(/\.tsx?\b/g, ".js")
			.replace("{ts,tsx}", "{js,mjs}");
	const rewritePaths = (value: string | string[]): string | string[] =>
		Array.isArray(value) ? value.map(rewrite) : rewrite(value);

	// Only test selection/setup paths and coverage paths change representation.
	// Keep plugins, aliases, environments, projects, assertions and lifecycle budgets.
	const test = { ...base.test };
	if (native) {
		for (const k of ["include", "exclude"] as const)
			if (test[k]) test[k] = test[k].map(rewrite);
		for (const k of ["setupFiles", "globalSetup"] as const)
			if (test[k]) test[k] = rewritePaths(test[k]);
		if (test.projects)
			test.projects = test.projects.map((p) =>
				typeof p === "string"
					? rewrite(p)
					: typeof p === "function" || p instanceof Promise
						? p
						: {
								...p,
								test: {
									...p.test,
									experimental: {
										...p.test?.experimental,
										viteModuleRunner: false,
										nodeLoader: true,
									},
									...Object.fromEntries(
										(
											[
												"include",
												"exclude",
												"setupFiles",
												"globalSetup",
											] as const
										)
											.filter((k) => p.test?.[k])
											.map((k) => [k, rewritePaths(p.test?.[k] || [])]),
									),
								},
							},
			);
		test.experimental = {
			...test.experimental,
			viteModuleRunner: false,
			nodeLoader: true,
		};
	}
	test.coverage = {
		...test.coverage,
		...(native ? { autoAttachSubprocess: true } : {}),
		reporter: test.coverage?.reporter || ["json", "json-summary", "lcov"],
		reportsDirectory: resolve(
			process.env.WALLPAPERDB_COVERAGE_REPO_OUTPUT || "",
			"coverage",
		),
	};
	const originalCoverage = {
		reportsDirectory: base.test?.coverage?.reportsDirectory,
		include: base.test?.coverage?.include,
		exclude: base.test?.coverage?.exclude,
	};
	if (native)
		for (const k of ["include", "exclude"] as const)
			if (test.coverage[k])
				test.coverage[k] = test.coverage[k]
					.map(rewrite)
					.map((p) => p.replaceAll(".js", ".{js,mjs,cjs}"));
	const { builtArtifactWorkspaces } = await repositoryConfiguration();
	if (
		native &&
		builtArtifactWorkspaces.includes(
			process.env.WALLPAPERDB_COVERAGE_WORKSPACE || "",
		)
	)
		test.coverage.include = [...(test.coverage.include || []), "dist/**/*.mjs"];
	await writeFile(
		resolve(
			process.env.WALLPAPERDB_COVERAGE_REPO_OUTPUT || "",
			"selection.json",
		),
		JSON.stringify(
			{
				root: process.cwd(),
				strategy: process.env.WALLPAPERDB_COVERAGE_REPO_STRATEGY,
				configFile,
				originalCoverage,
				test,
			},
			(_, v) => (typeof v === "function" ? "[function preserved]" : v),
			2,
		),
	);
	return {
		...base,
		root: process.cwd(),
		test: {
			...test,
			reporters: ["default", "json"],
			outputFile: {
				json: resolve(
					process.env.WALLPAPERDB_COVERAGE_REPO_OUTPUT || "",
					"tests.json",
				),
			},
		},
	};
}
