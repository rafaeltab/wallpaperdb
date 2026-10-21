import path from "node:path";

const blockingRules = new Set([
	"vitest/valid-expect",
	"vitest/valid-expect-in-promise",
	"vitest/require-awaited-expect-poll",
	"@typescript-eslint/no-floating-promises",
]);

export function summarize(report, repo) {
	const nativeExceptionWorks =
		report.runtime.nativeException.tests.some(
			(test) => test.name === "native-valid" && test.status === "passed",
		) &&
		report.runtime.nativeException.tests.some(
			(test) => test.name === "native-invalid" && test.status === "failed",
		);
	const detectors = {
		"Vitest defaults": (row) => row.baseline === "failed",
		"Vitest requireAssertions": (row) => row.enforced === "failed",
		"Biome noFloatingPromises": (row) =>
			row.biome.includes("lint/nursery/noFloatingPromises"),
		"Biome noSelfCompare": (row) =>
			row.biome.includes("lint/suspicious/noSelfCompare"),
		"Biome noMisplacedAssertion": (row) =>
			row.biome.includes("lint/suspicious/noMisplacedAssertion"),
		"ESLint existing blocking candidates": (row) =>
			row.eslint.some((rule) => blockingRules.has(rule)),
		"ESLint conditional advisory": (row) =>
			row.eslint.includes("vitest/no-conditional-expect"),
		"Prototype swallowed failures": (row) =>
			row.eslint.includes("prototype/no-swallowed-assertion"),
		"Prototype matcher tautologies": (row) =>
			row.eslint.includes("prototype/no-obvious-tautology"),
		// Count the compatibility exception only after its valid/invalid runtime pair works.
		"Proposed blockers with native-assert exception": (row) =>
			(row.enforced === "failed" &&
				!(row.id === "node-assert" && nativeExceptionWorks)) ||
			row.biome.includes("lint/suspicious/noSelfCompare") ||
			row.eslint.some((rule) => blockingRules.has(rule)),
		"All checks including advisories": (row) =>
			row.enforced === "failed" ||
			row.biome.length > 0 ||
			row.eslint.length > 0,
	};
	const controls = Object.entries(detectors).map(([check, detect]) => ({
		check,
		detectedInvalid: report.controls.filter((row) => !row.valid && detect(row))
			.length,
		missedInvalid: report.controls
			.filter((row) => !row.valid && !detect(row))
			.map((row) => row.id),
		rejectedValid: report.controls
			.filter((row) => row.valid && detect(row))
			.map((row) => row.id),
	}));
	const realFindings = [
		...report.static.biome.diagnostics,
		...report.static.eslint.diagnostics,
	]
		.filter((item) => path.relative(repo, item.file).startsWith("apps/"))
		.map((item) => {
			const file = path.relative(repo, item.file);
			const isInlineField =
				file ===
				"apps/web/test/components/profile/profile-inline-field.dom.test.tsx";
			let classification = "unsupported";
			let reason =
				"This location has not been reviewed. Do not infer that it is a defect.";
			if (
				isInlineField &&
				item.rule === "@typescript-eslint/no-floating-promises" &&
				item.line === 233
			) {
				classification = "actionable";
				reason =
					"An implicit Profile return selects the Promise-returning act overload. Await act or use a void block callback. The sampled runs pass; no observed false pass is claimed.";
			}
			if (
				isInlineField &&
				item.rule === "vitest/no-conditional-expect" &&
				[237, 238, 240, 241, 270, 271, 272, 297, 298].includes(item.line)
			) {
				classification = "false positive";
				reason =
					"The it.each cases deliberately choose different expected focus or cooldown outcomes. Every enumerated path asserts an outcome.";
			}
			return { ...item, file, classification, reason };
		});
	const median = (values) =>
		values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
	const timings = report.real.map((suite) => ({
		workspace: suite.workspace,
		tests: suite.runs[0].count,
		preparationMs: suite.preparation.ms,
		baselineMs: suite.runs.filter((run) => !run.required).map((run) => run.ms),
		enforcedMs: suite.runs.filter((run) => run.required).map((run) => run.ms),
		baselineMedianMs: median(
			suite.runs.filter((run) => !run.required).map((run) => run.ms),
		),
		enforcedMedianMs: median(
			suite.runs.filter((run) => run.required).map((run) => run.ms),
		),
	}));
	return {
		validControls: report.controls.filter((row) => row.valid).length,
		invalidControls: report.controls.filter((row) => !row.valid).length,
		controls,
		realFindings,
		timings,
	};
}
