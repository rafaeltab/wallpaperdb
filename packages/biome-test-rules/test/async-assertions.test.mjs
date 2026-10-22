import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Vitest async assertions and poll require handling through imported and local aliases", () => {
	for (const expression of [
		"expect(Promise.resolve(1)).resolves.toBe(1)",
		"expect(Promise.reject(1)).rejects.toBe(1)",
		"expect.poll(() => 1).toBe(1)",
		"expect.soft(Promise.resolve(1)).resolves.not.toBe(2)",
	]) {
		const prelude = "import { expect } from 'vitest'; ";
		assert.ok(
			lint(`${prelude}${expression};`).some((d) =>
				d.message.includes("async assertion"),
			),
			expression,
		);
		for (const handled of [
			`await ${expression};`,
			`function check() { return ${expression}; }`,
			`const check = () => (${expression}); await check();`,
			`${expression}.catch(() => {});`,
			`${expression}.then(() => {}, () => {});`,
			`const pending = ${expression}; await pending;`,
			`await Promise.all([${expression}]);`,
		])
			assert.deepEqual(lint(prelude + handled), [], handled);
	}
	assert.ok(
		lint(
			"import { expect as check } from 'vitest'; check.poll(() => 1).toBe(1);",
		).length > 0,
	);
	assert.ok(
		lint(
			"import * as v from 'vitest'; const check = v.expect; check(Promise.resolve(1)).resolves.toBe(1);",
		).length > 0,
	);
	assert.ok(
		lint(
			"import { it } from 'vitest'; it.concurrent.for([1])('case', (value, { expect: check }) => { check.poll(() => value).toBe(1); });",
		).some((d) => d.message.includes("async assertion")),
	);
	assert.deepEqual(
		lint(
			"import { it } from 'vitest'; it.for([1])('case', async (value, { expect }) => { await expect.poll(() => value).toBe(1); });",
		),
		[],
	);
});

test("concise assertion callbacks require a consumer that handles their result", () => {
	const assertion = "expect(Promise.resolve(1)).resolves.toBe(1)";
	const prelude = "import { expect, it } from 'vitest'; const values = [1]; ";
	for (const expression of [
		`values.forEach(() => ${assertion});`,
		`values.map(() => ${assertion});`,
		`await values.map(() => ${assertion});`,
		`const check = () => ${assertion}; check();`,
	])
		assert.ok(
			lint(prelude + expression).some((d) =>
				d.message.includes("async assertion"),
			),
			expression,
		);
	for (const expression of [
		`it('checks', () => ${assertion});`,
		`await Promise.all(values.map(() => ${assertion}));`,
		`await Promise.resolve().then(() => ${assertion});`,
		`const check = () => ${assertion}; await check();`,
		`const check = () => ${assertion}; it('checks', check);`,
		`await (() => ${assertion})();`,
	])
		assert.deepEqual(lint(prelude + expression), [], expression);
});

test("each invocation of a concise assertion helper needs its own consumer", () => {
	const prelude =
		"import { expect } from 'vitest'; const values = [1]; const check = () => expect(Promise.resolve(1)).resolves.toBe(1); ";
	for (const expression of [
		"values.forEach(check); await Promise.all(values.map(check));",
		"check(); await check();",
	])
		assert.ok(
			lint(prelude + expression).some((d) =>
				d.message.includes("async assertion"),
			),
			expression,
		);
	for (const expression of [
		"await check(); await check();",
		"const name = check.name; const type = typeof check; await check();",
		"const alias = check; await alias(); await check();",
	])
		assert.deepEqual(lint(prelude + expression), [], expression);
});

test("Vitest awaits concise lifecycle callbacks through import aliases", () => {
	for (const hook of ["beforeEach", "beforeAll", "afterEach", "afterAll"]) {
		for (const imports of [
			`import { expect, ${hook} as lifecycle } from 'vitest';`,
			`import { expect } from 'vitest'; import * as v from 'vitest'; const lifecycle = v.${hook};`,
		])
			assert.deepEqual(
				lint(
					`${imports} lifecycle(() => expect(Promise.resolve(1)).resolves.toBe(1));`,
				),
				[],
				hook,
			);
	}
	for (const source of [
		"import { expect, beforeEach } from 'vitest'; function run(beforeEach) { beforeEach(() => expect(Promise.resolve(1)).resolves.toBe(1)); }",
		"import { expect } from 'vitest'; import { beforeEach } from 'other-library'; beforeEach(() => expect(Promise.resolve(1)).resolves.toBe(1));",
	])
		assert.ok(
			lint(source).some((d) => d.message.includes("async assertion")),
			source,
		);
});

test("known Effect and Vitest polling consumers await callback promises", () => {
	for (const source of [
		"import { expect } from 'vitest'; import { Effect } from 'effect'; Effect.promise(() => expect(Promise.resolve(1)).resolves.toBe(1));",
		"import { expect } from 'vitest'; import { promise as consume } from 'effect/Effect'; consume(() => expect(Promise.resolve(1)).resolves.toBe(1));",
		"import { expect } from 'vitest'; import { Effect } from 'effect'; await expect.poll(() => Effect.runPromise(Effect.succeed(1))).toBe(1);",
	])
		assert.deepEqual(lint(source), [], source);
	for (const source of [
		"import { expect } from 'vitest'; const Effect = { promise(callback) {} }; Effect.promise(() => expect(Promise.resolve(1)).resolves.toBe(1));",
		"import { expect } from 'vitest'; import { Effect } from 'effect'; function run(Effect) { Effect.promise(() => expect(Promise.resolve(1)).resolves.toBe(1)); }",
		"import { expect } from 'vitest'; import { Effect } from 'effect'; expect.poll(() => Effect.runPromise(Effect.succeed(1))).toBe(1);",
	])
		assert.ok(
			lint(source).some((d) => d.severity === "error"),
			source,
		);
});

test("unknown custom consumers require explicit local assertion handling", () => {
	const prelude =
		"import { expect } from 'vitest'; async function custom(check) { await check(); } ";
	assert.ok(
		lint(
			`${prelude} await custom(() => expect(Promise.resolve(1)).resolves.toBe(1));`,
		).some((d) => d.message.includes("async assertion")),
	);
	for (const callback of [
		"async () => { await expect(Promise.resolve(1)).resolves.toBe(1); }",
		"() => { return expect(Promise.resolve(1)).resolves.toBe(1); }",
	])
		assert.deepEqual(
			lint(`${prelude} await custom(${callback});`),
			[],
			callback,
		);
});

test("ordinary object helper arrows return promises like explicit block returns", () => {
	for (const expression of [
		"Effect.runPromise(Effect.succeed(1))",
		"expect(Promise.resolve(1)).resolves.toBe(1)",
	]) {
		const prelude =
			"import { Effect } from 'effect'; import { expect } from 'vitest'; ";
		for (const body of [expression, `{ return ${expression}; }`])
			assert.deepEqual(
				lint(
					`${prelude} const helpers = { run: () => ${body} }; await helpers.run();`,
				),
				[],
				body,
			);
		assert.ok(
			lint(`${prelude} [1].forEach(() => ${expression});`).some(
				(d) => d.severity === "error",
			),
			expression,
		);
	}
});

test("awaited conditional branches handle assertions", () => {
	assert.deepEqual(
		lint(
			"import { expect } from 'vitest'; const flag = true; await (flag ? expect(Promise.resolve(1)).resolves.toBe(1) : expect(Promise.resolve(2)).resolves.toBe(2));",
		),
		[],
	);
});

test("logical result operands inherit await or return handling", () => {
	const prelude = "import { expect } from 'vitest'; const enabled = true; ";
	for (const operator of ["&&", "||", "??"]) {
		const expression = `(enabled ${operator} expect(Promise.resolve(1)).resolves.toBe(1))`;
		assert.deepEqual(lint(`${prelude} await ${expression};`), [], operator);
		assert.deepEqual(
			lint(`${prelude} function check() { return ${expression}; }`),
			[],
			operator,
		);
		assert.ok(
			lint(`${prelude} ${expression};`).some((d) =>
				d.message.includes("async assertion"),
			),
			operator,
		);
	}
	assert.ok(
		lint(
			`${prelude} await (expect(Promise.resolve(1)).resolves.toBe(1) && enabled);`,
		).some((d) => d.message.includes("async assertion")),
	);
	for (const operator of ["||", "??"])
		assert.deepEqual(
			lint(
				`${prelude} await (expect(Promise.resolve(1)).resolves.toBe(1) ${operator} enabled);`,
			),
			[],
			operator,
		);
});

test("nested Promise.all arrays do not handle assertions", () => {
	assert.ok(
		lint(
			"import { expect } from 'vitest'; await Promise.all([[expect(Promise.resolve(1)).resolves.toBe(1)]]);",
		).some((d) => d.message.includes("async assertion")),
	);
});

test("an unhandled then or finally does not handle async assertions", () => {
	for (const suffix of [
		".then(() => {})",
		".finally(() => {})",
		".then(() => {}).finally(() => {})",
		".catch(undefined)",
		".catch(null)",
		".then(undefined, undefined)",
		".then(() => {}, null)",
	])
		assert.ok(
			lint(
				`import { expect } from 'vitest'; expect.poll(() => 1).toBe(1)${suffix};`,
			).length > 0,
			suffix,
		);
	assert.deepEqual(
		lint("import { expect } from 'vitest'; expect(1).toBe(1);"),
		[],
	);
});

test("rejection handlers may be imported functions and local aliases", () => {
	for (const [declaration, valid] of [
		["import { handler } from './handlers';", true],
		["const handler = () => {};", true],
		["const handler = null;", false],
		["const handler = undefined;", false],
	]) {
		const source = `import { expect } from 'vitest'; ${declaration} expect.poll(() => 1).toBe(1).catch(handler);`;
		const diagnostics = lint(source, {
			"handlers.ts":
				"export function handler(error: unknown) { console.log(error); }",
		});
		assert.equal(
			diagnostics.some((d) => d.message.includes("async assertion")),
			!valid,
			source,
		);
	}
	assert.deepEqual(
		lint(
			"import { expect } from 'vitest'; await expect.poll(() => 1).toBe(1).catch(undefined);",
		),
		[],
	);
});

test("handled reads must consume the original mutable assertion promise", () => {
	const promise = "expect(Promise.resolve(1)).resolves.toBe(1)";
	const prelude = "import { expect } from 'vitest'; ";
	for (const source of [
		`let pending = ${promise}; pending = Promise.resolve(); await pending;`,
		`let pending; await pending; pending = ${promise};`,
		`let pending = ${promise}; pending = ${promise}; await pending;`,
		`let pending; if (condition) pending = ${promise}; await pending;`,
	])
		assert.ok(
			lint(prelude + source).some((d) => d.message.includes("async assertion")),
			source,
		);
	for (const source of [
		`let pending = ${promise}; await pending; pending = Promise.resolve();`,
		`let pending; pending = ${promise}; await pending;`,
		`const pending = ${promise}; const alias = pending; await alias;`,
	])
		assert.deepEqual(lint(prelude + source), [], source);
});
