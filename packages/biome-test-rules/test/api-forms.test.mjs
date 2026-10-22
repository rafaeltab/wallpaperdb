import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("static template API members retain assertion and registration identity", () => {
	for (const source of [
		"import { expect } from 'vitest'; expect(Promise.resolve(1))[`resolves`][`toBe`](1);",
		"import { expect } from 'vitest'; expect(1)[`not`]();",
		"import { it as scenario } from 'vitest'; scenario[`skip`]('case', () => {});",
		"import { it as scenario } from 'vitest'; scenario[`only`]('case', () => {});",
		"import { Effect } from 'effect'; Effect[`runPromise`](Effect.succeed(1));",
	])
		assert.ok(lint(source).length > 0, source);
	for (const source of [
		"import { expect } from 'vitest'; await expect(Promise.resolve(1))[`resolves`][`toBe`](1);",
		"import { expect } from 'vitest'; expect(1)[`not`][`toBe`](2);",
		"import { it as scenario } from 'vitest'; scenario[`each`]([1])('case', () => {});",
		"import { it as scenario } from 'vitest'; const skip = 'each'; scenario[`${skip}`]([1]);",
		"import { it as scenario } from 'vitest'; scenario[tag`skip`]('case', () => {});",
		"import { it as scenario } from 'other-library'; scenario[`skip`]('case', () => {});",
		"import { it as scenario } from 'vitest'; function run(scenario) { scenario[`skip`]('case', () => {}); }",
	])
		assert.deepEqual(lint(source), [], source);
});

test("Vitest TODO options mark actual registrations unfinished", () => {
	for (const source of [
		"it('case', { todo: true }, () => {});",
		"it.concurrent('case', { todo: true }, () => {});",
		"it('case', () => {}, { todo: true });",
		"it.each([1])('case', { todo: true }, () => {});",
		"it.for([1])('case', { todo: true }, () => {});",
		"const options = { [`todo`]: true }; it('case', options, () => {});",
		"it('case', enabled ? { todo: true } : {}, () => {});",
	])
		assert.ok(
			lint("import { it } from 'vitest'; " + source).some((d) =>
				d.message.includes("unfinished"),
			),
			source,
		);
	for (const source of [
		"import { it } from 'vitest'; it('case', { todo: false }, () => {});",
		"import { it } from 'vitest'; const disabled = false; it('case', { todo: disabled }, () => {});",
		"import { it } from 'vitest'; it('case', { todo: (false as const) }, () => {});",
		"import { it } from 'vitest'; it('case', { todo: undefined }, () => {});",
		"import { it } from 'vitest'; it.each([{ todo: true }])('case', () => {});",
		"import { it } from 'vitest'; it.for([{ todo: true }])('case', () => {});",
		"import { it } from 'vitest'; const rows = it.each([{ todo: true }]); rows('case', () => {});",
		"import { it } from 'vitest'; it.extend({ todo: true })('case', () => {});",
		"import { it } from 'vitest'; function run(it) { it('case', { todo: true }, () => {}); }",
		"const application = (name, options, fn) => fn(); application('case', { todo: true }, () => {});",
	])
		assert.deepEqual(lint(source), [], source);
});

test("named default Node test imports share the native registration identity", () => {
	for (const source of [
		"scenario('unfinished', {});",
		"scenario.todo('unfinished');",
		"scenario.skip('case', () => {});",
		"scenario.only('case', () => {});",
		"scenario('case', { todo: true }, () => {});",
	])
		assert.ok(
			lint("import { default as scenario } from 'node:test'; " + source)
				.length > 0,
			source,
		);
	for (const source of [
		"import { default as scenario } from 'node:test'; scenario('complete', () => {});",
		"import { default as scenario } from 'node:test'; scenario('complete', { todo: false }, () => {});",
		"import { default as scenario } from 'node:test'; function run(scenario) { scenario('application', {}); }",
		"import { default as scenario } from 'other-library'; scenario('application', {});",
		"import { default as scenario } from 'node:test'; import { Effect } from 'effect'; scenario('complete', () => Effect.runPromise(Effect.succeed(1)));",
	])
		assert.deepEqual(lint(source), [], source);
});
