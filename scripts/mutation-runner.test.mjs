import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the installed plugin against real Vitest. A name-filter mismatch can
// report every covered mutation as a survivor while ordinary tests stay green.
test("Vitest mutation selection detects nested assertions, static changes and suite failures", () => {
	const root = mkdtempSync(join(tmpdir(), "mutation-runner-"));
	try {
		mkdirSync(join(root, "src"));
		mkdirSync(join(root, "test"));
		symlinkSync(
			fileURLToPath(new URL("./node_modules", import.meta.url)),
			join(root, "node_modules"),
		);
		writeFileSync(join(root, "package.json"), '{"type":"module"}');
		writeFileSync(
			join(root, "src/policy.js"),
			"export const enabled = true;\nexport function allowed(n) { return n >= 3; }\n",
		);
		writeFileSync(
			join(root, "test/policy.test.js"),
			`import { describe, it, expect } from 'vitest';
import { enabled, allowed } from '../src/policy.js';
if (!enabled) throw new Error('Policy must be enabled');
describe('policy', () => { describe('boundary', () => {
  it('accepts the boundary', () => expect(allowed(3)).toBe(true));
  it('rejects below it', () => expect(allowed(2)).toBe(false));
}); });\n`,
		);
		writeFileSync(
			join(root, "vitest.config.js"),
			"export default {test:{isolate:false}};",
		);
		const config = {
			testRunner: "vitest",
			plugins: [import.meta.resolve("@stryker-mutator/vitest-runner")],
			vitest: { configFile: "vitest.config.js", related: true },
			mutate: ["src/*.js"],
			concurrency: 1,
			reporters: ["json"],
			jsonReporter: { fileName: "report.json" },
			thresholds: { break: null },
		};
		writeFileSync(join(root, "stryker.json"), JSON.stringify(config));
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { Stryker } from ${JSON.stringify(import.meta.resolve("@stryker-mutator/core"))}; await new Stryker({configFile:'stryker.json'}).runMutationTest();`,
			],
			{ cwd: root, encoding: "utf8", timeout: 90_000 },
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const mutants = Object.values(
			JSON.parse(readFileSync(join(root, "report.json"))).files,
		).flatMap((f) => f.mutants);
		assert.ok(mutants.length >= 5);
		assert.deepEqual(
			[...new Set(mutants.map((m) => m.status))],
			["Killed"],
			JSON.stringify(mutants),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
