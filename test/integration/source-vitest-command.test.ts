import { expect, test } from "vitest";
import { parseSourceVitestCommand } from "./helpers/source-vitest-command.js";

test.each(["vitest run", "wallpaperdb-test"])(
	"%s retains configuration, coverage, and original test filters for policy inspection",
	(frontend) => {
		const parsed = parseSourceVitestCommand(
			`${frontend} --config vitest.unit.config.ts --coverage test/new-capability/behavior.unit.test.ts`,
		);
		expect(parsed.options.config).toBe("vitest.unit.config.ts");
		expect(parsed.options.coverage).toEqual({ enabled: true });
		expect(parsed.filter).toEqual([
			"test/new-capability/behavior.unit.test.ts",
		]);
	},
);

test("the bare prebuilt frontend retains full-suite configuration discovery", () => {
	const parsed = parseSourceVitestCommand("wallpaperdb-test");
	expect(parsed.options.config).toBeUndefined();
	expect(parsed.options.coverage).toBeUndefined();
	expect(parsed.filter).toEqual([]);
});

test("similarly named commands are not treated as the supported prebuilt frontend", () => {
	expect(() =>
		parseSourceVitestCommand("wallpaperdb-test-other --coverage"),
	).toThrow('Expected "vitest" as the first argument');
});
