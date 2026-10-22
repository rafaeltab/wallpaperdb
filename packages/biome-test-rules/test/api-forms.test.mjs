import assert from "node:assert/strict";
import { test } from "node:test";
import * as nodeTest from "node:test";
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

test("namespace Node default members share the native test function", () => {
	assert.equal(nodeTest.default, nodeTest.test);
	for (const source of [
		"nodeTest.default('unfinished', {});",
		"nodeTest.default.todo('unfinished');",
		"nodeTest.default.skip('case', () => {});",
		"const scenario = nodeTest.default; scenario('unfinished', {});",
	])
		assert.ok(
			lint("import * as nodeTest from 'node:test'; " + source).length > 0,
			source,
		);
	for (const source of [
		"import * as nodeTest from 'node:test'; nodeTest.default('complete', () => {});",
		"import * as nodeTest from 'node:test'; nodeTest.default('complete', { todo: false }, () => {});",
		"import * as nodeTest from 'node:test'; const scenario = nodeTest.default; scenario('complete', () => {});",
		"import * as nodeTest from 'node:test'; function run(nodeTest) { nodeTest.default('application', {}); }",
		"import * as nodeTest from 'other-library'; nodeTest.default('application', {});",
	])
		assert.deepEqual(lint(source), [], source);
});

test("registration options reject focus and disable flags without treating row data as options", () => {
	for (const flag of ["skip", "only"]) {
		for (const source of [
			`import { it } from 'vitest'; it('case', { ${flag}: true }, () => {});`,
			`import { it as scenario } from 'vitest'; scenario.concurrent('case', () => {}, { ${flag}: true });`,
			`import { it } from 'vitest'; it.each([1])('case', { ${flag}: true }, () => {});`,
			`import { it } from 'vitest'; it.for([1])('case', { ${flag}: true }, () => {});`,
			`import { describe } from 'vitest'; describe('case', { ${flag}: true }, () => {});`,
			`import { it } from '@effect/vitest'; const options = { ${flag}: true }; it('case', options, () => {});`,
			`import { test } from 'node:test'; test('case', { ${flag}: true }, () => {});`,
			`import { default as scenario } from 'node:test'; scenario({ ${flag}: true }, () => {});`,
			`import * as nodeTest from 'node:test'; nodeTest.default('case', enabled ? { ${flag}: true } : {}, () => {});`,
		])
			assert.ok(
				lint(source).some((d) => d.message.includes("registration options")),
				source,
			);
		for (const source of [
			`import { it } from 'vitest'; it('case', { ${flag}: false }, () => {});`,
			`import { test } from 'node:test'; test('case', { ${flag}: (false as const) }, () => {});`,
			`import { it } from 'vitest'; const disabled = false; it('case', { ${flag}: disabled }, () => {});`,
			`import { test } from 'node:test'; test('case', { ${flag}: undefined }, () => {});`,
			`import { it } from 'vitest'; it.each([{ ${flag}: true }])('case', () => {});`,
			`import { it } from 'vitest'; it.for([{ ${flag}: true }])('case', () => {});`,
			`import { it } from 'vitest'; const rows = it.each([{ ${flag}: true }]); rows('case', () => {});`,
			`import { it } from 'vitest'; it.extend({ ${flag}: true })('case', () => {});`,
			`import { it } from 'vitest'; function run(it) { it('application', { ${flag}: true }, () => {}); }`,
			`import { it } from 'other-library'; it('application', { ${flag}: true }, () => {});`,
			`const application = (name, options, fn) => fn(); application('case', { ${flag}: true }, () => {});`,
		])
			assert.deepEqual(lint(source), [], source);
	}
});

test("computed destructuring preserves static API and task-local assertion identities", () => {
	for (const source of [
		"import { it } from 'vitest'; const { ['skip']: disabled } = it; disabled('case', () => {});",
		"import { it } from 'vitest'; const { [`only`]: focused } = it; focused('case', () => {});",
		"import { it } from 'vitest'; const { ['todo']: unfinished } = it; unfinished('case');",
		"import { it } from 'vitest'; it('case', ({ ['expect']: check }) => { check(1); });",
		"import { it } from 'vitest'; it('case', context => { const { [`expect`]: check } = context; check(1); });",
	])
		assert.ok(
			lint(source).some((d) => d.severity === "error"),
			source,
		);
	for (const source of [
		"import { it } from 'vitest'; it('case', ({ [`expect`]: check }) => { check(1).toBe(1); });",
		"import { it } from 'vitest'; const key = 'each'; const { [key]: skip } = it; skip([1]);",
		"import { it } from 'other-library'; const { ['skip']: disabled } = it; disabled('case', () => {});",
		"import { it } from 'vitest'; const { ['skip']: disabled } = it; function run(disabled) { disabled('case', () => {}); }",
	])
		assert.deepEqual(lint(source), [], source);
});

test("unique direct callback assignments distinguish options from real handlers", () => {
	for (const source of [
		"import { test } from 'node:test'; let body; body = {}; test('unfinished', body);",
		"import { it } from 'vitest'; let body; body = {}; it('unfinished', body);",
		"import { test } from 'node:test'; let body = () => {}; body = {}; test('unfinished', body);",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("unfinished")),
			source,
		);
	for (const source of [
		"import { test } from 'node:test'; let body; body = () => {}; test('complete', body);",
		"import { it } from 'vitest'; let body = {}; body = () => {}; it('complete', body);",
		"import { test } from 'node:test'; let body = () => {}; test('complete', body); body = {};",
		"import { test } from 'node:test'; import { body } from './helper'; test('complete', body);",
	])
		assert.deepEqual(
			lint(source, { "helper.ts": "export function body() {}" }),
			[],
			source,
		);
});

test("Node named modifier exports retain their native test identity", () => {
	for (const modifier of ["skip", "only", "todo"]) {
		assert.equal(nodeTest[modifier], nodeTest.test[modifier]);
		for (const source of [
			`import { ${modifier} as scenario } from 'node:test'; scenario('case', () => {});`,
			`import * as nodeTest from 'node:test'; nodeTest.${modifier}('case', () => {});`,
		])
			assert.ok(
				lint(source).some((d) => d.severity === "error"),
				source,
			);
		for (const source of [
			`import { ${modifier} as scenario } from 'other-library'; scenario('case', () => {});`,
			`import { ${modifier} as scenario } from 'node:test'; function run(scenario) { scenario('case', () => {}); }`,
		])
			assert.deepEqual(lint(source), [], source);
	}
});

test("Node callback contexts expose nested test and current-test modifiers", async (context) => {
	assert.equal(typeof context.test, "function");
	assert.equal(typeof context.skip, "function");
	assert.equal(typeof context.todo, "function");
	await context.test("runtime child callback control", () => {});
	for (const source of [
		"test('parent', async t => { await t.test('unfinished'); });",
		"test('parent', t => { t.skip('disabled'); });",
		"test('parent', t => { t.todo('unfinished'); });",
		"test(async t => { await t.test('unfinished', {}); });",
		"test('parent', async t => { const child = t.test; await child('unfinished'); });",
	])
		assert.ok(
			lint("import { test } from 'node:test'; " + source).some(
				(d) => d.severity === "error",
			),
			source,
		);
	for (const source of [
		"import { test } from 'node:test'; test('parent', async t => { await t.test('complete', () => {}); });",
		"import { test } from 'node:test'; test('parent', async t => { await t.test('complete', { skip: false }, () => {}); });",
		"import { test } from 'node:test'; test('parent', t => { function run(t) { t.skip('application'); } });",
		"import { test } from 'other-library'; test('parent', t => { t.todo('application'); });",
	])
		assert.deepEqual(lint(source), [], source);
});

test("shorthand option names remain literal while computed identifier keys stay unresolved", () => {
	for (const flag of ["retry", "todo", "skip", "only"])
		assert.ok(
			lint(
				`import { it } from 'vitest'; const ${flag} = true; it('case', { ${flag} }, () => {});`,
			).some((d) => d.severity === "error"),
			flag,
		);
	for (const flag of ["todo", "skip", "only"]) {
		assert.deepEqual(
			lint(
				`import { it } from 'vitest'; const ${flag} = false; it('case', { ${flag} }, () => {});`,
			),
			[],
			flag,
		);
		assert.deepEqual(
			lint(
				`import { it } from 'vitest'; const ${flag} = 'timeout'; it('case', { [${flag}]: true }, () => {});`,
			),
			[],
			flag,
		);
	}
});

test("flag options respect the last known write while retries forbid any override", () => {
	for (const flag of ["todo", "skip", "only"]) {
		for (const options of [
			`{ ...{ ${flag}: true }, ${flag}: false }`,
			`{ ${flag}: true, ...{ ${flag}: false } }`,
			`{ ${flag}: true, ...disabled }`,
			`{ ...enabled, ...disabled }`,
			`{ ${flag}: true, ...(condition ? disabled : disabled) }`,
		])
			assert.deepEqual(
				lint(
					`import { it } from 'vitest'; const disabled = { ${flag}: false }; const enabled = { ${flag}: true }; it('case', ${options}, () => {});`,
				),
				[],
				options,
			);
		for (const options of [
			`{ ${flag}: false, ...{ ${flag}: true } }`,
			`{ ...{ ${flag}: false }, ${flag}: true }`,
			`{ ${flag}: true, ...{} }`,
			`{ ${flag}: true, ...(condition ? { ${flag}: false } : {}) }`,
		])
			assert.ok(
				lint(
					`import { it } from 'vitest'; it('case', ${options}, () => {});`,
				).some((d) => d.severity === "error"),
				options,
			);
	}
	for (const options of [
		"{ retry: false }",
		"{ ...{ retry: 3 }, retry: false }",
		"{ retry: 3, ...{ retry: false } }",
	])
		assert.ok(
			lint(
				`import { it } from 'vitest'; it('case', ${options}, () => {});`,
			).some((d) => d.message.includes("retry policy")),
			options,
		);
});

test("Node skip and TODO string reasons remain flags even when empty", () => {
	for (const flag of ["skip", "todo"]) {
		for (const value of ["''", '""', "``", "reason"])
			assert.ok(
				lint(
					`import { test } from 'node:test'; const reason = ''; test('case', { ${flag}: ${value} }, () => {});`,
				).some((d) => d.severity === "error"),
				`${flag}: ${value}`,
			);
		assert.ok(
			lint(
				`import { test } from 'node:test'; const ${flag} = ''; test('case', { ${flag} }, () => {});`,
			).some((d) => d.severity === "error"),
			flag,
		);
		for (const source of [
			`import { test } from 'node:test'; test('case', { ${flag}: false }, () => {});`,
			`import { it } from 'vitest'; it('case', { ${flag}: '' }, () => {});`,
			`import { it } from 'vitest'; it('case', { ${flag}: \`\` }, () => {});`,
		])
			assert.deepEqual(lint(source), [], source);
	}
	assert.deepEqual(
		lint(
			"import { test } from 'node:test'; test('case', { only: false }, () => {});",
		),
		[],
	);
});
