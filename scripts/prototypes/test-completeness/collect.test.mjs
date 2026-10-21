import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scan, typeMembers, taskArguments } from "./collect.mjs";

test("regular expressions and Playwright helper APIs do not register tests", () => {
	assert.equal(
		scan("helper.ts", `export const valid = /^user_/.test('user_123');`)
			.hasTests,
		false,
	);
	assert.equal(
		scan(
			"helper.ts",
			`import { test } from '@playwright/test'; test.step('helper', () => {}); test.extend({});`,
		).hasTests,
		false,
	);
});

test("calibration measures static lint false positives and misses, including unsupported alias patterns", (t) => {
	const valid = [
		`// test.only('comment')`,
		`const text = 'test.skip';`,
		`const valid = /^user_/.test('user_123');`,
		`import { test } from '@playwright/test'; test.step('step', () => {});`,
		`import { test } from 'vitest'; test('works', () => {});`,
		`function helper(test) { test.only('unrelated local API'); }`,
	];
	const invalid = [
		`import { test } from 'vitest'; test.only('focus', () => {});`,
		`import { test as check } from 'vitest'; check.only('focus', () => {});`,
		`import * as v from 'vitest'; v.test.only('focus', () => {});`,
		`import { test } from 'vitest'; test.skip('skip', () => {});`,
		`import { test } from 'vitest'; test.todo('later');`,
		`import test from 'node:test'; test('focus', { only: true }, () => {});`,
		`import { test } from 'vitest'; test['skip']('skip', () => {});`,
		`import { test } from 'vitest'; const check = test; check.skip('skip', () => {});`,
		`import { test } from 'vitest'; const mode = 'skip'; test[mode]('skip', () => {});`,
	];
	const falsePositives = valid.filter(
		(source) => scan("control.ts", source).findings.length,
	).length;
	const missed = invalid.filter(
		(source) => !scan("control.ts", source).findings.length,
	).length;
	t.diagnostic(
		JSON.stringify({
			staticOnly: true,
			valid: valid.length,
			falsePositives,
			invalid: invalid.length,
			missed,
		}),
	);
	assert.equal(falsePositives, 1, "The prototype is not scope-aware");
	assert.equal(
		missed,
		2,
		"Dynamic aliases and computed properties need runtime receipts or a stronger lint rule",
	);
});

test("lint recognizes focus/disabled APIs, imported aliases and namespaces without matching comments or strings", () => {
	const result = scan(
		"example.test.ts",
		`
    import { test as check, describe } from 'vitest';
    import * as v from 'vitest';
    // test.only('comment')
    const text = 'test.skip';
    check.only('focus', () => {});
    describe.skip('disabled', () => {});
    v.it.todo('later');
    check.skipIf(process.env.CI)('conditional', () => {});
  `,
	);
	assert.equal(result.hasTests, true);
	assert.deepEqual(
		result.findings.map((f) => f.code),
		["focused", "disabled", "disabled"],
	);
	assert.equal(result.conditionals.length, 1);
});

test("type membership follows imports and build references, rejects noCheck projects", (t) => {
	const root = mkdtempSync(join(tmpdir(), "completeness-types-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "test"));
	writeFileSync(
		join(root, "tsconfig.json"),
		JSON.stringify({
			files: [],
			references: [{ path: "./tsconfig.test.json" }],
		}),
	);
	writeFileSync(
		join(root, "tsconfig.test.json"),
		JSON.stringify({
			compilerOptions: { noLib: true, types: [] },
			files: ["test/main.test.ts"],
		}),
	);
	writeFileSync(join(root, "test/main.test.ts"), `import './helper';`);
	writeFileSync(join(root, "test/helper.ts"), "export const value = 1;");
	writeFileSync(
		join(root, "test/excluded.test.ts"),
		"export const excluded = 1;",
	);
	assert.deepEqual(
		[...typeMembers(root, "tsconfig.json", true).keys()].sort(),
		["test/helper.ts", "test/main.test.ts"],
	);
	assert.equal(typeMembers(root, "tsconfig.json", false).size, 0);
	writeFileSync(
		join(root, "test/helper.ts"),
		"// @ts-nocheck\nexport const value = 1;",
	);
	assert.equal(
		typeMembers(root, "tsconfig.json", true).has("test/helper.ts"),
		false,
	);
	writeFileSync(
		join(root, "tsconfig.test.json"),
		JSON.stringify({ compilerOptions: { noCheck: true }, include: ["test"] }),
	);
	assert.equal(typeMembers(root, "tsconfig.json", true).size, 0);
});

test("CI discovery preserves project/file/config selectors and rejects unsupported runner commands", () => {
	assert.deepEqual(
		taskArguments(
			"vitest run --project=unit --coverage --coverage.reportsDirectory=coverage/unit test",
		),
		["--project=unit", "test"],
	);
	assert.deepEqual(
		taskArguments(
			"node --test test/check.test.mjs && vitest run --config vitest.browser.config.ts",
		),
		["--config", "vitest.browser.config.ts"],
	);
	assert.throws(() => taskArguments("custom-test-wrapper"), /Unsupported/);
});
