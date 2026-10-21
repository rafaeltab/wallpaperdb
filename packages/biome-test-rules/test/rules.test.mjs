import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("incomplete expect calls fail, including accidental two-argument assertions", () => {
	for (const source of ["expect(1);", "expect(1, 2);", "expect(1).not;"])
		assert.ok(
			lint(`import { expect } from 'vitest'; ${source}`).some((d) =>
				d.message.includes("Complete the assertion"),
			),
			source,
		);
	for (const source of [
		"expect(1, 'reason').toBe(1);",
		"expect(1).not.toBe(2);",
	])
		assert.deepEqual(
			lint(`import { expect } from 'vitest'; ${source}`),
			[],
			source,
		);
});

test("assertion validation follows imported and local aliases without matching unrelated functions", () => {
	for (const source of [
		"import { expect as check } from 'vitest'; check(1, 2);",
		"import * as v from 'vitest'; v.expect(1);",
		"import { expect } from 'vitest'; const check = expect; check(1);",
		"import { expect } from '@playwright/test'; expect(1);",
		"import { expect } from 'vitest'; expect();",
		"import { expect } from 'vitest'; expect(1, 'reason', 2).toBe(1);",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("assertion")),
			source,
		);
	for (const source of [
		"function expect(a: number, b: number) { return a + b; } expect(1, 2);",
		"import { expect } from 'other-library'; expect(1);",
		"import { expect } from 'vitest'; expect.assertions(1); expect.hasAssertions();",
		"import { expect } from 'vitest'; expect(1).toEqual(expect.any(Number));",
		"import { expect as check } from 'vitest'; check(1, 'reason').toBe(1);",
	])
		assert.deepEqual(lint(source), [], source);
});
