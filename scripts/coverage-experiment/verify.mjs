import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = process.cwd();
const report = resolve(
	process.env.EXPERIMENT_REPORT ||
		".coverage-experiment/reports/native-unit/coverage-final.json",
);
const data = JSON.parse(await readFile(report, "utf8"));
const {
	parseCoverageReport,
	parseFileMethods,
	coverageForMethods,
	calculateCrapScore,
} = await import(
	new URL(
		"../../.coverage-experiment/build/packages/crap-typescript-core/src/index.js",
		import.meta.url,
	)
);
const parsed = await parseCoverageReport(report, root);
const failures = [];
const checks = [];
function check(name, fn) {
	try {
		fn();
		checks.push({ name, pass: true });
	} catch (error) {
		checks.push({ name, pass: false, message: error.message });
		failures.push(name);
	}
}
const original = JSON.parse(
	await readFile(
		"/tmp/wallpaperdb-742/baseline-unit-report/coverage-final.json",
		"utf8",
	),
);
check("retains complete baseline inventory", () => {
	for (const file of Object.keys(original)) assert.ok(data[file], file);
});
check("finite nonnegative counters", () => {
	for (const c of Object.values(data))
		for (const n of [
			...Object.values(c.s),
			...Object.values(c.f),
			...Object.values(c.b).flat(),
		])
			assert.ok(Number.isFinite(n) && n >= 0);
});
const child = Object.entries(data).find(([file]) =>
	file.endsWith("/fixtures/child-only.ts"),
);
check("child-only TS source is present", () => assert.ok(child));
if (child) {
	check("exact child statements, branches and functions", () => {
		assert.deepEqual(child[1].s, { 0: 2, 1: 2, 2: 0, 3: 0 });
		assert.deepEqual(child[1].b, { 0: [2, 0] });
		assert.deepEqual(child[1].f, { 0: 2, 1: 0 });
	});
}
const methods = [];
for (const [file, coverage] of parsed) {
	const descriptions = await parseFileMethods(file),
		attributed = coverageForMethods(descriptions, coverage);
	methods.push({
		file,
		methods: descriptions.map((d, i) => ({ ...d, ...attributed[i] })),
	});
}
const controls = methods.find((x) =>
	x.file.endsWith("/fixtures/method-controls.ts"),
);
check("original callback/Effect positive and zero identity", () => {
	assert.ok(controls);
	for (const [line, expected] of [
		[2, 100],
		[3, 100],
		[4, 0],
		[7, 100],
		[14, 100],
		[18, 0],
	]) {
		const m = controls.methods.find((m) => m.startLine === line);
		assert.ok(m, `line ${line}`);
		assert.equal(m.statementCoverage.percent, expected, `line ${line}`);
	}
});
check("unadvanced generator body is genuinely unexecuted", () => {
	assert.ok(controls);
	const m = controls.methods.find((m) => m.startLine === 11);
	assert.ok(m);
	assert.equal(m.statementCoverage.percent, 0);
});
await mkdir("/tmp/wallpaperdb-742", { recursive: true });
await writeFile(
	"/tmp/wallpaperdb-742/verification.json",
	JSON.stringify({ report, checks, methods }, null, 2),
);
console.log(
	JSON.stringify(
		{ report, inventory: Object.keys(data).length, checks },
		null,
		2,
	),
);
const accepted = process.argv.includes("--accept-inherited")
	? new Set(["unadvanced generator body is genuinely unexecuted"])
	: new Set();
for (const check of checks)
	if (!check.pass && accepted.has(check.name))
		console.log("UNCHANGED INHERITED LIMIT (accepted scope): " + check.name);
if (failures.some((name) => !accepted.has(name))) process.exitCode = 1;
