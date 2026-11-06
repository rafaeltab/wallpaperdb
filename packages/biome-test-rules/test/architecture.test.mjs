import assert from "node:assert/strict";
import test from "node:test";
import { lint } from "./lint.mjs";
const check = (
	source,
	file = "apps/example/src/capabilities/search/implementation.ts",
) => lint(source, {}, file).filter((d) => d.message.startsWith("capability-"));
test("capabilities reject runtime execution and global configuration without rejecting shadowed names", () => {
	for (const source of [
		"import { Effect as E } from 'effect'; E.runPromise(task);",
		"import { runPromise as execute } from 'effect/Effect'; execute(task);",
		"process.env.TOKEN;",
		"const { env } = process;",
	])
		assert.ok(check(source).length, source);
	for (const source of [
		"import { Effect } from 'effect'; Effect.map(task, f);",
		"function local(process) { return process.env; }",
		"const E = { runPromise() {} }; E.runPromise();",
	])
		assert.equal(check(source).length, 0, source);
});
test("capabilities reject namespace execution and the pinned Effect runner family", () => {
	for (const source of [
		"import * as E from 'effect'; E.Effect.runSync(E.Effect.succeed(1));",
		"import * as E from 'effect'; E['Effect']['runPromiseWith'](services)(task);",
		"import { Runtime } from 'effect'; Runtime.makeRunMain(options);",
		...[
			"runForkWith",
			"runCallbackWith",
			"runPromiseWith",
			"runPromiseExitWith",
			"runSyncWith",
			"runSyncExitWith",
		].map(
			(name) =>
				`import { Effect } from 'effect'; Effect.${name}(services)(task);`,
		),
	])
		assert.ok(
			check(source).some((d) => d.message.startsWith("capability-execution:")),
			source,
		);
	for (const source of [
		"import * as E from 'effect'; E.Effect.succeed(1); E.Option.make;",
		"import * as E from 'effect'; function local(E) { E.Effect.runSync(task); }",
		"import { Effect } from 'effect'; const runSync = 'succeed'; Effect[runSync](1);",
	])
		assert.equal(check(source).length, 0, source);
});
test("capability entries contain explicit reexports and contracts remain in contract.ts", () => {
	const file = "apps/example/src/capabilities/search/index.ts";
	assert.ok(check("export type * from './contract.js';", file).length);
	assert.ok(check("export interface Search { query(): string }", file).length);
	assert.equal(
		check(
			"export type { Search } from './contract.js'; export { live } from './implementation.js';",
			file,
		).length,
		0,
	);
	assert.equal(
		check(
			"export interface Search { query(): string }",
			file.replace("index.ts", "contract.ts"),
		).length,
		0,
	);
});

test("undeclared imports fail while declared dependencies and builtins pass", () => {
	const files = {
		"package.json": JSON.stringify({ dependencies: { declared: "1.0.0" } }),
	};
	assert.ok(
		lint("import 'undeclared';", files).some(
			(d) => d.category === "lint/correctness/noUndeclaredDependencies",
		),
	);
	assert.equal(
		lint("import 'declared'; import 'node:fs';", files).filter(
			(d) => d.category === "lint/correctness/noUndeclaredDependencies",
		).length,
		0,
	);
});

test("fixed-wait diagnostics are advisory and do not flag unrelated application methods", () => {
	assert.ok(
		lint("await page.waitForTimeout(100);").some(
			(d) =>
				d.message.startsWith("test-fixed-wait:") && d.severity === "warning",
		),
	);
	assert.equal(
		lint('await page.waitForSelector("button");').filter((d) =>
			d.message.startsWith("test-fixed-wait:"),
		).length,
		0,
	);
});

test("production capability restrictions do not apply to colocated test execution", () => {
	const source = "import { Effect } from 'effect'; Effect.runPromise(task);";
	assert.equal(
		check(source, "apps/example/src/capabilities/search/policy.test.ts").length,
		0,
	);
	assert.equal(
		check(source, "apps/example/src/capabilities/search/test/controlled.ts")
			.length,
		0,
	);
});

test("capability entries allow imported contract names but reject private behavior", () => {
	const file = "apps/example/src/capabilities/search/index.ts";
	assert.equal(
		check(
			"import type { Search } from './contract.js'; export type { Search };",
			file,
		).length,
		0,
	);
	assert.ok(check("const hidden = () => 1; export { hidden };", file).length);
});
