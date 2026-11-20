// Selected-change acceptance. Known stock defects stay visible in diagnostics;
// this does not replace or relax the repository's normal coverage validator.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const checks = [];
for (const [script, args] of [
	["converter", ""],
	["yield-join", ""],
	["clean-env", ""],
	["native-guard", ""],
	["auto-provenance", ""],
	["recorded-layouts", "else"],
	["recorded-layouts", "saturated"],
	["recorded-layouts", "abrupt"],
	["recorded-ambiguity", ""],
	["production-shape", ""],
	["differential", ""],
	["upstream", ""],
	["upstream-reference", ""],
	["verify", "--accept-inherited"],
	["report-validation", ""],
]) {
	const argv = [
		"run",
		"PACKAGE=root",
		`SCRIPT=experiment:coverage:${script}`,
		...(args ? [`ARGS=${args}`] : []),
	];
	const result = spawnSync("make", argv, { stdio: "inherit" });
	assert.equal(result.status, 0, script + " acceptance failed");
	checks.push({ name: script, passed: true });
}
const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const stock = await load(
	"/tmp/wallpaperdb-742/adoption/baseline-integration-report/coverage-final.json",
);
const candidate = await load(
	".coverage-experiment/reports/native-integration/coverage-final.json",
);
for (const file of Object.keys(stock))
	assert.ok(candidate[file], `missing baseline source ${file}`);
for (const suffix of [
	"/adapters/profiles/index.ts",
	"/adapters/profiles/clerk.ts",
	"/adapters/picture-attachments/transaction.ts",
]) {
	const [file, c] =
		Object.entries(candidate).find(([file]) => file.endsWith(suffix)) ?? [];
	assert.ok(c, suffix);
	assert.ok(
		Object.values(c.s).some((n) => n > 0),
		"executed historical source missing hits " + file,
	);
	assert.ok(
		Object.values(c.f).some((n) => n > 0),
		"historical functions missing hits " + file,
	);
}
for (const [file, coverage] of Object.entries(candidate)) {
	for (const n of [...Object.values(coverage.s), ...Object.values(coverage.f)])
		assert.ok(
			Number.isSafeInteger(n) && n >= 0,
			"invalid statement/function counter " + file,
		);
	for (const counts of Object.values(coverage.b))
		for (const n of counts)
			assert.ok(Number.isSafeInteger(n), "invalid branch counter " + file);
	for (const entry of [
		...Object.values(coverage.statementMap),
		...Object.values(coverage.fnMap).flatMap((f) => [f.loc, f.decl]),
		...Object.values(coverage.branchMap).flatMap((b) => [
			b.loc,
			...b.locations,
		]),
	]) {
		if (!entry?.start || !entry?.end || entry.start.line === undefined)
			continue;
		assert.ok(
			entry.start.line >= 1 && entry.start.column >= 0,
			"invalid start position " + file,
		);
		assert.ok(
			entry.end.line >= 1 &&
				(entry.end.column === null || entry.end.column >= 0),
			"invalid end position " + file,
		);
	}
}
const inherited = [];
for (const [file, c] of Object.entries(candidate))
	for (const [id, counts] of Object.entries(c.b))
		if (counts.some((n) => n < 0)) {
			const branch = c.branchMap[id];
			const previous = Object.entries(stock[file]?.branchMap ?? {}).find(
				([, b]) =>
					b.type === branch.type &&
					b.loc.start.line === branch.loc.start.line &&
					b.loc.start.column === branch.loc.start.column,
			);
			assert.ok(previous, "new negative branch " + file);
			assert.deepEqual(
				counts,
				stock[file].b[previous[0]],
				"negative changed from baseline",
			);
			inherited.push({
				file,
				line: branch.loc.start.line,
				counts,
				classification: "unresolved negative requiring stage attribution",
			});
		}
assert.equal(
	inherited.length,
	0,
	"Complete User report must have no unresolved negative counters",
);
const summary = {
	checks,
	sourceInventory: {
		stock: Object.keys(stock).length,
		candidate: Object.keys(candidate).length,
		missing: [],
	},
	inherited,
	normalIntegrationCountersValid: inherited.length === 0,
	scope:
		"User-only selected changes; normal validator unchanged; no mutation guarantee",
};
await writeFile(
	"/tmp/wallpaperdb-742/adoption/acceptance.json",
	JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
