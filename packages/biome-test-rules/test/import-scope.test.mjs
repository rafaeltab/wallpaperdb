import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const diagnostics = (source, rule) =>
	lint(source).filter((d) => d.message.startsWith(`${rule}:`));

test("the pinned parser recognizes destructured dynamic and require imports", () => {
	for (const module of ["await import('vitest')", "require('vitest')"])
		assert.equal(
			diagnostics(
				`const { expect: check } = ${module}; check(1);`,
				"valid-expect",
			).length,
			1,
			module,
		);
	assert.deepEqual(
		diagnostics(
			"const { expect: check } = require('application'); check(1);",
			"valid-expect",
		),
		[],
	);
});

test("an unrelated nested function parameter is not a test callback context", () => {
	assert.deepEqual(
		diagnostics(
			"test('case', () => { const helper = (expect) => { expect(1); }; helper(() => {}); });",
			"valid-expect",
		),
		[],
	);
	assert.equal(
		diagnostics("test('case', (expect) => { expect(1); });", "valid-expect")
			.length,
		1,
	);
});
