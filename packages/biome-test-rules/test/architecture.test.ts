import { expect } from "vitest";
import { test } from "vitest";
import { lint } from "./lint.ts";
const check = (
	source: string,
	file = "apps/example/src/capabilities/search/implementation.ts",
) => lint(source, {}, file).filter((d) => d.message.startsWith("capability-"));
test("capabilities reject runtime execution and global configuration without rejecting shadowed names", () => {
	for (const source of [
		"import { Effect as E } from 'effect'; E.runPromise(task);",
		"import { runPromise as execute } from 'effect/Effect'; execute(task);",
		"process.env.TOKEN;",
		"const { env } = process;",
	])
		expect(check(source).length, source).toBeTruthy();
	for (const source of [
		"import { Effect } from 'effect'; Effect.map(task, f);",
		"function local(process) { return process.env; }",
		"const E = { runPromise() {} }; E.runPromise();",
	])
		expect(check(source).length, source).toBe(0);
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
		expect(
			check(source).some((d) => d.message.startsWith("capability-execution:")),
			source,
		).toBeTruthy();
	for (const source of [
		"import * as E from 'effect'; E.Effect.succeed(1); E.Option.make;",
		"import * as E from 'effect'; function local(E) { E.Effect.runSync(task); }",
		"import { Effect } from 'effect'; const runSync = 'succeed'; Effect[runSync](1);",
	])
		expect(check(source).length, source).toBe(0);
});
test("capability entries contain explicit reexports and contracts remain in contract.ts", () => {
	const file = "apps/example/src/capabilities/search/index.ts";
	expect(
		check("export type * from './contract.js';", file).length,
	).toBeTruthy();
	expect(
		check("export interface Search { query(): string }", file).length,
	).toBeTruthy();
	expect(
		check(
			"export type { Search } from './contract.js'; export { live } from './implementation.js';",
			file,
		).length,
	).toBe(0);
	expect(
		check(
			"export interface Search { query(): string }",
			file.replace("index.ts", "contract.ts"),
		).length,
	).toBe(0);
});
test("capabilities reject qualified global configuration while preserving local objects", () => {
	for (const root of ["globalThis", "global"]) {
		for (const access of [".process.env.TOKEN", '["process"].env.TOKEN'])
			expect(
				check(`${root}${access};`).some((d) =>
					d.message.startsWith("capability-configuration:"),
				),
			).toBeTruthy();
		expect(
			check(`function local(${root}) { return ${root}.process.env.TOKEN; }`)
				.length,
		).toBe(0);
		expect(check(`${root}.Math.random();`).length).toBe(0);
	}
});

test("undeclared imports fail while declared dependencies and builtins pass", () => {
	const files = {
		"package.json": JSON.stringify({ dependencies: { declared: "1.0.0" } }),
	};
	expect(
		lint("import 'undeclared';", files).some(
			(d) => d.category === "lint/correctness/noUndeclaredDependencies",
		),
	).toBeTruthy();
	expect(
		lint("import 'declared'; import 'node:fs';", files).filter(
			(d) => d.category === "lint/correctness/noUndeclaredDependencies",
		).length,
	).toBe(0);
});

test("fixed-wait diagnostics are advisory and do not flag unrelated application methods", () => {
	expect(
		lint("await page.waitForTimeout(100);").some(
			(d) =>
				d.message.startsWith("test-fixed-wait:") && d.severity === "warning",
		),
	).toBeTruthy();
	expect(
		lint('await page.waitForSelector("button");').filter((d) =>
			d.message.startsWith("test-fixed-wait:"),
		).length,
	).toBe(0);
});

test("production capability restrictions do not apply to colocated test execution", () => {
	const source = "import { Effect } from 'effect'; Effect.runPromise(task);";
	expect(
		check(source, "apps/example/src/capabilities/search/policy.test.ts").length,
	).toBe(0);
	expect(
		check(source, "apps/example/src/capabilities/search/test/controlled.ts")
			.length,
	).toBe(0);
});

test("capability entries allow imported contract names but reject private behavior", () => {
	const file = "apps/example/src/capabilities/search/index.ts";
	expect(
		check(
			"import type { Search } from './contract.js'; export type { Search };",
			file,
		).length,
	).toBe(0);
	expect(
		check("const hidden = () => 1; export { hidden };", file).length,
	).toBeTruthy();
});
