import { expect, test } from "vitest";
import { lint } from "./lint.mjs";

const diagnostics = (source, rule) =>
	lint(source).filter((d) => d.message.startsWith(`${rule}:`));

test("the pinned parser recognizes destructured dynamic and require imports", () => {
	for (const module of ["await import('vitest')", "require('vitest')"])
		expect(
			diagnostics(
				`const { expect: check } = ${module}; check(1);`,
				"valid-expect",
			).length,
			module,
		).toBe(1);
	expect(
		diagnostics(
			"const { expect: check } = require('application'); check(1);",
			"valid-expect",
		),
	).toStrictEqual([]);
});

test("an unrelated nested function parameter is not a test callback context", () => {
	expect(
		diagnostics(
			"test('case', () => { const helper = (expect) => { expect(1); }; helper(() => {}); });",
			"valid-expect",
		),
	).toStrictEqual([]);
	expect(
		diagnostics("test('case', (expect) => { expect(1); });", "valid-expect")
			.length,
	).toBe(1);
});

test("static template import sources retain the pinned raw module value", () => {
	for (const loader of ["require", "await import"]) {
		const declaration = `const { expect: check } = ${loader}(\`vitest\`);`;
		expect(
			diagnostics(`${declaration} check(1);`, "valid-expect").length,
			loader,
		).toBe(1);
		expect(
			diagnostics(`${declaration} check(1).toBe(1);`, "valid-expect"),
		).toStrictEqual([]);
		for (const source of ["`application`", "`vi${name}`", "`vi\\u0074est`"])
			expect(
				diagnostics(
					`const { expect: check } = ${loader}(${source}); check(1);`,
					"valid-expect",
				),
				source,
			).toStrictEqual([]);
	}
});

test("static template destructuring keys retain upstream imported names", () => {
	for (const loader of ["require('vitest')", "await import('vitest')"])
		expect(
			diagnostics(
				`const { [\`expect\`]: check } = ${loader}; check(1);`,
				"valid-expect",
			).length,
			loader,
		).toBe(1);
	for (const key of ["`application`", "`ex${name}`", "`ex\\u0070ect`"])
		expect(
			diagnostics(
				`const { [${key}]: check } = await import('vitest'); check(1);`,
				"valid-expect",
			),
			key,
		).toStrictEqual([]);
	expect(
		diagnostics(
			"const { [`expect`]: check } = await import('application'); check(1);",
			"valid-expect",
		),
	).toStrictEqual([]);
});

test("escaped require identifiers retain the pinned loader identity", () => {
	for (const loader of [String.raw`requ\u0069re`, String.raw`requ\u{69}re`]) {
		expect(
			diagnostics(
				`const { expect: check } = ${loader}('vitest'); check(1);`,
				"valid-expect",
			).length,
		).toBe(1);
		for (const source of [
			`const { expect: check } = ${loader}('vitest'); check(1).toBe(1);`,
			`const { expect: check } = ${loader}('application'); check(1);`,
		])
			expect(diagnostics(source, "valid-expect"), source).toStrictEqual([]);
	}
});
