import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBounded } from "./lib/mutation-process.mjs";

test("deadline gives the child time to save a checkpoint and reports incomplete", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "mutation-budget-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const checkpoint = join(dir, "checkpoint");
	const result = await runBounded(
		process.execPath,
		[
			"-e",
			`
    const fs = require('node:fs');
    process.on('SIGINT', () => { fs.writeFileSync(${JSON.stringify(checkpoint)}, 'saved'); process.exit(130); });
    setInterval(() => {}, 1000);
  `,
		],
		{ budgetMs: 500, graceMs: 1000, stdio: "ignore" },
	);
	assert.equal(result.outcome, "budget-exhausted");
	assert.equal(readFileSync(checkpoint, "utf8"), "saved");
});
test("a stuck worker is killed after the grace period", async () => {
	const result = await runBounded(
		process.execPath,
		["-e", "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)"],
		{ budgetMs: 500, graceMs: 100, stdio: "ignore" },
	);
	assert.equal(result.outcome, "budget-exhausted");
	assert.equal(result.signal, "SIGKILL");
});
test("runner failures are not budget expirations", async () => {
	const result = await runBounded(process.execPath, ["-e", "process.exit(1)"], {
		budgetMs: 1000,
		stdio: "ignore",
	});
	assert.equal(result.outcome, "failed");
	const success = await runBounded(
		process.execPath,
		["-e", "process.exit(0)"],
		{ budgetMs: 1000, stdio: "ignore" },
	);
	assert.equal(success.outcome, "completed");
});
