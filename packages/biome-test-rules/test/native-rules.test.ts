import { expect, test } from "vitest";
import { lint } from "./lint.ts";

test("native restricted properties cover the four configured TODO names and message", () => {
	for (const object of ["it", "test", "describe", "suite"]) {
		const diagnostics = lint(`${object}.todo('unfinished');`);
		expect(
			diagnostics.some((d) => d.category.endsWith("noJsRestrictedProperties")),
			object,
		).toBeTruthy();
		expect(
			lint(`${object}.todo('unfinished');`, {}, "example.test.ts", "terminal"),
		).toMatch(
			/Track unfinished tests in an issue rather than a passing placeholder\./,
		);
	}
	expect(lint("application.todo('request');")).toStrictEqual([]);
});

test("native rules own floating promises, focus, skip and self-comparison", () => {
	for (const [source, rule] of [
		["async function work() {} work();", "noFloatingPromises"],
		["it.only('case', () => {});", "noFocusedTests"],
		["it.skip('case', () => {});", "noSkippedTests"],
		["const value = 1; value === value;", "noSelfCompare"],
	])
		expect(
			lint(source).some((d) => d.category.endsWith(rule)),
			rule,
		).toBeTruthy();
});
