import { spawnSync, execFileSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	hash,
	writeReceipt,
} from "../packages/coverage-runtime/dist/receipts.mjs";

test("local verified coverage includes unit and integration and flat producers but excludes stale E2E reports", async () => {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-coverage-"));
	try {
		writeFileSync(join(root, "package.json"), "{}");
		writeFileSync(
			join(root, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\n",
		);
		writeFileSync(join(root, ".gitignore"), "coverage/\n.coverage-runtime/\n");
		const rows = [];
		for (const [name, scripts, reports] of [
			[
				"ordinary",
				{
					"test:unit": "vitest run --coverage",
					"test:integration": "vitest run --coverage",
				},
				["unit", "integration"],
			],
			["flat", { "test:unit": "vitest run --coverage" }, ["unit"]],
			["container", { "test:e2e": "playwright test" }, ["e2e"]],
		] as const) {
			const workspace = join(root, "packages", name);
			mkdirSync(join(workspace, "src"), { recursive: true });
			writeFileSync(
				join(workspace, "package.json"),
				JSON.stringify({ name, scripts }),
			);
			const source = join(workspace, "src", name + ".ts");
			writeFileSync(source, "export const value=1;\n");
			const loc = {
				start: { line: 1, column: 0 },
				end: { line: 1, column: 21 },
			};
			const data = {
				[source]: {
					path: source,
					statementMap: { 0: loc },
					s: { 0: 1 },
					fnMap: {},
					f: {},
					branchMap: {},
					b: {},
				},
			};
			for (const report of reports) {
				// Stale legacy reports must never enter the verified receipt aggregate.
				const directory = join(workspace, "coverage", report);
				mkdirSync(directory, { recursive: true });
				writeFileSync(
					join(directory, "lcov.info"),
					name + "-stale-" + report + "\n",
				);
				if (name !== "container")
					rows.push({
						row: {
							id: `packages-${name}-${report}-1`,
							workspace: `packages/${name}`,
							coverage: true,
						},
						data,
						source,
					});
			}
		}
		for (const args of [
			["init", "-q"],
			["add", "."],
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				"commit",
				"-qm",
				"fixture",
			],
		])
			execFileSync("git", args, { cwd: root });
		for (const { row, data, source } of rows)
			await writeReceipt(
				join(root, "coverage/receipts"),
				root,
				row,
				data,
				data,
				{ [source]: hash(readFileSync(source)) },
				[],
			);
		const result = spawnSync(
			process.execPath,
			[
				"--no-experimental-strip-types",
				new URL("./dist/merge-coverage.mjs", import.meta.url).pathname,
				"--local",
			],
			{ cwd: root, encoding: "utf8" },
		);
		expect(result.status, result.stderr).toBe(0);
		const coverage = readFileSync(join(root, "coverage/lcov.info"), "utf8");
		expect(coverage).toMatch(/ordinary\.ts/);
		expect(coverage).toMatch(/flat\.ts/);
		expect(coverage).toMatch(/DA:1,2/);
		expect(coverage).toMatch(/DA:1,1/);
		expect(coverage).not.toMatch(/container|stale/);
		const receipt = join(root, "coverage/receipts", rows[0].row.id + ".json");
		rmSync(receipt);
		const missing = spawnSync(
			process.execPath,
			[
				"--no-experimental-strip-types",
				new URL("./dist/merge-coverage.mjs", import.meta.url).pathname,
				"--local",
			],
			{ cwd: root, encoding: "utf8" },
		);
		expect(missing.status).not.toBe(0);
		expect(missing.stderr).toMatch(/Incomplete/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
