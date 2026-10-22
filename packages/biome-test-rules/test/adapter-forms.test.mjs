import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const diagnostics = (source, rule) =>
	lint(source).filter((d) => d.message.startsWith(`${rule}:`));

test("computed retry identifier keys retain the upstream key.value behavior", () => {
	assert.deepEqual(
		diagnostics(
			"import { it } from 'vitest'; const retry = 'timeout'; it('case', { [retry]: 3 }, () => {});",
			"test-policy/no-retries",
		),
		[],
	);
	assert.equal(
		diagnostics(
			"import { it } from 'vitest'; it('case', { ['retry']: 3 }, () => {});",
			"test-policy/no-retries",
		).length,
		1,
	);
});

test("object methods and accessors retain property keys for retry inspection", () => {
	for (const member of [
		"timeout() {}",
		"get timeout() { return 3; }",
		"set timeout(value) {}",
	])
		assert.deepEqual(
			diagnostics(
				`import { it } from 'vitest'; it('case', { ${member} }, () => {});`,
				"test-policy/no-retries",
			),
			[],
		);
	for (const member of [
		"retry() {}",
		"get retry() { return 3; }",
		"set retry(value) {}",
	])
		assert.equal(
			diagnostics(
				`import { it } from 'vitest'; it('case', { ${member} }, () => {});`,
				"test-policy/no-retries",
			).length,
			1,
			member,
		);
});
