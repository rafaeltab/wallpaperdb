import assert from "node:assert/strict";
import test from "node:test";
import { issuePreflight } from "./agent-workflow.mjs";
const ready = () => ({
	state: "OPEN",
	url: "https://github.com/rafaeltab/wallpaperdb/issues/1",
	assignees: [{ login: "agent" }],
	blockedBy: { nodes: [], totalCount: 0 },
	project: { owner: "rafaeltab", number: 7, status: "In Progress" },
});
test("issue preflight rejects closed, unassigned, blocked and wrong-project work", () => {
	assert.deepEqual(issuePreflight(ready(), "agent", "In Progress"), []);
	for (const change of [
		{ state: "CLOSED" },
		{ assignees: [] },
		{ blockedBy: { nodes: [{ state: "OPEN" }], totalCount: 1 } },
		{ project: { owner: "someone", number: 7, status: "In Progress" } },
	])
		assert.ok(
			issuePreflight({ ...ready(), ...change }, "agent", "In Progress").length,
		);
});

import { prReadiness } from "./agent-workflow.mjs";
test("PR readiness never treats absent, pending or unknown checks as passing", () => {
	const pr = {
		state: "OPEN",
		mergeable: "MERGEABLE",
		statusCheckRollup: [
			{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
		],
	};
	assert.deepEqual(prReadiness(pr, ["build"]), []);
	assert.ok(prReadiness({ ...pr, statusCheckRollup: [] }, ["build"]).length);
	assert.ok(prReadiness({ ...pr, mergeable: "UNKNOWN" }, ["build"]).length);
	assert.ok(prReadiness(pr, null).length);
	assert.ok(
		prReadiness(
			{
				...pr,
				statusCheckRollup: [
					...pr.statusCheckRollup,
					{ name: "extra", status: "IN_PROGRESS" },
				],
			},
			["build"],
		).length,
	);
});

import { reviewEvidenceErrors } from "./agent-workflow.mjs";
test("review evidence requires all axes and preserves actual reviewed comparisons", () => {
	const head = "a".repeat(40),
		base = "b".repeat(40);
	const current = { head, baseRef: "main", baseSha: base, mergeBase: base };
	const review = (axis) => ({
		axis,
		reviewer: "independent",
		task: "task-1",
		head,
		baseRef: "main",
		baseSha: base,
		mergeBase: base,
		diffCommand: "git diff base head",
		requirements: "issue 668",
		scope: "authorized work",
		outcome: "clean",
		findings: [],
		artifacts: [{ path: "/evidence.patch", sha256: "c".repeat(64) }],
	});
	const evidence = {
		current,
		reviews: ["Standards", "Spec", "Defects"].map(review),
	};
	assert.deepEqual(reviewEvidenceErrors(evidence, current), []);
	assert.ok(
		reviewEvidenceErrors(
			{ ...evidence, reviews: evidence.reviews.slice(1) },
			current,
		).length,
	);
	assert.ok(
		reviewEvidenceErrors(evidence, { ...current, head: "d".repeat(40) }).length,
	);
	const pending = {
		...evidence,
		reviews: [...evidence.reviews, { ...review("Spec"), outcome: "pending" }],
	};
	assert.ok(reviewEvidenceErrors(pending, current).length);
});
