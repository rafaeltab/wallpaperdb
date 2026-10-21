import assert from "node:assert/strict";
import test from "node:test";
import { scanDelays, retryFailure } from "./checks.mjs";

test("direct synchronization delays are candidates, including property calls", () => {
	for (const source of [
		"await new Promise(r => setTimeout(r, 300));",
		"await page.waitForTimeout(300);",
		"await sleep(300);",
		"await timers.setTimeout(300);",
	])
		assert.equal(scanDelays(source).length, 1);
});

test("controlled time and explicit timing purposes avoid false positives", () => {
	for (const source of [
		"vi.advanceTimersByTime(300);",
		"// stability-allow: timing-contract verifies debounce boundary\nawait sleep(300);",
		"// stability-allow: deadline-guard bounds hung operation\nsetTimeout(reject, 300);",
		"// stability-allow: fake-response models slow upstream\nsetTimeout(resolve, 300);",
		"beforeAll(() => { fixture = createOwnedFixture(); });",
	])
		assert.equal(scanDelays(source).length, 0);
	assert.equal(
		scanDelays("// stability-allow: anything\nawait sleep(300);").length,
		1,
	);
});

test("scanner exposes its semantic and alias limitations", () => {
	// A slow fake without a purpose annotation is a false positive.
	assert.equal(
		scanDelays("const fake = () => new Promise(r => setTimeout(r, 20));")
			.length,
		1,
	);
	// Indirect helpers and timer aliases are deliberately out of scope.
	assert.equal(scanDelays("const pause = sleep; await pause(300);").length, 0);
});

test("recovered retries fail while clean and unavailable diagnostics differ", () => {
	assert.equal(retryFailure([{ result: { state: "skipped" } }]), false);
	assert.equal(retryFailure([{ retryCount: 0 }]), false);
	assert.equal(retryFailure([{ retryCount: 1 }]), true);
	assert.throws(() => retryFailure([{}]), /Missing retry diagnostics/);
});
