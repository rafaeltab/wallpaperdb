import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const diagnostics = (source, rule) =>
	lint(source).filter((d) => d.message.startsWith(`${rule}:`));

test("assertions in parameter and destructuring defaults are visited", () => {
	for (const declaration of [
		"function check(value = expect(1)) {} check();",
		"const { value = expect(1) } = {};",
		"const { value: renamed = expect(1) } = {};",
	]) {
		const source = `import { expect } from 'vitest'; ${declaration}`;
		assert.equal(diagnostics(source, "valid-expect").length, 1, declaration);
		assert.deepEqual(
			diagnostics(
				source.replace("expect(1)", "expect(1).toBe(1)"),
				"valid-expect",
			),
			[],
		);
	}
});

test("poll assertions in defaults retain upstream await validation", () => {
	assert.equal(
		diagnostics(
			"import { expect } from 'vitest'; const check = (value = expect.poll(() => 1).toBe(1)) => {}; check();",
			"require-awaited-expect-poll",
		).length,
		1,
	);
	assert.deepEqual(
		diagnostics(
			"const check = (value = application.poll(() => 1).toBe(1)) => {}; check();",
			"require-awaited-expect-poll",
		),
		[],
	);
});
