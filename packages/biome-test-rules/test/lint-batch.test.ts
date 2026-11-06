import { expect, test } from "vitest";
import { lint } from "./lint.ts";

test("reports every isolated lint input beyond the default diagnostic limit", () => {
	const diagnostics = lint([
		'test("valid", () => { expect(1).toBe(1); });',
		...Array.from(
			{ length: 24 },
			(_, index) => `test("missing-${index}", () => { expect(1); });`,
		),
	]);
	expect(diagnostics).toHaveLength(25);
	expect(diagnostics[0]).toStrictEqual([]);
	for (const result of diagnostics.slice(1))
		expect(
			result.filter((d) => d.message.startsWith("valid-expect:")),
		).toHaveLength(1);
});
