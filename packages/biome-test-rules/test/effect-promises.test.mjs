import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("known imported Effect promise APIs require handling through bindings", () => {
	for (const [prelude, expression] of [
		[
			"import { Effect } from 'effect';",
			"Effect.runPromise(Effect.succeed('done'))",
		],
		[
			"import { Effect as E } from 'effect';",
			"E.runPromiseExit(E.succeed('done'))",
		],
		["import * as E from 'effect/Effect';", "E.runPromise(E.succeed('done'))"],
		[
			"import { runPromise as execute, succeed } from 'effect/Effect';",
			"execute(succeed('done'))",
		],
		[
			"import { Effect } from 'effect'; const execute = Effect.runPromise;",
			"execute(Effect.succeed('done'))",
		],
	]) {
		assert.ok(
			lint(`${prelude} ${expression};`).some((d) =>
				d.message.includes("Effect promise"),
			),
			expression,
		);
		for (const handled of [
			`await ${expression};`,
			`function run() { return ${expression}; }`,
			`${expression}.catch(() => {});`,
			`void ${expression};`,
			`const pending = ${expression}; await pending;`,
		])
			assert.deepEqual(lint(`${prelude} ${handled}`), [], handled);
	}
});

test("Effect promises can be handled by async matchers or a later assignment read", () => {
	for (const source of [
		"import { Effect } from 'effect'; import { expect } from 'vitest'; await expect(Effect.runPromise(Effect.succeed('done'))).resolves.toBe('done');",
		"import { Effect } from 'effect'; let pending: Promise<string> | undefined; pending = Effect.runPromise(Effect.succeed('done')); await pending;",
	])
		assert.deepEqual(lint(source), [], source);
	assert.ok(
		lint(
			"import { Effect } from 'effect'; import { expect } from 'vitest'; expect(Effect.runPromise(Effect.succeed('done'))).toBeDefined();",
		).length > 0,
	);
});

test("Effect promise checks accept synchronous APIs and unrelated or shadowed names", () => {
	for (const source of [
		"import { Effect } from 'effect'; Effect.runSync(Effect.succeed('done'));",
		"const Effect = { runPromise(value) { return value; } }; Effect.runPromise('sync');",
		"import { Effect } from 'effect'; function run(Effect) { Effect.runPromise('sync'); }",
		"import { runPromise } from 'other-library'; runPromise('sync');",
	])
		assert.deepEqual(lint(source), [], source);
});

test("Node lifecycle hooks await promise returns through source-bound aliases", () => {
	for (const hook of ["before", "after", "beforeEach", "afterEach"]) {
		assert.deepEqual(
			lint(
				`import { Effect } from 'effect'; import { ${hook} } from 'node:test'; ${hook}(() => Effect.runPromise(Effect.succeed(1)));`,
			),
			[],
			hook,
		);
		for (const declaration of [
			`import { ${hook} as lifecycle } from 'node:test';`,
			`import * as hooks from 'node:test'; const lifecycle = hooks.${hook};`,
		])
			assert.deepEqual(
				lint(
					`import { Effect } from 'effect'; ${declaration} lifecycle(() => Effect.runPromise(Effect.succeed(1)));`,
				),
				[],
				hook,
			);
	}
	for (const source of [
		"import { Effect } from 'effect'; import { before } from 'node:test'; function run(before) { before(() => Effect.runPromise(Effect.succeed(1))); }",
		"import { Effect } from 'effect'; import { after } from 'other-library'; after(() => Effect.runPromise(Effect.succeed(1)));",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("Effect promise")),
			source,
		);
});
