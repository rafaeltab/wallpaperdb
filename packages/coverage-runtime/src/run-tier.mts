import { inventorySchema } from "./json.mjs";
import { repositoryRoot } from "./repository-root.mjs";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beginAttempt } from "./artifacts.mjs";

const root = repositoryRoot();
const evidenceRoot =
	process.env.WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT ||
	resolve(repositoryRoot(), ".coverage-runtime/evidence");
const { tiers } = inventorySchema.parse(
	JSON.parse(await readFile(`${evidenceRoot}/matrix.json`, "utf8")),
);
const id = process.argv[2],
	mode = "candidate",
	row = tiers.find((r) => r.id === id);
if (!row) throw new Error("Select a configured Vitest tier");
const strategy = row.strategy;
const focus = undefined;
const baseOutput = resolve(
	evidenceRoot,
	"runs",
	id,
	mode + (focus ? "-focus" : ""),
);
const output = beginAttempt(baseOutput, root, {
	id,
	mode,
	strategy,
	config: resolve(
		strategy === "compiled-native"
			? resolve(root, ".coverage-runtime/build", row.runtime)
			: resolve(root, row.runtime),
		strategy === "compiled-native"
			? row.config.replace(/\.tsx?$/, ".js")
			: row.config,
	),
	sourceConfig: resolve(root, row.runtime, row.config),
});
const source = resolve(root, row.runtime),
	cwd =
		strategy === "compiled-native"
			? resolve(root, ".coverage-runtime/build", row.runtime)
			: source;
Object.assign(process.env, {
	WALLPAPERDB_COVERAGE_REPO_ROOT: root,
	WALLPAPERDB_COVERAGE_REPO_CONFIG: resolve(
		cwd,
		strategy === "compiled-native"
			? row.config.replace(/\.tsx?$/, ".js")
			: row.config,
	),
	WALLPAPERDB_COVERAGE_REPO_OUTPUT: output,
	WALLPAPERDB_COVERAGE_REPO_STRATEGY: strategy,
});
if (mode === "candidate") {
	const hook =
		strategy === "compiled-native" ? "native-hook.mjs" : "vite-hook.mjs";
	process.env.WALLPAPERDB_COVERAGE_NATIVE_SOURCES = mkdtempSync(
		resolve(root, ".coverage-runtime/native-sources-"),
	);
	process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --import=${JSON.stringify(fileURLToPath(new URL(hook, import.meta.url)))}`;
	await import(new URL(hook, import.meta.url).href);
}
const require = createRequire(resolve(source, "package.json"));
const cli = resolve(
	dirname(require.resolve("vitest/package.json")),
	"vitest.mjs",
);
// Make's command-line selectors belong to this launcher, not the nested
// Make contracts exercised by the tests. Preserve normal flags and lease env.
process.env.MAKEFLAGS = (process.env.MAKEFLAGS || "").split(" -- ")[0];
delete process.env.MAKEOVERRIDES;
for (const key of ["ARGS", "PACKAGE", "SCRIPT", "CI_WORKSPACE_FILTER"])
	delete process.env[key];
process.chdir(cwd);
process.argv = [
	process.execPath,
	cli,
	"run",
	"--config",
	fileURLToPath(new URL("./vitest.config.mjs", import.meta.url)),
	...(focus ? [focus] : []),
	...row.args.map((arg) =>
		arg.startsWith("--coverage.reportsDirectory=")
			? `--coverage.reportsDirectory=${resolve(output, "coverage")}`
			: arg,
	),
];
await import(pathToFileURL(cli).href);
