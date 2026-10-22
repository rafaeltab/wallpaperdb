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

test("awaited lifecycle promises from the real shared tester remain valid", () => {
	assert.deepEqual(
		lint(
			"import { createDefaultTesterBuilder } from '@wallpaperdb/test-utils'; const Tester = createDefaultTesterBuilder().build(); const tester = new Tester(); await tester.setup(); await tester.cleanup(); await tester.destroy();",
		),
		[],
	);
});
