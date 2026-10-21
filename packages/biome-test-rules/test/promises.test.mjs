import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("Biome rejects unhandled directly imported helper promises", () => {
	const files = {
		"helper.ts":
			"export function load(): Promise<string> { return Promise.resolve('done'); }",
	};
	assert.ok(
		lint("import { load } from './helper'; load();", files).some((d) =>
			d.category.endsWith("noFloatingPromises"),
		),
	);
	assert.deepEqual(
		lint("import { load } from './helper'; await load();", files),
		[],
	);
	assert.deepEqual(
		lint("import { load } from './helper'; load().catch(() => {});", files),
		[],
	);
});

test("Biome's Playwright rule checks the real imported assertion types in specs", () => {
	const source =
		"import { expect, test } from '@playwright/test'; test('page', async ({ page }) => { expect(page.getByRole('button')).toBeVisible(); });";
	const filename = "specs/example.spec.ts";
	assert.ok(
		lint(source, {}, filename).some((d) =>
			d.category.endsWith("noPlaywrightMissingAwait"),
		),
	);
	assert.deepEqual(
		lint(source.replace("expect(page", "await expect(page"), {}, filename),
		[],
	);
});
