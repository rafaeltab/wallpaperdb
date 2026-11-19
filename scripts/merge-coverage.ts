import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mergeReceipts } from "./coverage-runtime/receipts.mjs";

// Like the original merger, operate on the caller's checkout, including fixtures.
const root = process.cwd();
const output = resolve(root, ".coverage-runtime/evidence");
execFileSync(
	process.execPath,
	[fileURLToPath(new URL("./coverage-runtime/inventory.mjs", import.meta.url))],
	{
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: output },
	},
);
const { tiers } = JSON.parse(
	await readFile(resolve(output, "matrix.json"), "utf8"),
);
await mergeReceipts(root, tiers);
