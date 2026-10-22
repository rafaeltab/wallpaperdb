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
		"import { test } from 'node:test'; const callback = () => {}; test('complete', {}, callback);",
		"import { test } from 'node:test'; import { callback } from './helper'; test('complete', callback);",
	])
		assert.deepEqual(
			lint(source, { "helper.ts": "export function callback() {}" }),
			[],
			source,
		);
});
