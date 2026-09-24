/**
 * Metric policy v1: larger finite scores rank first. Equal model scores receive
 * half credit on a strict human preference. Human ties have no within-group
 * constraint. Missing endpoints are unassessed, not treated as last place.
 * Agreement describes this reviewer's recorded preferences, not perceptual truth.
 */
export const accuracyPolicy = {
	version: 1,
	id: "strict-pair-query-macro-v1",
	higherScoresAreBetter: true,
	modelTieCredit: 0.5,
	humanTiePolicy: "no within-group ordering constraint",
	missingHitPolicy: "unassessed; report coverage",
	aggregation:
		"equal weight per query with at least one assessed strict pair; report coverage and complete-case score separately",
};

const fraction = (numerator, denominator) =>
	denominator ? numerator / denominator : null;
const mean = (values) =>
	values.length
		? values.reduce((sum, value) => sum + value, 0) / values.length
		: null;

function pairSummary(pairs) {
	const counts = { concordant: 0, discordant: 0, tied: 0 };
	for (const pair of pairs)
		if (pair.outcome in counts) counts[pair.outcome] += 1;
	const assessedPairs = counts.concordant + counts.discordant + counts.tied;
	return {
		agreement: fraction(counts.concordant + 0.5 * counts.tied, assessedPairs),
		assessedPairs,
		totalPairs: pairs.length,
		coverage: fraction(assessedPairs, pairs.length),
		...counts,
	};
}

export function evaluateRanking(caseData, hits) {
	if (!Array.isArray(hits))
		throw new TypeError("Ranking hits must be an array");
	const scores = new Map();
	for (const hit of hits) {
		if (typeof hit?.id !== "string" || !hit.id)
			throw new TypeError("Every hit requires a nonempty string ID");
		if (scores.has(hit.id)) throw new Error(`Duplicate hit ID: ${hit.id}`);
		if (typeof hit.score !== "number" || !Number.isFinite(hit.score)) {
			throw new TypeError(`Hit ${hit.id} requires a finite numeric score`);
		}
		scores.set(hit.id, hit.score);
	}
	const expectedIds =
		caseData.expectedRankedIds ??
		caseData.judgedIds.filter((id) => !caseData.excludedIds?.includes(id));
	const returnedIds = expectedIds.filter((id) => scores.has(id));
	const missingIds = expectedIds.filter((id) => !scores.has(id));
	const comparisons = caseData.preferencePairs.map((pair) => {
		let outcome = "missing";
		let credit = null;
		if (scores.has(pair.preferred) && scores.has(pair.other)) {
			const left = scores.get(pair.preferred);
			const right = scores.get(pair.other);
			outcome =
				left === right ? "tied" : left > right ? "concordant" : "discordant";
			credit = outcome === "tied" ? 0.5 : outcome === "concordant" ? 1 : 0;
		}
		return { ...pair, outcome, credit };
	});
	const allPairs = pairSummary(comparisons);
	const excludedReturned = (caseData.excludedIds ?? []).filter((id) =>
		scores.has(id),
	);
	return {
		metricPolicy: accuracyPolicy.id,
		caseId: caseData.id,
		category: caseData.category,
		categories: caseData.categories ?? [caseData.category],
		groupId: caseData.groupId,
		status:
			allPairs.totalPairs === 0
				? "unscored"
				: missingIds.length
					? "partial"
					: "complete",
		allPairs,
		withoutUncertain: pairSummary(
			comparisons.filter((pair) => !pair.uncertain),
		),
		coverage: {
			expectedIds: [...expectedIds],
			returnedIds,
			missingIds,
			fraction: fraction(returnedIds.length, expectedIds.length),
		},
		eligibility: { excludedReturned, violations: excludedReturned.length },
		discrepancies: comparisons.filter((pair) => pair.outcome !== "concordant"),
	};
}

function summaryFor(records) {
	const statusCounts = {};
	for (const record of records) {
		const status =
			record.status === "ok" || !record.status
				? record.accuracy.status
				: record.status;
		statusCounts[status] = (statusCounts[status] ?? 0) + 1;
	}
	const summarizePairs = (key) => {
		const available = records.filter(
			(record) => !["unsupported", "error"].includes(record.status),
		);
		const assessed = available.filter(
			(record) => record.accuracy[key].agreement !== null,
		);
		const complete = assessed.filter(
			(record) => record.accuracy.coverage.missingIds.length === 0,
		);
		const assessedPairs = available.reduce(
			(sum, record) => sum + record.accuracy[key].assessedPairs,
			0,
		);
		const totalPairs = records.reduce(
			(sum, record) => sum + record.accuracy[key].totalPairs,
			0,
		);
		return {
			queryMacroAgreement: mean(
				assessed.map((record) => record.accuracy[key].agreement),
			),
			completeCaseMacroAgreement: mean(
				complete.map((record) => record.accuracy[key].agreement),
			),
			assessedCases: assessed.length,
			completeCases: complete.length,
			totalCases: records.length,
			assessedPairs,
			totalPairs,
			pairCoverage: fraction(assessedPairs, totalPairs),
		};
	};
	const expected = records.reduce(
		(sum, record) => sum + record.accuracy.coverage.expectedIds.length,
		0,
	);
	const returned = records
		.filter((record) => !["unsupported", "error"].includes(record.status))
		.reduce(
			(sum, record) => sum + record.accuracy.coverage.returnedIds.length,
			0,
		);
	return {
		totalCases: records.length,
		statusCounts,
		allPairs: summarizePairs("allPairs"),
		withoutUncertain: summarizePairs("withoutUncertain"),
		imageCoverage: {
			expected,
			returned,
			fraction: fraction(returned, expected),
		},
		eligibilityViolations: records.reduce(
			(sum, record) => sum + record.accuracy.eligibility.violations,
			0,
		),
	};
}

/** Accept runner records {status, accuracy} or direct evaluateRanking results. */
export function summarizeAccuracy(caseResults) {
	const records = caseResults.map((result) =>
		result.accuracy ? result : { status: result.status, accuracy: result },
	);
	const byCategory = new Map();
	for (const record of records) {
		const category = record.accuracy.category ?? "Uncategorized";
		if (!byCategory.has(category)) byCategory.set(category, []);
		byCategory.get(category).push(record);
	}
	return {
		...summaryFor(records),
		categories: Object.fromEntries(
			[...byCategory].map(([category, items]) => [category, summaryFor(items)]),
		),
	};
}
