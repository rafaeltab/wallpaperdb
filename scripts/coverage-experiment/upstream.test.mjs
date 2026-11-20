import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { record } from "./record.mjs";
const upstream =
	process.env.EXPERIMENT_UPSTREAM_ROOT ||
	"/tmp/wallpaperdb-742/resume/upstream";
const head = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim();
assert.equal(head, "48f88c789411ce6e96137b16ec348d06ae6c2f6e");
const results = [];
// Literal covered/total expectations from v1.0.6 test/branch-coverage.test.ts.
// Run the same JS-compatible fixture source through inspector and public convert.
// This adapts those branch regressions, not the full upstream multi-parser suite.
for (const [name, expected] of [
	[
		"if-statement",
		{ statements: [23, 30], functions: [4, 4], branches: [12, 22] },
	],
	[
		"conditional-expression",
		{ statements: [3, 3], functions: [1, 1], branches: [2, 4] },
	],
	[
		"logical-expression",
		{ statements: [9, 9], functions: [1, 1], branches: [8, 13] },
	],
]) {
	const code = await readFile(
		`${upstream}/test/fixtures/${name}/sources.ts`,
		"utf8",
	);
	const files = [];
	for (const variant of ["original-converter", "converter"]) {
		const evidence = await record(
			`upstream-${name}`,
			code,
			() => undefined,
			variant,
		);
		const data = Object.values(evidence.result)[0];
		const totals = (counts) => [
			counts.filter((n) => n > 0).length,
			counts.length,
		];
		const actual = {
			statements: totals(Object.values(data.s)),
			functions: totals(Object.values(data.f)),
			branches: totals(Object.values(data.b).flat()),
		};
		assert.deepEqual(actual, expected, `${name} ${variant}`);
		files.push({
			s: data.s,
			f: data.f,
			b: data.b,
			statementMap: data.statementMap,
			fnMap: data.fnMap,
			branchMap: data.branchMap,
		});
		results.push({
			name,
			variant,
			actual,
			sha256: createHash("sha256").update(code).digest("hex"),
		});
	}
	assert.deepEqual(
		files[0],
		files[1],
		`${name}: complete original/candidate counts and locations`,
	);
}
// Adapt the retained upstream simple-yield reference, with its literal counters.
const yieldReference = await readFile(
	`${upstream}/test/istanbul-references/yield.yaml`,
	"utf8",
);
const yieldCode =
	yieldReference
		.split("code: |\n")[1]
		.split("\ntests:")[0]
		.split("\n")
		.map((line) => line.slice(2))
		.join("\n") + "\n";
for (const variant of ["original-converter", "converter"]) {
	globalThis.output = undefined;
	try {
		const evidence = await record(
			"upstream-simple-yield",
			yieldCode,
			() => globalThis.output,
			variant,
		);
		const data = Object.values(evidence.result)[0];
		assert.equal(evidence.output, 3);
		assert.deepEqual(data.s, {
			0: 1,
			1: 1,
			2: 0,
			3: 1,
			4: 1,
			5: 1,
			6: 1,
			7: 2,
			8: 1,
		});
		assert.deepEqual(data.f, { 0: 1 });
		results.push({
			name: "simple-yield",
			variant,
			statements: data.s,
			functions: data.f,
		});
	} finally {
		delete globalThis.output;
	}
}
await writeFile(
	"/tmp/wallpaperdb-742/resume/upstream-results.json",
	JSON.stringify({ head, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
