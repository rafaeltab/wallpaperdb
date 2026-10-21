import { createHash } from "node:crypto";

export const categories = [
	"missing-outcome",
	"self-derived",
	"private-detail",
	"mixed-scenarios",
	"hidden-helper",
	"wide-matrix",
	"optional-nesting",
	"optional-snapshot",
];
const string = { type: "string", minLength: 1 };
const object = (properties) => ({
	type: "object",
	additionalProperties: false,
	required: Object.keys(properties),
	properties,
});
const citation = object({
	path: string,
	line: { type: "integer", minimum: 1 },
	quote: string,
});
export const schema = object({
	findings: {
		type: "array",
		items: object({
			caseId: string,
			category: { type: "string", enum: categories },
			title: string,
			test: citation,
			support: citation,
			failure: string,
			correction: string,
		}),
	},
});
export const hash = (value) => createHash("sha256").update(value).digest("hex");
// Conservative grouping: at most one independent claim per category per case.
export const findingKey = (f) => `${f.caseId}/${f.category}`;

export function validateReview(review, packet) {
	if (
		!review ||
		!Array.isArray(review.findings) ||
		Object.keys(review).length !== 1
	)
		throw new Error("Expected findings array only");
	if (review.findings.length > 30) throw new Error("Finding budget exceeded");
	for (const f of review.findings) {
		const c = packet.cases.find((item) => item.id === f.caseId);
		if (!c || !categories.includes(f.category))
			throw new Error("Unknown case/category");
		if (
			Object.keys(f).sort().join() !==
			Object.keys(schema.properties.findings.items.properties).sort().join()
		)
			throw new Error("Unexpected finding fields");
		for (const key of ["title", "failure", "correction"])
			if (typeof f[key] !== "string" || !f[key].trim())
				throw new Error(`Missing ${key}`);
		for (const key of ["test", "support"]) {
			const cite = f[key];
			const file = [...c.files, ...(packet.standards ?? [])].find(
				(item) => item.path === cite?.path,
			);
			if (
				!file ||
				!Number.isInteger(cite.line) ||
				cite.line < 1 ||
				typeof cite.quote !== "string" ||
				!cite.quote.trim() ||
				!file.text.split("\n")[cite.line - 1]?.includes(cite.quote) ||
				(key === "test" && !["test", "helper"].includes(file.role)) ||
				(key === "support" &&
					!["requirement", "production", "standard", "helper"].includes(
						file.role,
					))
			)
				throw new Error(`Unsupported ${key} citation`);
		}
	}
	return review;
}

export function summarize(runs, judgments, truth = []) {
	const unique = new Map();
	for (const [index, run] of runs.entries())
		for (const f of run.findings) {
			const key = findingKey(f);
			if (!unique.has(key)) unique.set(key, { key, finding: f, runs: [] });
			const entry = unique.get(key);
			if (!entry.runs.includes(index + 1)) entry.runs.push(index + 1);
		}
	const human = judgments.filter((j) => j.judgeKind === "human");
	const seen = new Set();
	for (const j of human) {
		if (
			!unique.has(j.key) ||
			seen.has(j.key) ||
			!["actionable", "false-positive"].includes(j.verdict) ||
			!j.rationale?.trim()
		)
			throw new Error("Invalid or duplicate human judgment");
		seen.add(j.key);
	}
	const actionable = human.filter((j) => j.verdict === "actionable").length;
	const sets = runs.map((r) => new Set(r.findings.map(findingKey)));
	const pairs = [];
	for (let a = 0; a < sets.length; a++)
		for (let b = a + 1; b < sets.length; b++) {
			const union = new Set([...sets[a], ...sets[b]]);
			const common = [...sets[a]].filter((key) => sets[b].has(key)).length;
			pairs.push(union.size ? common / union.size : 1);
		}
	return {
		uniqueFindings: [...unique.values()],
		humanJudged: human.length,
		actionable,
		falsePositives: human.length - actionable,
		humanPrecision: human.length ? actionable / human.length : null,
		// This curated packet is not a representative sample of 50 independent findings.
		thresholdValidated: false,
		pending: unique.size - human.length,
		pairwiseJaccard: pairs,
		seedOpportunities: truth.filter((c) => c.expected).length * runs.length,
		seedMisses: truth
			.filter((c) => c.expected)
			.reduce(
				(sum, c) =>
					sum +
					runs.filter(
						(r) =>
							!r.findings.some(
								(f) => f.caseId === c.id && f.category === c.expected,
							),
					).length,
				0,
			),
		cleanControlOpportunities:
			truth.filter((c) => c.clean).length * runs.length,
		cleanControlFlagCount: truth
			.filter((c) => c.clean)
			.reduce(
				(sum, c) =>
					sum +
					runs.filter((r) => r.findings.some((f) => f.caseId === c.id)).length,
				0,
			),
		seedDetection: truth
			.filter((c) => c.expected)
			.map((c) => ({
				id: c.id,
				expected: c.expected,
				detectedRuns: runs
					.map((r, i) =>
						r.findings.some(
							(f) => f.caseId === c.id && f.category === c.expected,
						)
							? i + 1
							: null,
					)
					.filter(Boolean),
			})),
		cleanControlFlags: truth
			.filter((c) => c.clean)
			.map((c) => ({
				id: c.id,
				flaggedRuns: runs
					.map((r, i) =>
						r.findings.some((f) => f.caseId === c.id) ? i + 1 : null,
					)
					.filter(Boolean),
			})),
		totalMs: runs.reduce((sum, r) => sum + r.elapsedMs, 0),
		tokens: runs.reduce((sum, r) => {
			for (const [key, value] of Object.entries(r.usage))
				sum[key] = (sum[key] ?? 0) + value;
			return sum;
		}, {}),
	};
}
