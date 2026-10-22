import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Vitest task-local expect rejects incomplete assertions through destructured aliases and for context", () => {
	for (const source of [
		"import { it } from 'vitest'; it('checks', ({ expect }) => { expect(1); });",
		"import { it } from 'vitest'; it('checks', ({ expect }) => { expect(1); }, 1000);",
		"import { it } from 'vitest'; it.for([1])('checks', (value, { expect: check }) => { check(value); }, 1000);",
		"import { it as scenario } from 'vitest'; scenario('checks', ({ expect: check }) => { check(1, 2); });",
		"import { it } from 'vitest'; it.concurrent.for([1])('checks', (value, { expect }) => { expect(value); });",
		"import * as v from 'vitest'; v.test.for([1])('checks', (value, { expect: check }) => { check(value); });",
		"import { it } from 'vitest'; it('checks', context => { context.expect(1); });",
		"import { it } from 'vitest'; it('checks', context => { const { expect } = context; expect(1); });",
		"import { it } from 'vitest'; it.for([1])('checks', (value, context) => { const { expect: check } = context; check(value); });",
		"import { expect } from '@effect/vitest'; expect(1);",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("Complete the assertion")),
			source,
		);
});

test("task-local async assertions are recognized before a trailing timeout", () => {
	assert.ok(
		lint(
			"import { it } from 'vitest'; it('checks', ({ expect }) => { expect.poll(() => 1).toBe(1); }, 1000);",
		).some((d) => d.message.includes("async assertion")),
	);
});

test("inner task-context destructuring retains async assertion identity", () => {
	assert.ok(
		lint(
			"import { it } from 'vitest'; it('case', context => { const { expect: check } = context; check(Promise.resolve(1)).resolves.toBe(1); });",
		).some((d) => d.message.includes("async assertion")),
	);
	assert.deepEqual(
		lint(
			"import { it } from 'vitest'; it('case', async context => { const { expect: check } = context; await check(Promise.resolve(1)).resolves.toBe(1); });",
		),
		[],
	);
	assert.deepEqual(
		lint(
			"const context = { expect(value) {} }; const { expect } = context; expect(1);",
		),
		[],
	);
});

test("task-local matchers remain valid and unrelated context or data bindings are accepted", () => {
	for (const source of [
		"import { it } from 'vitest'; it('checks', ({ expect: check }) => { check(1).toBe(1); });",
		"import { it } from 'vitest'; it('checks', ({ expect: check }) => { check(1).toBe(1); }, 1000);",
		"import { it } from 'vitest'; it('checks', async ({ expect }) => { await expect.poll(() => 1).toBe(1); }, 1000);",
		"import { it } from 'vitest'; it.for([1])('checks', (value, { expect }) => { expect(value).toBe(1); });",
		"function check({ expect }) { expect(1); }",
		"import { it } from 'vitest'; it('checks', () => { function local(expect) { expect(1); } });",
		"import { it } from 'vitest'; it.for([{ expect() {} }])('checks', ({ expect }, context) => { expect(1); });",
		"import { it } from 'vitest'; it.each([{ expect() {} }])('checks', ({ expect }) => { expect(1); });",
	])
		assert.deepEqual(lint(source), [], source);
});
