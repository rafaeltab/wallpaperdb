import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
for (const expected of [0, 1]) {
	const result = spawnSync(
		"make",
		["run", "PACKAGE=root", "SCRIPT=experiment:coverage:user", "ARGS=app-mock"],
		{
			encoding: "utf8",
			env: { ...process.env, EXPERIMENT_MOCK_ORIGINAL: String(expected) },
		},
	);
	const diagnostics = result.stdout + result.stderr;
	assert.equal(result.status, 0, diagnostics);
	{
		const report = JSON.parse(
			await readFile(
				".coverage-experiment/reports/native-mock/coverage-final.json",
				"utf8",
			),
		);
		const [, file] =
			Object.entries(report).find(([name]) =>
				name.endsWith("/fixtures/mock-target.ts"),
			) ?? [];
		assert.ok(file, "original source missing");
		await writeFile(
			`/tmp/wallpaperdb-742/hillclimb/A-${expected}-report.json`,
			JSON.stringify(report),
		);
		console.log(
			`Original statement/function expected ${expected}:`,
			file.s,
			file.f,
		);
		assert.ok(
			Object.entries(report).some(
				([name, c]) =>
					name.includes("/native-sources-") &&
					Object.values(c.s).some((n) => n > 0),
			),
			"generated proxy measurements missing",
		);
		assert.deepEqual(
			Object.values(file.s),
			[expected],
			"mock must not mark original application body covered",
		);
		assert.deepEqual(
			Object.values(file.f),
			[expected],
			"original function was not called",
		);
	}
}
