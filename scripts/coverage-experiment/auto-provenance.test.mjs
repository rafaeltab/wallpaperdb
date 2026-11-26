import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
const kinds = process.argv[2] ? [process.argv[2]] : ["automock", "autospy"];
for (const kind of kinds)
	for (const actual of [0, 1]) {
		const run = spawnSync(
			"make",
			[
				"run",
				"PACKAGE=root",
				"SCRIPT=experiment:coverage:user",
				"ARGS=app-mock",
			],
			{
				encoding: "utf8",
				env: {
					...process.env,
					EXPERIMENT_MOCK_KIND: kind,
					EXPERIMENT_MOCK_ORIGINAL: String(actual),
				},
			},
		);
		await writeFile(
			`/tmp/wallpaperdb-742/followup/${kind}-${actual}.log`,
			run.stdout + run.stderr,
		);
		assert.equal(run.status, 0, run.stdout + run.stderr);
		const report = JSON.parse(
			await readFile(
				".coverage-experiment/reports/native-mock/coverage-final.json",
				"utf8",
			),
		);
		await writeFile(
			`/tmp/wallpaperdb-742/followup/${kind}-${actual}-report.json`,
			JSON.stringify(report),
		);
		const c = Object.entries(report).find(([f]) =>
			f.endsWith("/fixtures/auto-target.ts"),
		)?.[1];
		assert.ok(c, "original source missing");
		assert.deepEqual(
			Object.values(c.statementMap).map((loc) => [
				loc.start.line,
				loc.start.column,
				loc.end.line,
				loc.end.column,
			]),
			[
				[2, 1, 2, 17],
				[5, 1, 5, 15],
			],
			"original TS return locations",
		);
		assert.deepEqual(
			Object.values(c.fnMap).map((fn) => [
				fn.name,
				fn.decl.start.line,
				fn.decl.start.column,
				fn.decl.end.column,
				fn.loc.end.line,
				fn.loc.end.column,
			]),
			[
				["executed", 1, 16, 24, 3, 1],
				["uncalled", 4, 16, 24, 6, 1],
			],
			"original function identity and finite end spans",
		);

		assert.ok(
			Object.entries(report).some(
				([f, v]) =>
					f.includes("/native-sources-") &&
					Object.values(v.s).some((n) => n > 0),
			),
			"generated plumbing measurements missing",
		);
		const executed = actual + (kind === "autospy" ? 1 : 0);
		assert.deepEqual(
			Object.values(c.s),
			[executed, 0],
			kind + " original statements",
		);
		assert.deepEqual(
			Object.values(c.f),
			[executed, 0],
			kind + " original functions",
		);
		console.log(kind, { actual, statements: c.s, functions: c.f });
	}
