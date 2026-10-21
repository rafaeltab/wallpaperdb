import assert from "node:assert/strict";
import test from "node:test";
import { validateReview, summarize } from "./protocol.mjs";

const packet = {
	cases: [
		{
			id: "C1",
			files: [
				{
					path: "case.test.mjs",
					role: "test",
					text: "assert.equal(actual, actual);",
				},
				{
					path: "requirement.md",
					role: "requirement",
					text: "Return the specified independent value.",
				},
			],
		},
	],
};
const finding = {
	caseId: "C1",
	category: "self-derived",
	title: "Circular expectation",
	test: {
		path: "case.test.mjs",
		line: 1,
		quote: "assert.equal(actual, actual);",
	},
	support: {
		path: "requirement.md",
		line: 1,
		quote: "Return the specified independent value.",
	},
	failure: "A wrong result passes when compared with itself.",
	correction: "Assert the literal specified value.",
};

test("accepts a supported finding and a clean result", () => {
	assert.deepEqual(validateReview({ findings: [finding] }, packet), {
		findings: [finding],
	});
	assert.deepEqual(validateReview({ findings: [] }, packet), { findings: [] });
});
test("rejects fabricated citations, missing evidence, unknown cases and categories", () => {
	for (const change of [
		{ test: { ...finding.test, quote: "not in source" } },
		{ support: null },
		{ caseId: "unknown" },
		{ category: "too-long" },
		{ test: { ...finding.test, line: 2 } },
		{ failure: "" },
	])
		assert.throws(() =>
			validateReview({ findings: [{ ...finding, ...change }] }, packet),
		);
});
test("repeat copies do not increase independently judged denominator and pending is not precision", () => {
	const runs = [
		{
			findings: [finding],
			elapsedMs: 10,
			usage: { input_tokens: 100, output_tokens: 20 },
		},
		{
			findings: [finding],
			elapsedMs: 20,
			usage: { input_tokens: 100, output_tokens: 20 },
		},
	];
	const pending = summarize(runs, []);
	assert.equal(pending.uniqueFindings.length, 1);
	assert.equal(pending.humanPrecision, null);
	const judged = summarize(runs, [
		{
			key: pending.uniqueFindings[0].key,
			verdict: "false-positive",
			judgeKind: "human",
			rationale: "This is a contract fixture.",
		},
	]);
	assert.equal(judged.humanPrecision, 0);
	assert.equal(judged.humanJudged, 1);
	assert.equal(judged.thresholdValidated, false);
	assert.equal(judged.totalMs, 30);
});
test("agent judgments cannot masquerade as human judgments", () => {
	const result = summarize(
		[{ findings: [finding], elapsedMs: 1, usage: {} }],
		[],
	);
	const key = result.uniqueFindings[0].key;
	assert.equal(
		summarize(
			[{ findings: [finding], elapsedMs: 1, usage: {} }],
			[
				{
					key,
					verdict: "actionable",
					judgeKind: "agent",
					rationale: "Provisional.",
				},
			],
		).humanPrecision,
		null,
	);
});
