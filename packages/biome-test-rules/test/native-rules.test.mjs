import assert from "node:assert/strict";
import { test } from "node:test";
import { lint } from "./lint.mjs";

test("native restricted properties cover the four configured TODO names and message", () => {
	for (const object of ["it", "test", "describe", "suite"]) {
		const diagnostics = lint(`${object}.todo('unfinished');`);
		assert.ok(
			diagnostics.some((d) => d.category.endsWith("noJsRestrictedProperties")),
			object,
		);
		assert.ok(
			JSON.stringify(diagnostics).includes(
				"Track unfinished tests in an issue rather than a passing placeholder.",
			),
		);
	}
	assert.deepEqual(lint("application.todo('request');"), []);
});

test("native rules own floating promises, focus, skip and self-comparison", () => {
	for (const [source, rule] of [
		["async function work() {} work();", "noFloatingPromises"],
		["it.only('case', () => {});", "noFocusedTests"],
		["it.skip('case', () => {});", "noSkippedTests"],
		["const value = 1; value === value;", "noSelfCompare"],
	])
		assert.ok(
			lint(source).some((d) => d.category.endsWith(rule)),
			rule,
		);
});
