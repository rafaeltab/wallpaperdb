import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { repositoryRoot } from "../src/repository-root.mjs";

test.each([
	{ args: ["--unknown"], error: /Unknown coverage argument/ },
	{ args: ["--package", "../escape"], error: /Select workspace short names/ },
])(
	"coverage CLI rejects $args before starting collection",
	({ args, error }) => {
		const run = spawnSync(
			process.execPath,
			[
				join(repositoryRoot(), "packages/coverage-runtime/dist/command.mjs"),
				...args,
			],
			{
				encoding: "utf8",
				env: { ...process.env },
				timeout: 30000,
			},
		);
		expect(run.status).not.toBe(0);
		expect(run.stderr).toMatch(error);
	},
);

test("tier CLI rejects an unconfigured tier before creating an attempt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tier-selection-"));
	try {
		await writeFile(
			join(directory, "matrix.json"),
			JSON.stringify({ workspaces: [], tiers: [] }),
		);
		const run = spawnSync(
			process.execPath,
			[
				join(repositoryRoot(), "packages/coverage-runtime/dist/run-tier.mjs"),
				"missing-tier",
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					WALLPAPERDB_COVERAGE_REPO_OUTPUT_ROOT: directory,
				},
				timeout: 30000,
			},
		);
		expect(run.status).not.toBe(0);
		expect(run.stderr).toMatch(/Select a configured Vitest tier/);
		expect(existsSync(join(directory, "runs"))).toBe(false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
