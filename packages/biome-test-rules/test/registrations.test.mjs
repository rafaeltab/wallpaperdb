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

test("binding checks fill focused and disabled registration gaps in the built-ins", () => {
	for (const source of [
		"import { it as scenario } from 'vitest'; scenario.only('case', () => {});",
		"import * as v from 'vitest'; v.test.skip('case', () => {});",
		"import { it } from 'vitest'; const local = it; local.only('case', () => {});",
		"import { it } from 'vitest'; const { skip: disabled } = it; disabled('case', () => {});",
		"import { it } from 'vitest'; let focused; focused = it.only; focused('case', () => {});",
		"import { test } from 'node:test'; test.todo('unfinished');",
		"import scenario from 'node:test'; scenario.todo('unfinished');",
	])
		assert.ok(
			lint(source).some((d) => d.severity === "error"),
			source,
		);
	assert.deepEqual(
		lint(
			"const request = { only(value) { return value; } }; request.only('application');",
		),
		[],
	);
});

test("test API alias analysis stops at reassignment and unrelated shadowing", () => {
	for (const source of [
		"import { it } from 'vitest'; let local = it; local = request; local('case', { retry: 3 }, () => {});",
		"import { it } from 'vitest'; let local; local = it.only; local = request; local('case', () => {});",
		"import { it } from 'vitest'; const { skip: disabled } = it; function run(disabled) { disabled('case', () => {}); }",
		"const it = { skip() {} }; const { skip: disabled } = it; disabled('case', () => {});",
		"import { it } from 'vitest'; let local; if (condition) local = it.only; local('case', () => {});",
	])
		assert.deepEqual(lint(source), [], source);
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

test("Node placeholders require a callback and reject native todo options", () => {
	for (const source of [
		"import { test } from 'node:test'; test('unfinished', {});",
		"import { test } from 'node:test'; test('unfinished', { todo: true }, () => {});",
		"import { test } from 'node:test'; const options = { todo: 'later' }; test('unfinished', options, () => {});",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("unfinished")),
			source,
		);
	for (const source of [
		"import { test } from 'node:test'; test('complete', () => {});",
		"import { test } from 'node:test'; test(() => {});",
		"import { test } from 'node:test'; test('complete', { todo: false }, () => {});",
		"import { test } from 'node:test'; test('complete', { todo: (false) }, () => {});",
		"import { test } from 'node:test'; test('complete', { todo: false as const }, () => {});",
		"import { test } from 'node:test'; test('complete', { todo: undefined }, () => {});",
		"import { test } from 'node:test'; const disabled = false; test('complete', { todo: disabled }, () => {});",
		"import { test } from 'node:test'; const todo = false; test('complete', { todo }, () => {});",
		"import { test } from 'node:test'; const callback = () => {}; test('complete', {}, callback);",
		"import { test } from 'node:test'; import { callback } from './helper'; test('complete', callback);",
	])
		assert.deepEqual(
			lint(source, { "helper.ts": "export function callback() {}" }),
			[],
			source,
		);
});

test("Node TODO options follow a single direct assignment", () => {
	assert.ok(
		lint(
			"import { test } from 'node:test'; let options; options = { todo: true }; test('case', options, () => {});",
		).some((d) => d.message.includes("unfinished")),
	);
	assert.deepEqual(
		lint(
			"import { test } from 'node:test'; let options = { todo: true }; options = { todo: false }; test('case', options, () => {});",
		),
		[],
	);
});

test("modified Vitest registrations require a callback without rejecting API factories", () => {
	for (const source of [
		"it.concurrent('unfinished');",
		"it('unfinished', { timeout: 1000 });",
		"it.concurrent('unfinished', { timeout: 1000 });",
		"it.each([1])('unfinished');",
		"const factory = it.each; const cases = factory([1]); cases('unfinished');",
	])
		assert.ok(
			lint("import { it } from 'vitest'; " + source).some((d) =>
				d.message.includes("unfinished"),
			),
			source,
		);
	for (const source of [
		"it.concurrent('complete', () => {}, 1000);",
		"it('complete', { timeout: 1000 }, () => {});",
		"const rows = it.each([1]); rows('complete', () => {});",
		"const factory = it.for; const rows = factory([1]); rows('complete', () => {});",
		"const extended = it.extend({ value: 1 }); extended('complete', () => {});",
		"it.each([1]); it.for([1]);",
		"const condition = it.skipIf(false); condition('complete', () => {});",
		"const condition = it.runIf(true); condition('complete', () => {});",
	])
		assert.ok(
			!lint("import { it } from 'vitest'; " + source).some((d) =>
				d.message.includes("unfinished"),
			),
			source,
		);
	assert.deepEqual(
		lint(
			"import { it } from 'vitest'; import { callback } from './helper'; it.concurrent('complete', callback, 1000);",
			{ "helper.ts": "export function callback() {}" },
		),
		[],
	);
});

test("Node TODO options inspect locally visible alternatives", () => {
	for (const options of [
		"enabled ? { todo: true } : {}",
		"enabled ? {} : { todo: true }",
		"enabled && { todo: true }",
		"maybe ?? { todo: true }",
	])
		assert.ok(
			lint(
				`import { test } from 'node:test'; test('case', ${options}, () => {});`,
			).some((d) => d.message.includes("unfinished")),
			options,
		);
	assert.deepEqual(
		lint(
			"import { test } from 'node:test'; test('case', enabled ? { todo: false } : {}, () => {});",
		),
		[],
	);
});

test("Node TODO option keys include no-substitution templates", () => {
	assert.ok(
		lint(
			"import { test } from 'node:test'; test('case', { [`todo`]: true }, () => {});",
		).some((d) => d.message.includes("unfinished")),
	);
	assert.deepEqual(
		lint(
			"import { test } from 'node:test'; test('case', { [`todo`]: false }, () => {});",
		),
		[],
	);
});
