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
