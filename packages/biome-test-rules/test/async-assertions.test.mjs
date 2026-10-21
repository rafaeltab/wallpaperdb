import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Vitest async assertions and poll require handling through imported and local aliases", () => {
	for (const expression of [
		"expect(Promise.resolve(1)).resolves.toBe(1)",
		"expect(Promise.reject(1)).rejects.toBe(1)",
		"expect.poll(() => 1).toBe(1)",
		"expect.soft(Promise.resolve(1)).resolves.not.toBe(2)",
	]) {
		const prelude = "import { expect } from 'vitest'; ";
		assert.ok(
			lint(`${prelude}${expression};`).some((d) =>
				d.message.includes("async assertion"),
			),
			expression,
		);
		for (const handled of [
			`await ${expression};`,
			`function check() { return ${expression}; }`,
			`const check = () => (${expression});`,
			`${expression}.catch(() => {});`,
			`${expression}.then(() => {}, () => {});`,
			`const pending = ${expression}; await pending;`,
			`await Promise.all([${expression}]);`,
		])
			assert.deepEqual(lint(prelude + handled), [], handled);
	}
	assert.ok(
		lint(
			"import { expect as check } from 'vitest'; check.poll(() => 1).toBe(1);",
		).length > 0,
	);
	assert.ok(
		lint(
			"import * as v from 'vitest'; const check = v.expect; check(Promise.resolve(1)).resolves.toBe(1);",
		).length > 0,
	);
	assert.ok(
		lint(
			"import { it } from 'vitest'; it.concurrent.for([1])('case', (value, { expect: check }) => { check.poll(() => value).toBe(1); });",
		).some((d) => d.message.includes("async assertion")),
	);
	assert.deepEqual(
		lint(
			"import { it } from 'vitest'; it.for([1])('case', async (value, { expect }) => { await expect.poll(() => value).toBe(1); });",
		),
		[],
	);
});

test("an unhandled then or finally does not handle async assertions", () => {
	for (const suffix of [
		".then(() => {})",
		".finally(() => {})",
		".then(() => {}).finally(() => {})",
	])
		assert.ok(
			lint(
				`import { expect } from 'vitest'; expect.poll(() => 1).toBe(1)${suffix};`,
			).length > 0,
			suffix,
		);
	assert.deepEqual(
		lint("import { expect } from 'vitest'; expect(1).toBe(1);"),
		[],
	);
});
