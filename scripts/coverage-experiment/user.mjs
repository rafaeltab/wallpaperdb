import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdtempSync, readlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const userRequire = createRequire(
	new URL("../../apps/user/package.json", import.meta.url),
);
const cli = resolve(
	dirname(userRequire.resolve("vitest/package.json")),
	"vitest.mjs",
);
const mode = process.argv[2] || "unit";
if (!["unit", "integration", "mock", "app-mock"].includes(mode))
	throw new Error("Expected unit, integration, mock, or app-mock");
const env = {
	EXPERIMENT_NATIVE_SOURCES: mkdtempSync(
		resolve(root, ".coverage-experiment/native-sources-"),
	),
	...process.env,
	NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${JSON.stringify(fileURLToPath(new URL("./native-hook.mjs", import.meta.url)))}`,
	EXPERIMENT_INTEGRATION: mode === "integration" ? "1" : "",
	EXPERIMENT_MOCK: mode === "app-mock" ? "app" : mode === "mock" ? "1" : "",
	EXPERIMENT_NODE_LOADER: process.env.EXPERIMENT_NODE_LOADER || "true",
};
const stdio = ["inherit", "inherit", "inherit"];
const lease = Number(env.WALLPAPERDB_DOCKER_LEASE_FD);
try {
	if (
		Number.isSafeInteger(lease) &&
		lease >= 3 &&
		readlinkSync(`/proc/self/fd/${lease}`) === env.WALLPAPERDB_DOCKER_LEASE_FILE
	) {
		while (stdio.length <= lease) stdio.push("ignore");
		stdio[lease] = lease;
	}
} catch {}
const result = spawnSync(
	process.execPath,
	[
		cli,
		"run",
		"--config",
		resolve(root, "scripts/coverage-experiment/vitest.config.mjs"),
		...(process.env.EXPERIMENT_SERIAL === "1"
			? ["--maxWorkers=1", "--no-file-parallelism"]
			: ["--maxWorkers=5"]),
		...(mode === "mock" ? [] : ["--coverage"]),
		...process.argv.slice(3),
	],
	{ cwd: resolve(root, ".coverage-experiment/build/apps/user"), env, stdio },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
