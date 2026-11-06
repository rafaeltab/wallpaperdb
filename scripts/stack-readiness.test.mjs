import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { verifyStackReadiness } from "./stack-readiness.mjs";
import { reviewEvidenceErrors } from "./agent-workflow.mjs";

test("stack readiness verifies the parent commit, passing logs, review axes and issue record", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "stack-readiness-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const run = (program, args) =>
		execFileSync(program, args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	run("git", ["init"]);
	const commit = (name) =>
		run("git", [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"--allow-empty",
			"-m",
			name,
		]);
	commit("parent");
	const parent = run("git", ["rev-parse", "HEAD"]).trim();
	commit("child");
	const head = run("git", ["rev-parse", "HEAD"]).trim();
	const sha = (text) => createHash("sha256").update(text).digest("hex");
	const log = path.join(root, "validation.log");
	fs.writeFileSync(log, "all checks passed\n");
	const artifact = { path: log, sha256: sha("all checks passed\n") };
	const current = {
		head: parent,
		baseRef: "main",
		baseSha: parent,
		mergeBase: parent,
	};
	const ledger = {
		current,
		reviews: ["Standards", "Spec", "Defects"].map((axis) => ({
			...current,
			axis,
			reviewer: "independent",
			task: `review-${axis}`,
			diffCommand: "git diff base head",
			requirements: "blocker issue",
			scope: "accepted work",
			outcome: "clean",
			findings: [],
			artifacts: [artifact],
		})),
	};
	const validation = {
		head: parent,
		tree: run("git", ["rev-parse", `${parent}^{tree}`]).trim(),
		sourceDigest: sha(""),
		state: "completed",
		expect: "success",
		expectationMet: true,
		stable: true,
		checks: [{ command: ["make", "ci"], exitCode: 0, artifact }],
	};
	const validationFile = path.join(root, "validation.json"),
		reviewFile = path.join(root, "reviews.json");
	const blocker = "https://github.com/owner/repo/issues/1",
		issue = "https://github.com/owner/repo/issues/2",
		pr = "https://github.com/owner/repo/pull/3";
	const assessment = {
		head,
		issue,
		assessor: "coordinator",
		rationale: "parent PR is the preceding layer of this stack",
		blockers: [
			{
				issue: blocker,
				pr,
				head: parent,
				acceptanceRationale: "all acceptance scenarios verified",
				validationFile,
				reviewFile,
			},
		],
	};
	const context = {
		head,
		issue: {
			url: issue,
			blockedBy: { nodes: [{ url: blocker, state: "OPEN" }] },
		},
		repository: "owner/repo",
		readPr: () => ({
			url: pr,
			state: "OPEN",
			isDraft: false,
			headRefOid: parent,
			baseRefName: "main",
		}),
		readIssue: () => ({
			url: blocker,
			state: "OPEN",
			body: "",
			comments: [{ body: `Validated ${parent}; PR ${pr}` }],
		}),
		reviewErrors: reviewEvidenceErrors,
	};
	const write = (record = validation, reviews = ledger) => {
		fs.writeFileSync(validationFile, JSON.stringify(record));
		fs.writeFileSync(reviewFile, JSON.stringify(reviews));
	};
	write();
	assert.deepEqual(
		[...verifyStackReadiness(assessment, context, run)],
		[blocker],
	);
	assert.throws(
		() => verifyStackReadiness({ ...assessment, blockers: [] }, context, run),
		/exactly/,
	);
	assert.throws(
		() => verifyStackReadiness({ ...assessment, head: parent }, context, run),
		/current head/,
	);
	assert.throws(
		() =>
			verifyStackReadiness(
				assessment,
				{
					...context,
					readIssue: () => ({
						url: blocker,
						state: "OPEN",
						body: "no evidence",
					}),
				},
				run,
			),
		/record/,
	);
	assert.throws(
		() =>
			verifyStackReadiness(
				assessment,
				{
					...context,
					readPr: () => ({ ...context.readPr(), headRefOid: head }),
				},
				run,
			),
		/evidenced head/,
	);
	write({ ...validation, sourceDigest: sha("dirty source") });
	assert.throws(
		() => verifyStackReadiness(assessment, context, run),
		/passing validation/,
	);
	write(validation, { ...ledger, reviews: ledger.reviews.slice(1) });
	assert.throws(
		() => verifyStackReadiness(assessment, context, run),
		/independent review/,
	);
	write();
	fs.appendFileSync(log, "changed");
	assert.throws(
		() => verifyStackReadiness(assessment, context, run),
		/artifact/,
	);
	const descendant = {
		...assessment,
		head: parent,
		blockers: [{ ...assessment.blockers[0], head }],
	};
	assert.throws(() =>
		verifyStackReadiness(
			descendant,
			{
				...context,
				head: parent,
				readPr: () => ({ ...context.readPr(), headRefOid: head }),
			},
			run,
		),
	);
});
