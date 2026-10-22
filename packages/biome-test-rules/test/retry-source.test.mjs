import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

const retries = (source) =>
	lint(source).filter((d) => d.message.startsWith("test-policy/no-retries:"));

test("the pinned retry rule covers registrations, import aliases and shared spreads", () => {
	const diagnostics = retries(`
import { expect, it, test as scenario, describe } from 'vitest';
import * as checks from 'vitest';
const check = () => expect(1).toBe(1);
it('inline', { retry: 3 }, check);
scenario('alias', { retry: 1 }, check);
checks.test('namespace', { retry: 2 }, check);
describe('suite', { retry: 2 }, () => it('nested', check));
const options = { retry: 4 };
it.each([1])('shared options', { ...options }, check);
`);
	assert.equal(diagnostics.length, 5, JSON.stringify(diagnostics));
});

test("the pinned retry rule follows initializer aliases and terminates cycles", () => {
	for (const alias of [
		"const scenario = it;",
		"const first = it; const scenario = first;",
		"const scenario = it.each([1]);",
		"const scenario = checks.test;",
		"const group = checks; const scenario = group.it;",
	])
		assert.equal(
			retries(
				`import { it } from 'vitest'; import * as checks from 'vitest'; ${alias} scenario('case', { retry: 3 }, () => {});`,
			).length,
			1,
			alias,
		);
	for (const source of [
		"const request = () => {}; const scenario = request; scenario('request', { retry: 3 }, () => {});",
		"const first = second; const second = first; first('cycle', { retry: 3 }, () => {});",
		"import { it } from 'vitest'; const options = { retry: 3 }; it.each([{ retry: 2 }])('data', value => value.retry); it('application', () => options);",
	])
		assert.deepEqual(retries(source), [], source);
});

test("retry translation retains initializer-only syntax instead of adding flow analysis", () => {
	for (const source of [
		"import { it } from 'vitest'; let options; options = { retry: 3 }; it('case', options, () => {});",
		"import { it } from 'vitest'; it('case', flag ? { retry: 3 } : {}, () => {});",
		"import { it } from 'vitest'; const key = 'retry'; it('case', { [key]: 3 }, () => {});",
	])
		assert.deepEqual(retries(source), [], source);
});
