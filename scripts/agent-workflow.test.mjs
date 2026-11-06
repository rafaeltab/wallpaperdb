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
test("issue preflight accepts only individually verified stack blockers", () => {
	const url = "https://github.com/rafaeltab/wallpaperdb/issues/2";
	const issue = {
		...ready(),
		blockedBy: { nodes: [{ url, state: "OPEN" }], totalCount: 1 },
	};
	assert.deepEqual(
		issuePreflight(issue, "agent", "In Progress", new Set([url])),
		[],
	);
	assert.ok(issuePreflight(issue, "agent", "In Progress", new Set()).length);
	assert.ok(
		issuePreflight(
			{
				...issue,
				blockedBy: {
					nodes: [...issue.blockedBy.nodes, { url: `${url}0`, state: "OPEN" }],
					totalCount: 2,
				},
			},
			"agent",
			"In Progress",
			new Set([url]),
		).length,
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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishMarkdown } from "./agent-workflow.mjs";
test("Markdown publication passes hostile body text as a file and verifies exact readback", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "publication-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const body =
		"First line\n\n```sh\n$(touch /tmp/should-not-exist)\nEOF\n```\n";
	const bodyFile = path.join(directory, "body.md");
	fs.writeFileSync(bodyFile, body);
	let posted;
	const run = (_program, args) => {
		if (args.includes("--body-file")) {
			posted = fs.readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
			assert.ok(!args.includes(body));
			return "https://github.com/owner/repo/issues/1";
		}
		return JSON.stringify({ body: posted });
	};
	assert.equal(
		publishMarkdown({ kind: "issue-edit", subject: "1", bodyFile }, run)
			.bodyVerified,
		true,
	);
	assert.equal(posted, body);
	assert.throws(
		() =>
			publishMarkdown(
				{ kind: "issue-edit", subject: "1", bodyFile },
				(_p, args) =>
					args.includes("--body-file")
						? ""
						: JSON.stringify({ body: "different" }),
			),
		/readback/,
	);
});

test("a workflow display name cannot grant a CI exemption", () => {
	const pr = {
		state: "OPEN",
		mergeable: "MERGEABLE",
		statusCheckRollup: [
			{
				name: "critical",
				workflowName: "Mutation pilot",
				conclusion: "FAILURE",
			},
		],
	};
	assert.ok(prReadiness(pr, ["critical"]).length);
	assert.deepEqual(
		prReadiness(
			{
				...pr,
				statusCheckRollup: [{ ...pr.statusCheckRollup[0], advisory: true }],
			},
			[],
		),
		[],
	);
});

import { markAdvisoryChecks } from "./agent-workflow.mjs";
test("advisory status is bound to the authenticated pilot path and current head", () => {
	const head = "a".repeat(40);
	const pr = {
		headRefOid: head,
		statusCheckRollup: [1, 2].map((id) => ({
			name: "pilot",
			detailsUrl: `https://github.com/owner/repo/actions/runs/${id}/job/10`,
		})),
	};
	markAdvisoryChecks(
		pr,
		"owner/repo",
		[{ path: ".github/workflows/mutation.yml" }],
		(args) => ({
			path: args[1].endsWith("/1")
				? ".github/workflows/mutation.yml"
				: ".github/workflows/critical.yml",
			head_sha: head,
		}),
	);
	assert.deepEqual(
		pr.statusCheckRollup.map((c) => c.advisory),
		[true, false],
	);
});
