import assert from "node:assert/strict";
import { controls, expectedStatic } from "./controls.mjs";
import { runExperiment } from "./experiment.mjs";

const report = await runExperiment({
	controlsOnly: process.argv.includes("--controls"),
});
for (const control of controls) {
	const observed = report.controls.find((row) => row.id === control.id);
	assert.ok(observed, `missing control ${control.id}`);
	assert.equal(
		observed.baseline,
		control.baseline ?? "passed",
		`${control.id}: baseline drift`,
	);
	assert.equal(
		observed.enforced,
		control.enforced ?? "passed",
		`${control.id}: enforced drift`,
	);
	for (const checker of ["biome", "eslint"]) {
		assert.deepEqual(
			observed[checker].toSorted(),
			(expectedStatic[checker][control.id] ?? []).toSorted(),
			`${control.id}: ${checker} drift`,
		);
	}
}
for (const mode of ["baseline", "enforced"]) {
	assert.equal(
		report.runtime[mode].count,
		controls.length + 4,
		"Missing supplemental control",
	);
	for (const name of [
		"setup-only",
		"hook-only-assertion",
		"global-without-assertion",
		"global-assertion-donor",
	]) {
		assert.equal(
			report.runtime[mode].tests.find((test) => test.name === name)?.status,
			"passed",
			`${name}: ${mode} drift`,
		);
	}
}
for (const suite of report.real) {
	for (const run of suite.runs)
		assert.equal(run.status, 0, `${suite.workspace}: repository tests failed`);
}
assert.equal(
	report.static.biome.diagnostics.filter(
		(item) =>
			item.file.endsWith("/helpers.ts") &&
			item.rule === "lint/suspicious/noMisplacedAssertion",
	).length,
	1,
	"The assertion helper placement false positive changed",
);
console.table(
	report.controls.map((row) => ({
		control: row.id,
		valid: row.valid,
		baseline: row.baseline,
		enforced: row.enforced,
		biome: row.biome.length,
		eslint: row.eslint.length,
	})),
);
console.log(
	`All runtime and static control contracts matched. Full report: ${report.artifacts}/report.json`,
);
console.table(
	report.summary.controls.map((row) => ({
		check: row.check,
		detectedInvalid: row.detectedInvalid,
		missedInvalid: row.missedInvalid.length,
		rejectedValid: row.rejectedValid.length,
	})),
);
if (report.real.length) {
	console.table(report.summary.timings);
	console.table(
		report.summary.realFindings.map((item) => ({
			file: item.file,
			line: item.line,
			rule: item.rule,
			classification: item.classification,
		})),
	);
}
console.log(
	`Total wall time: ${report.totalMs}ms; Biome: ${report.static.biome.ms}ms; type-aware ESLint: ${report.static.eslint.ms}ms.`,
);
