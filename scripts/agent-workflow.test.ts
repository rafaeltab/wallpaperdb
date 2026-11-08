import type { Check } from "./lib/agent-types.ts";
import { expect } from "vitest";
import { test } from "vitest";
import { issuePreflight } from "./agent-workflow.ts";
const ready = () => ({
	state: "OPEN",
	url: "https://github.com/rafaeltab/wallpaperdb/issues/1",
	assignees: [{ login: "agent" }],
	blockedBy: { nodes: [], totalCount: 0 },
	project: { owner: "rafaeltab", number: 7, status: "In Progress" },
});
test("issue preflight rejects closed, unassigned, blocked and wrong-project work", () => {
	expect(issuePreflight(ready(), "agent", "In Progress")).toStrictEqual([]);
	for (const change of [
		{ state: "CLOSED" },
		{ assignees: [] },
		{ blockedBy: { nodes: [{ state: "OPEN" }], totalCount: 1 } },
		{ project: { owner: "someone", number: 7, status: "In Progress" } },
	])
		expect(
			issuePreflight({ ...ready(), ...change }, "agent", "In Progress").length,
		).toBeTruthy();
});
test("issue preflight accepts only individually verified stack blockers", () => {
	const url = "https://github.com/rafaeltab/wallpaperdb/issues/2";
	const issue = {
		...ready(),
		blockedBy: { nodes: [{ url, state: "OPEN" }], totalCount: 1 },
	};
	expect(
		issuePreflight(issue, "agent", "In Progress", new Set([url])),
	).toStrictEqual([]);
	expect(
		issuePreflight(issue, "agent", "In Progress", new Set()).length,
	).toBeTruthy();
	expect(
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
	).toBeTruthy();
});

import { prReadiness, ciAssessmentErrors } from "./agent-workflow.ts";
test("conditional applicability binds trusted policy and effective merge configuration", () => {
	const snapshot = {
		head: "a".repeat(40),
		baseRef: "main",
		policySha: "b".repeat(40),
		mergeSha: "c".repeat(40),
		policy: [{ path: ".github/workflows/docs.yml" }],
	};
	const assessment = {
		...snapshot,
		rationale: "inspected trusted event conditions",
		expectedChecks: ["build"],
		inapplicableChecks: [
			{
				name: "docs",
				policyPath: ".github/workflows/docs.yml",
				rationale: "paths condition does not match",
			},
		],
	};
	expect(ciAssessmentErrors(assessment, snapshot)).toStrictEqual([]);
	for (const change of [
		{ head: "d".repeat(40) },
		{ policySha: "d".repeat(40) },
		{ baseRef: "other" },
		{ mergeSha: "d".repeat(40) },
		{ expectedChecks: ["docs"] },
		{
			inapplicableChecks: [
				{
					name: "docs",
					policyPath: ".github/workflows/pr-controlled.yml",
					rationale: "removed by PR",
				},
			],
		},
		{
			inapplicableChecks: [
				{ name: "docs", policyPath: ".github/workflows/docs.yml" },
			],
		},
	])
		expect(
			ciAssessmentErrors({ ...assessment, ...change }, snapshot).length,
		).toBeTruthy();
});
test("readiness allows explicitly assessed conditional skips while retaining failed and required gates", () => {
	const pr = {
		state: "OPEN",
		mergeable: "MERGEABLE",
		statusCheckRollup: [
			{ name: "build", conclusion: "SUCCESS" },
			{ name: "conditional-docs", conclusion: "SKIPPED" },
		],
	};
	const exclusions = [
		{
			name: "conditional-docs",
			policyPath: ".github/workflows/docs.yml",
			rationale: "trusted paths condition excludes this change",
		},
	];
	expect(prReadiness(pr, ["build"], exclusions)).toStrictEqual([]);
	expect(prReadiness(pr, ["build"]).length).toBeTruthy();
	expect(
		prReadiness(pr, ["build", "conditional-docs"], exclusions).length,
	).toBeTruthy();
	expect(
		prReadiness(
			{
				...pr,
				statusCheckRollup: [
					{ name: "conditional-docs", conclusion: "FAILURE" },
				],
			},
			[],
			exclusions,
		).length,
	).toBeTruthy();
	expect(
		prReadiness(
			{
				...pr,
				statusCheckRollup: [
					{ name: "conditional-docs", status: "IN_PROGRESS" },
				],
			},
			[],
			exclusions,
		).length,
	).toBeTruthy();
});
test("PR readiness never treats absent, pending or unknown checks as passing", () => {
	const pr = {
		state: "OPEN",
		mergeable: "MERGEABLE",
		statusCheckRollup: [
			{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
		],
	};
	expect(prReadiness(pr, ["build"])).toStrictEqual([]);
	expect(
		prReadiness({ ...pr, statusCheckRollup: [] }, ["build"]).length,
	).toBeTruthy();
	expect(
		prReadiness({ ...pr, mergeable: "UNKNOWN" }, ["build"]).length,
	).toBeTruthy();
	expect(prReadiness(pr, null).length).toBeTruthy();
	expect(
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
	).toBeTruthy();
});

import { reviewEvidenceErrors } from "./agent-workflow.ts";
test("review evidence requires all axes and preserves actual reviewed comparisons", () => {
	const head = "a".repeat(40),
		base = "b".repeat(40);
	const current = { head, baseRef: "main", baseSha: base, mergeBase: base };
	const review = (axis: string) => ({
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
		automationIncidents: [],
		reviews: ["Standards", "Spec", "Defects"].map(review),
	};
	expect(reviewEvidenceErrors(evidence, current)).toStrictEqual([]);
	expect(
		reviewEvidenceErrors(
			{ ...evidence, automationIncidents: undefined },
			current,
		),
	).toContain(
		"Explicit automationIncidents disclosure is required, including an empty array when none occurred",
	);
	const incident = {
		url: "https://github.com/rafaeltab/wallpaperdb/issues/123",
		userNotified: true,
		outcome: "Fixed without weakening enforcement",
	};
	expect(
		reviewEvidenceErrors(
			{ ...evidence, automationIncidents: [incident] },
			current,
		),
	).toStrictEqual([]);
	for (const change of [
		{ userNotified: false },
		{ outcome: "" },
		{ url: "https://github.com/another/repo/issues/123" },
	])
		expect(
			reviewEvidenceErrors(
				{ ...evidence, automationIncidents: [{ ...incident, ...change }] },
				current,
			),
		).toContain(
			"Automation incidents require a repository issue, explicit user notification and outcome",
		);
	expect(
		reviewEvidenceErrors(
			{ ...evidence, reviews: evidence.reviews.slice(1) },
			current,
		).length,
	).toBeTruthy();
	expect(
		reviewEvidenceErrors(evidence, { ...current, head: "d".repeat(40) }).length,
	).toBeTruthy();
	const pending = {
		...evidence,
		reviews: [...evidence.reviews, { ...review("Spec"), outcome: "pending" }],
	};
	expect(reviewEvidenceErrors(pending, current).length).toBeTruthy();
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishMarkdown } from "./agent-workflow.ts";
test("Markdown publication passes hostile body text as a file and verifies exact readback", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "publication-"));
	t.onTestFinished(() =>
		fs.rmSync(directory, { recursive: true, force: true }),
	);
	const body =
		"First line\n\n```sh\n$(touch /tmp/should-not-exist)\nEOF\n```\n";
	const bodyFile = path.join(directory, "body.md");
	fs.writeFileSync(bodyFile, body);
	let posted: string | undefined;
	const run = (_program: string, args: readonly string[]) => {
		if (args.includes("--body-file")) {
			posted = fs.readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
			expect(!args.includes(body)).toBeTruthy();
			return "https://github.com/owner/repo/issues/1";
		}
		return JSON.stringify({ body: posted });
	};
	expect(
		publishMarkdown({ kind: "issue-edit", subject: "1", bodyFile }, run)
			.bodyVerified,
	).toBe(true);
	expect(posted).toBe(body);
	expect(() =>
		publishMarkdown(
			{ kind: "issue-edit", subject: "1", bodyFile },
			(_p, args) =>
				args.includes("--body-file")
					? ""
					: JSON.stringify({ body: "different" }),
		),
	).toThrow(/readback/);
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
	expect(prReadiness(pr, ["critical"]).length).toBeTruthy();
	expect(
		prReadiness(
			{
				...pr,
				statusCheckRollup: [{ ...pr.statusCheckRollup[0], advisory: true }],
			},
			[],
		),
	).toStrictEqual([]);
});

import { markAdvisoryChecks } from "./agent-workflow.ts";
test("advisory status is bound to the authenticated pilot path and current head", () => {
	const head = "a".repeat(40);
	const pr = {
		headRefOid: head,
		statusCheckRollup: [1, 2].map(
			(id): Check => ({
				name: "pilot",
				detailsUrl: `https://github.com/owner/repo/actions/runs/${id}/job/10`,
			}),
		),
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
	expect(pr.statusCheckRollup.map((c) => c.advisory)).toStrictEqual([
		true,
		false,
	]);
});
