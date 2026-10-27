import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeStdio } from "./lib/prebuilt-node.mjs";

const [workspace, ...args] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
	"package.json",
	"scripts/package.json",
	"infra/package.json",
	...["apps", "packages"].flatMap((directory) =>
		readdirSync(join(root, directory)).map(
			(name) => `${directory}/${name}/package.json`,
		),
	),
];
const manifest = candidates
	.map((file) => join(root, file))
	.find(
		(file) =>
			JSON.parse(readFileSync(file, "utf8")).name ===
			`@wallpaperdb/${workspace}`,
	);
if (!manifest) throw new Error(`Unknown workspace: ${workspace}`);
const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts;
const command = scripts["test:focused"]
	? ["run", "test:focused", ...args]
	: [
			"exec",
			"vitest",
			"run",
			"--maxWorkers=1",
			"--no-file-parallelism",
			...args,
		];
const result = spawnSync("pnpm", command, {
	cwd: dirname(manifest),
	stdio: nativeStdio(),
	env: process.env,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
