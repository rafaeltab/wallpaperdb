import { expect, test } from "vitest";
import { lint } from "./lint.ts";

test("Biome rejects unhandled directly imported helper promises", () => {
	const files = {
		"helper.ts":
			"export function load(): Promise<string> { return Promise.resolve('done'); }",
	};
	expect(
		lint("import { load } from './helper'; load();", files).some((d) =>
			d.category.endsWith("noFloatingPromises"),
		),
	).toBeTruthy();
	expect(
		lint("import { load } from './helper'; await load();", files),
	).toStrictEqual([]);
	expect(
		lint("import { load } from './helper'; load().catch(() => {});", files),
	).toStrictEqual([]);
});
