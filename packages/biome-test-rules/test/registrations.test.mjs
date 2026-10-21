import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Biome built-ins reject focused, disabled and self-comparing tests", () => {
	for (const [source, rule] of [
		[
			"import { it } from 'vitest'; it.only('case', () => {});",
			"noFocusedTests",
		],
		[
			"import { it } from 'vitest'; it.skip('case', () => {});",
			"noSkippedTests",
		],
		[
			"const value = 1; if (value === value) throw new Error('same');",
			"noSelfCompare",
		],
	])
		assert.ok(
			lint(source).some((d) => d.category.endsWith(rule)),
			source,
		);
});

test("unfinished todo registrations fail including aliases", () => {
	for (const source of [
		"import { it } from 'vitest'; it.todo('unfinished');",
		"import { it } from 'vitest'; it('unfinished');",
		"import { test as scenario } from 'vitest'; scenario.todo('unfinished');",
		"import * as v from 'vitest'; const local = v.describe; local.todo('unfinished');",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("unfinished")),
			source,
		);
	assert.deepEqual(
		lint(
			"const application = { todo(value) { return value; } }; application.todo('later');",
		),
		[],
	);
});

test("precise issue-linked built-in exceptions stay supported", () => {
	assert.deepEqual(
		lint(
			"import { it } from 'vitest';\n// biome-ignore lint/suspicious/noSkippedTests: https://github.com/rafaeltab/wallpaperdb/issues/200\nit.skip('tracked case', () => {});",
		),
		[],
	);
});
