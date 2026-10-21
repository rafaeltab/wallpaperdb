// PROTOTYPE #415. Each row is a ground-truth control, not production test policy.
// Runtime expectations deliberately include known misses. The runner checks every row.
export const controls = [
	{
		id: "direct",
		valid: true,
		body: "expect('Ada'.toUpperCase()).toBe('ADA');",
	},
	{ id: "helper", valid: true, body: "assertName('Ada');" },
	{
		id: "async-helper",
		valid: true,
		body: "await assertNameAsync(Promise.resolve('Ada'));",
	},
	{
		id: "effect-program",
		valid: true,
		body: "await Effect.runPromise(Effect.sync(() => assertName('Ada')));",
	},
	{
		id: "effect-vitest",
		valid: true,
		declaration: "effectIt.effect",
		body: "return Effect.gen(function* () { const name = yield* Effect.succeed('Ada'); expect(name).toBe('Ada'); });",
	},
	{
		id: "awaited-rejects",
		valid: true,
		body: "await expect(Promise.reject(new Error('denied'))).rejects.toThrow('denied');",
	},
	{
		id: "returned-rejects",
		valid: true,
		body: "return expect(Promise.reject(new Error('denied'))).rejects.toThrow('denied');",
	},
	{
		id: "awaited-poll",
		valid: true,
		body: "await expect.poll(() => 'Ada', { timeout: 100 }).toBe('Ada');",
	},
	{
		id: "concurrent-local",
		valid: true,
		declaration: "it.concurrent",
		args: "{ expect }",
		body: "await Promise.resolve(); assertName('Ada', expect);",
	},
	{
		id: "concurrent-local-peer",
		valid: true,
		declaration: "it.concurrent",
		args: "{ expect }",
		body: "await Promise.resolve(); expect('Grace'.length).toBe(5);",
	},
	{
		id: "concurrent-local-empty",
		valid: false,
		declaration: "it.concurrent",
		args: "{ expect }",
		enforced: "failed",
		body: "await Promise.resolve();",
	},
	{
		id: "narrowing",
		valid: true,
		body: "const result = outcome(); if (result._tag === 'Success') { expect(result.name).toBe('Ada'); } else { throw new Error('Expected success'); }",
	},
	{
		id: "failure-helper",
		valid: true,
		body: "const result = outcome(); if (result._tag !== 'Success') expect.unreachable('Expected success'); expect(result.name).toBe('Ada');",
	},
	{
		id: "nonempty-loop",
		valid: true,
		body: "const names = ['Ada', 'Grace']; expect(names).not.toHaveLength(0); for (const name of names) expect(name.length).toBeGreaterThan(0);",
	},
	{
		id: "guarded-nonempty-loop",
		valid: true,
		body: "const names = ['Ada']; expect(names).not.toHaveLength(0); if (names.length) { names.forEach(name => expect(name.length).toBeGreaterThan(0)); }",
	},
	{
		id: "rethrow-assertion",
		valid: true,
		body: "try { assertName('Ada'); expect('Ada'.length).toBe(3); } catch (error) { throw error; }",
	},
	{
		id: "custom-matcher",
		valid: true,
		body: "expect('Ada').toBePrototypeName();",
	},
	{
		id: "assertion-error-contract",
		valid: true,
		body: "expect(() => expect('Ada').toBe('Grace')).toThrow();",
	},
	{
		id: "node-assert",
		valid: true,
		enforced: "failed",
		body: "nodeAssert.equal('Ada'.length, 3);",
	},
	{
		id: "empty",
		valid: false,
		enforced: "failed",
		body: "const name = 'Ada';",
	},
	{
		id: "callback-never-runs",
		valid: false,
		enforced: "failed",
		body: "const register = (_callback: () => void) => {}; register(() => expect('Ada').toBe('Grace'));",
	},
	{
		id: "unawaited-rejects",
		valid: false,
		baseline: "failed",
		enforced: "failed",
		body: "expect(Promise.reject(new Error('denied'))).rejects.toThrow('denied');",
	},
	{
		id: "unawaited-poll",
		valid: false,
		baseline: "failed",
		enforced: "failed",
		body: "expect.poll(() => 'Ada', { timeout: 100 }).toBe('Ada');",
	},
	{
		id: "floating-imported-helper",
		valid: false,
		body: "assertNameAsync(new Promise<string>(() => {})); expect('Ada'.length).toBe(3);",
	},
	{
		id: "floating-then",
		valid: false,
		body: "new Promise<string>(() => {}).then(name => expect(name).toBe('Grace')); expect('Ada'.length).toBe(3);",
	},
	{
		id: "swallowed-sync",
		valid: false,
		body: "try { expect('Ada').toBe('Grace'); } catch {}",
	},
	{
		id: "swallowed-async",
		valid: false,
		body: "await expect(Promise.resolve('Ada')).resolves.toBe('Grace').catch(() => {});",
	},
	{
		id: "tautology-matcher",
		valid: false,
		body: "const name = 'Ada'; expect(name).toBe(name);",
	},
	{
		id: "tautology-operator",
		valid: false,
		body: "const name = 'Ada'; expect(name === name).toBe(true);",
	},
	{ id: "incomplete-expect", valid: false, body: "expect('Ada');" },
	{ id: "uncalled-matcher", valid: false, body: "expect('Ada').toBe;" },
	{
		id: "invalid-modifier",
		valid: false,
		baseline: "failed",
		enforced: "failed",
		body: "expect('Ada').never.toBe('Grace');",
	},
	{
		id: "conditional-skipped",
		valid: false,
		enforced: "failed",
		body: "const enabled = false; if (enabled) expect('Ada').toBe('Grace');",
	},
	{
		id: "empty-loop",
		valid: false,
		enforced: "failed",
		body: "const names: string[] = []; for (const name of names) expect(name).toBe('Grace');",
	},
	// These intentionally unsupported cases prevent presenting assertion counts as proof.
	{
		id: "swallowed-effect-exit",
		valid: false,
		body: "await Effect.runPromise(Effect.exit(Effect.sync(() => expect('Ada').toBe('Grace'))));",
	},
	{
		id: "wrong-claim",
		valid: false,
		body: "const actualName = 'Grace'; expect('Ada'.length).toBe(3);",
	},
	{
		id: "callback-skipped-with-other-assertion",
		valid: false,
		body: "const register = (_callback: () => void) => {}; register(() => expect('Ada').toBe('Grace')); expect('Ada'.length).toBe(3);",
	},
];

// Exact detection contracts, including known misses and false positives.
// Unlisted controls must have no static diagnostics.
export const expectedStatic = {
	biome: {
		"effect-vitest": ["lint/suspicious/noMisplacedAssertion"],
		"floating-then": ["lint/nursery/noFloatingPromises"],
		"tautology-operator": ["lint/suspicious/noSelfCompare"],
	},
	eslint: {
		narrowing: ["vitest/no-conditional-expect"],
		"failure-helper": ["vitest/no-conditional-expect"],
		"guarded-nonempty-loop": ["vitest/no-conditional-expect"],
		"unawaited-rejects": [
			"@typescript-eslint/no-floating-promises",
			"vitest/valid-expect",
		],
		"unawaited-poll": [
			"@typescript-eslint/no-floating-promises",
			"vitest/require-awaited-expect-poll",
		],
		"floating-imported-helper": ["@typescript-eslint/no-floating-promises"],
		"floating-then": [
			"@typescript-eslint/no-floating-promises",
			"vitest/valid-expect-in-promise",
		],
		"swallowed-sync": ["prototype/no-swallowed-assertion"],
		"swallowed-async": [
			"vitest/no-conditional-expect",
			"prototype/no-swallowed-assertion",
		],
		"tautology-matcher": ["prototype/no-obvious-tautology"],
		"incomplete-expect": ["vitest/valid-expect"],
		"uncalled-matcher": ["vitest/valid-expect"],
		"invalid-modifier": ["vitest/valid-expect"],
		"conditional-skipped": ["vitest/no-conditional-expect"],
	},
};

export const header = `import { expect, it } from 'vitest';
import { it as effectIt } from '@effect/vitest';
import { Effect } from 'effect';
import nodeAssert from 'node:assert/strict';
import { assertName, assertNameAsync, outcome } from '../../helpers.ts';\n`;

export function source(control) {
	return `${header}\n${control.declaration ?? "it"}(${JSON.stringify(control.id)}, ${control.declaration === "effectIt.effect" ? "" : "async "}(${control.args ?? ""}) => {\n${control.body}\n});\n`;
}
