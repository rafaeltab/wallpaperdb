import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
test("normal coverage inventory selects the executable Scripts unit suite", async () => {
	const directory = await mkdtemp(resolve(tmpdir(), "coverage-inventory-"));
	try {
		execFileSync(
			process.execPath,
			[resolve(root, "scripts/coverage-runtime/inventory.mjs")],
			{
				cwd: root,
				env: {
					...process.env,
					WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: directory,
				},
			},
		);
		const { tiers } = JSON.parse(
			await readFile(directory + "/matrix.json", "utf8"),
		);
		const scripts = tiers.filter((row) => row.workspace === "scripts");
		assert.equal(scripts.length, 1);
		assert.equal(scripts[0].script, "test:unit");
		assert.equal(scripts[0].runtime, ".");
		assert.equal(scripts[0].config, "vitest.config.ts");
		assert.equal(scripts[0].strategy, "source-vite");
		// The supported command must invoke Vitest, rather than only change directories.
		const manifest = JSON.parse(
			await readFile(resolve(root, "scripts/package.json"), "utf8"),
		);
		assert.equal(
			manifest.scripts["test:unit"],
			"cd .. && scripts/node_modules/.bin/vitest run",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
