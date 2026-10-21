import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Vitest retry overrides are rejected through registration and options aliases", () => {
	const prelude =
		"import { it, test as scenario, describe, suite } from 'vitest'; import * as checks from 'vitest'; const check = () => {};";
	for (const registration of [
		"it",
		"scenario",
		"describe",
		"suite",
		"checks.test",
		"it.each([1])",
		"it.concurrent",
		"checks['test']",
		"it.each`value\n${1}`",
	])
		assert.ok(
			lint(`${prelude} ${registration}('case', { retry: 3 }, check);`).some(
				(d) => d.message.includes("retry policy"),
			),
			registration,
		);
	for (const alias of [
		"const local = it;",
		"const first = it; const local = first;",
		"const local = it.each([1]);",
		"const local = checks.test;",
		"const group = checks; const local = group.it;",
	])
		assert.ok(
			lint(`${prelude} ${alias} local('case', { retry: 2 }, check);`).some(
				(d) => d.message.includes("retry policy"),
			),
			alias,
		);
	for (const options of [
		"{ retry: 2 }",
		"{ 'retry': 0 }",
		"{ ['retry']: 1 }",
		"{ ...shared }",
		"shared",
		"alias",
		"({ ...alias } satisfies Record<string, number>)",
	])
		assert.ok(
			lint(
				`${prelude} const shared = { retry: 4 }; const alias = shared; it('case', ${options}, check);`,
			).some((d) => d.message.includes("retry policy")),
			options,
		);
});

test("retry checks allow application options and test data and terminate alias cycles", () => {
	for (const source of [
		"import { it } from 'vitest'; const request = { retry: 3 }; it('case', () => request);",
		"import { it } from 'vitest'; it.each([{ retry: 2 }])('case', value => value.retry);",
		"const request = () => {}; const scenario = request; scenario('case', { retry: 3 }, () => {});",
		"const first = second; const second = first; first('case', { retry: 3 }, () => {});",
		"import { it } from 'vitest'; const first = { ...second }; const second = { ...first }; it('case', first, () => {});",
		"import { it } from 'vitest'; function check(it) { it('case', { retry: 2 }, () => {}); }",
		"import { it } from 'other-library'; it('case', { retry: 2 }, () => {});",
	])
		assert.deepEqual(lint(source), [], source);
});
