import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { lint } from "./lint.mjs";

const fixtures = JSON.parse(
	readFileSync(new URL("./upstream-fixtures.json", import.meta.url), "utf8"),
);
test("pinned valid-expect rejects its default async matcher without awaiting", () => {
	const diagnostics = lint(
		'test("valid-expect", () => { expect(Promise.resolve(2)).toResolve(); });',
	);
	expect(
		diagnostics.some((d) => d.message.startsWith("valid-expect:")),
		JSON.stringify(diagnostics),
	).toBeTruthy();
});

for (const [rule, group] of Object.entries(fixtures))
	test(`configured upstream ${rule} fixtures`, () => {
		const failures = [];
		for (const fixture of group.cases) {
			const diagnostics = lint(fixture.source).filter((d) =>
				d.message.startsWith(`${rule}:`),
			);
			if (diagnostics.length !== (fixture.valid ? 0 : fixture.messages.length))
				failures.push({ ...fixture, diagnostics });
		}
		expect(failures).toStrictEqual([]);
	});
