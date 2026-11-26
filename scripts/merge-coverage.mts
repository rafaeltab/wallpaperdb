import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
	repositoryConfiguration,
	mergeReceipts,
	inventorySchema,
} from "@wallpaperdb/coverage-runtime";

// Like the original merger, operate on the caller's checkout, including fixtures.
const root = process.cwd();
const { estimates } = await repositoryConfiguration();
const output = resolve(root, ".coverage-runtime/evidence");
execFileSync(
	process.execPath,
	[
		fileURLToPath(
			new URL(
				"../../packages/coverage-runtime/dist/inventory.mjs",
				import.meta.url,
			),
		),
	],
	{
		cwd: root,
		stdio: "inherit",
		env: {
			...process.env,
			WALLPAPERDB_COVERAGE_REPO_ROOT: root,
			WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: output,
		},
	},
);
const { tiers } = inventorySchema.parse(
	JSON.parse(await readFile(resolve(output, "matrix.json"), "utf8")),
);
await mergeReceipts(root, tiers, undefined, undefined, estimates);
