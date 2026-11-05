import { spawnSync } from "node:child_process";
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

test("local coverage includes unit and integration workspaces but excludes stale E2E reports", () => {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-coverage-"));
	try {
		for (const [name, scripts, reports] of [
			[
				"ordinary",
				{ "test:unit": "unit", "test:integration": "integration" },
				["unit", "integration"],
			],
			["flat", { "test:unit": "unit" }, [""]],
			["container", { "test:e2e": "e2e" }, [""]],
		]) {
			const workspace = join(root, "packages", name);
			mkdirSync(workspace, { recursive: true });
			writeFileSync(
				join(workspace, "package.json"),
				JSON.stringify({ scripts }),
			);
			for (const report of reports) {
				const directory = join(workspace, "coverage", report);
				mkdirSync(directory, { recursive: true });
				writeFileSync(join(directory, "lcov.info"), `${name}-${report}\n`);
			}
		}
		const result = spawnSync(
			process.execPath,
			[new URL("./merge-coverage.mjs", import.meta.url).pathname, "--local"],
			{ cwd: root, encoding: "utf8" },
		);
		expect(result.status, result.stderr).toBe(0);
		const coverage = readFileSync(join(root, "coverage/lcov.info"), "utf8");
		expect(coverage).toMatch(/ordinary-unit/);
		expect(coverage).toMatch(/ordinary-integration/);
		expect(coverage).toMatch(/flat-/);
		expect(coverage).not.toMatch(/container/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
