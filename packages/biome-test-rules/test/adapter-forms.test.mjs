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

test("identifier escapes retain upstream assertion identity and shadowing", () => {
	for (const source of [
		String.raw`ex\u0070ect(1);`,
		String.raw`ex\u{70}ect(1);`,
		String.raw`import { ex\u0070ect as check } from 'vitest'; check(1);`,
		String.raw`test('case', ({ ex\u0070ect }) => { expect(1); });`,
	])
		assert.equal(diagnostics(source, "valid-expect").length, 1, source);
	for (const source of [
		String.raw`ex\u0070ect(1).toBe(1);`,
		String.raw`import { expect as che\u0063k } from 'vitest'; check(1).toBe(1);`,
		String.raw`function helper(ex\u0070ect) { expect(1); }`,
	])
		assert.deepEqual(diagnostics(source, "valid-expect"), [], source);
});

test("identifier escapes retain retry names and initializer binding identity", () => {
	for (const source of [
		String.raw`import { it } from 'vitest'; it('case', { retr\u0079: 3 }, () => {});`,
		String.raw`import { i\u0074 as scenario } from 'vitest'; scenario('case', { retry: 3 }, () => {});`,
		String.raw`import { it } from 'vitest'; const sc\u0065nario = it; scenario('case', { retry: 3 }, () => {});`,
		String.raw`import { it } from 'vitest'; const op\u0074ions = { retry: 3 }; it('case', options, () => {});`,
	])
		assert.equal(
			diagnostics(source, "test-policy/no-retries").length,
			1,
			source,
		);
	for (const source of [
		String.raw`import { it } from 'vitest'; const retry = 'timeout'; it('case', { [retr\u0079]: 3 }, () => {});`,
		String.raw`import { it } from 'application'; it('case', { retr\u0079: 3 }, () => {});`,
		String.raw`import { it } from 'vitest'; it('case', { time\u006fut: 3 }, () => {});`,
	])
		assert.deepEqual(diagnostics(source, "test-policy/no-retries"), [], source);
});
