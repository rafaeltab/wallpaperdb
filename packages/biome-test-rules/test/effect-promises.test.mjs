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

test("Effect promise checks accept synchronous APIs and unrelated or shadowed names", () => {
	for (const source of [
		"import { Effect } from 'effect'; Effect.runSync(Effect.succeed('done'));",
		"const Effect = { runPromise(value) { return value; } }; Effect.runPromise('sync');",
		"import { Effect } from 'effect'; function run(Effect) { Effect.runPromise('sync'); }",
		"import { runPromise } from 'other-library'; runPromise('sync');",
	])
		assert.deepEqual(lint(source), [], source);
});
