import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runBounded } from "./lib/mutation-process.mjs";

async function expireReadyChild(t, dir, handler, graceMs, force = false) {
	const timeout = AbortSignal.timeout(5000);
	const ready = watch(dir, { signal: timeout });
	const readiness = (async () => {
		for await (const event of ready) if (event.filename === "ready") return;
	})();
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const running = runBounded(
		process.execPath,
		[
			"-e",
			`const fs = require('node:fs');
${handler}
fs.writeFileSync(${JSON.stringify(join(dir, "ready"))}, 'ready');
setInterval(() => {}, 1000);`,
		],
		{ budgetMs: 500, graceMs, stdio: "ignore" },
	);
	const reap = () => t.mock.timers.tick(500 + graceMs);
	timeout.addEventListener("abort", reap, { once: true });
	try {
		await readiness;
		// Expire the execution clock only after the child's handler is installed.
		t.mock.timers.tick(500);
		if (force) t.mock.timers.tick(graceMs);
		return await running;
	} finally {
		timeout.removeEventListener("abort", reap);
		await ready.return();
		reap();
		await running;
	}
}

test("deadline gives the child time to save a checkpoint and reports incomplete", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "mutation-budget-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const checkpoint = join(dir, "checkpoint");
	const result = await expireReadyChild(
		t,
		dir,
		`process.on('SIGINT', () => { fs.writeFileSync(${JSON.stringify(checkpoint)}, 'saved'); process.exit(130); });`,
		1000,
	);
	assert.equal(result.outcome, "budget-exhausted");
	assert.equal(readFileSync(checkpoint, "utf8"), "saved");
});
test("a stuck worker is killed after the grace period", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "mutation-stuck-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const result = await expireReadyChild(
		t,
		dir,
		"process.on('SIGINT', () => {});",
		100,
		true,
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
