// Experimental CLI entry for explicit per-workspace strategies. Preserve the
// Docker lease in this process and use the workspace's Vitest installation.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { mkdtempSync } from "node:fs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const workspace = process.env.EXPERIMENT_WORKSPACE;
if (
	![
		"apps/asset",
		"apps/wallpaper",
		"packages/core",
		"packages/crap-typescript-core",
	].includes(workspace)
)
	throw new Error("Unqualified experimental workspace");
const require = createRequire(resolve(root, workspace, "package.json"));
const cli = resolve(
	dirname(require.resolve("vitest/package.json")),
	"vitest.mjs",
);
process.env.EXPERIMENT_NATIVE_SOURCES = mkdtempSync(
	resolve(root, ".coverage-experiment/native-sources-"),
);
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --import=${JSON.stringify(fileURLToPath(new URL("./native-hook.mjs", import.meta.url)))}`;
await import("./native-hook.mjs");
process.chdir(resolve(root, ".coverage-experiment/build", workspace));
process.argv = [
	process.execPath,
	cli,
	"run",
	"--config",
	resolve(root, "scripts/coverage-experiment/compat.config.mjs"),
	...process.argv.slice(2),
];
await import(pathToFileURL(cli).href);
