import { inventorySchema } from "../src/json.mjs";
import { repositoryRoot } from "../src/repository-root.mjs";
import { expect } from "vitest";

import { test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const root = repositoryRoot();
test("normal coverage inventory selects the executable Scripts unit suite", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "coverage-inventory-"));
	try {
		execFileSync(
			process.execPath,
			[resolve(root, "packages/coverage-runtime/dist/inventory.mjs")],
			{
				cwd: directory,
				env: {
					...process.env,
					WALLPAPERDB_COVERAGE_REPO_ROOT: root,
					WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: directory,
				},
			},
		);
		const { tiers } = inventorySchema.parse(
			JSON.parse(await readFile(`${directory}/matrix.json`, "utf8")),
		);
		const scripts = tiers.filter((row) => row.workspace === "scripts");
		expect(scripts.length).toBe(1);
		expect(scripts[0].script).toBe("test:unit");
		expect(scripts[0].runtime).toBe(".");
		expect(scripts[0].config).toBe("vitest.config.ts");
		expect(scripts[0].strategy).toBe("source-vite");
		// The supported command must invoke Vitest, rather than only change directories.
		const manifest = JSON.parse(
			await readFile(resolve(root, "scripts/package.json"), "utf8"),
		);
		expect(manifest.scripts["test:unit"]).toBe(
			"cd .. && scripts/node_modules/.bin/vitest run",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
