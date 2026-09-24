import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRanking, summarizeAccuracy } from "./metrics.mjs";

const example = {
	id: "example",
	category: "Perceived color",
	groupId: "related-images",
	judgedIds: ["a", "b", "c"],
	expectedRankedIds: ["a", "b", "c"],
	preferencePairs: [
		{ preferred: "a", other: "b", uncertain: true },
		{ preferred: "a", other: "c", uncertain: false },
		{ preferred: "b", other: "c", uncertain: false },
	],
};

test("scores strict agreement, model ties, and sensitivity without explicit uncertain pairs", () => {
	const result = evaluateRanking(example, [
		{ id: "a", score: 2 },
		{ id: "b", score: 2 },
		{ id: "c", score: 1 },
	]);
	assert.equal(result.allPairs.agreement, 2.5 / 3);
	assert.equal(result.allPairs.tied, 1);
	assert.equal(result.withoutUncertain.agreement, 1);
	assert.equal(result.withoutUncertain.totalPairs, 2);
	assert.equal(result.coverage.fraction, 1);
	assert.equal(result.status, "complete");
});

test("missing hits remain unassessed instead of silently sorting last", () => {
	const result = evaluateRanking(example, [
		{ id: "a", score: 3 },
		{ id: "b", score: 1 },
	]);
	assert.equal(result.allPairs.agreement, 1);
	assert.equal(result.allPairs.assessedPairs, 1);
	assert.equal(result.allPairs.totalPairs, 3);
	assert.equal(result.allPairs.coverage, 1 / 3);
	assert.equal(result.withoutUncertain.agreement, null);
	assert.deepEqual(result.coverage.missingIds, ["c"]);
	assert.equal(result.status, "partial");
});

test("score order, not arbitrary result order, evaluates strict preferences", () => {
	const result = evaluateRanking(example, [
		{ id: "a", score: 1 },
		{ id: "b", score: 3 },
		{ id: "c", score: 2 },
	]);
	assert.equal(result.allPairs.agreement, 1 / 3);
	assert.equal(result.allPairs.discordant, 2);
});

test("duplicate hit IDs and non-finite scores fail explicitly", () => {
	assert.throws(
		() =>
			evaluateRanking(example, [
				{ id: "a", score: 2 },
				{ id: "a", score: 1 },
			]),
		/duplicate/i,
	);
	assert.throws(
		() => evaluateRanking(example, [{ id: "a", score: Number.NaN }]),
		/finite/i,
	);
	assert.throws(
		() => evaluateRanking(example, [{ id: "a", score: null }]),
		/finite/i,
	);
});

test("excluded images are eligibility violations and not missing relevance comparisons", () => {
	const data = {
		...example,
		judgedIds: ["a", "b", "c", "x"],
		excludedIds: ["x"],
	};
	const result = evaluateRanking(data, [
		{ id: "a", score: 3 },
		{ id: "b", score: 2 },
		{ id: "c", score: 1 },
		{ id: "x", score: 4 },
	]);
	assert.equal(result.allPairs.agreement, 1);
	assert.equal(result.coverage.fraction, 1);
	assert.deepEqual(result.eligibility.excludedReturned, ["x"]);
	assert.equal(result.eligibility.violations, 1);
});

test("human-unconstrained orders are unscored even when all images are returned", () => {
	const result = evaluateRanking({ ...example, preferencePairs: [] }, [
		{ id: "a", score: 2 },
		{ id: "b", score: 1 },
		{ id: "c", score: 0 },
	]);
	assert.equal(result.allPairs.agreement, null);
	assert.equal(result.allPairs.totalPairs, 0);
	assert.equal(result.status, "unscored");
});

test("query-macro averages keep partial, unsupported and error coverage visible", () => {
	const correct = evaluateRanking(example, [
		{ id: "a", score: 3 },
		{ id: "b", score: 2 },
		{ id: "c", score: 1 },
	]);
	const inverted = evaluateRanking(
		{
			...example,
			id: "two",
			category: "Vibe",
			preferencePairs: [example.preferencePairs[1]],
		},
		[
			{ id: "a", score: 1 },
			{ id: "b", score: 2 },
			{ id: "c", score: 3 },
		],
	);
	const missing = evaluateRanking({ ...example, id: "three" }, []);
	const summary = summarizeAccuracy([
		{ status: "ok", accuracy: correct },
		{ status: "ok", accuracy: inverted },
		{ status: "unsupported", accuracy: missing },
		{ status: "error", accuracy: missing },
	]);
	assert.equal(summary.totalCases, 4);
	assert.equal(summary.allPairs.queryMacroAgreement, 0.5);
	assert.equal(summary.allPairs.assessedCases, 2);
	assert.equal(summary.allPairs.totalPairs, 10);
	assert.equal(summary.allPairs.assessedPairs, 4);
	assert.equal(summary.imageCoverage.fraction, 0.5);
	assert.equal(summary.statusCounts.unsupported, 1);
	assert.equal(summary.statusCounts.error, 1);
	assert.equal(summary.categories.Vibe.allPairs.queryMacroAgreement, 0);
});
