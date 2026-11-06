import type {
	Artifact,
	Issue,
	PullRequest,
	ReviewLedger,
	Comparison,
	ValidationRecord,
} from "./lib/agent-types.ts";
interface Assessment {
	head: string;
	issue: string;
	assessor?: string;
	rationale?: string;
	blockers: {
		issue: string;
		pr: string;
		head?: string;
		acceptanceRationale?: string;
		validationFile: string;
		reviewFile: string;
	}[];
}
interface Context {
	head: string;
	issue: Pick<Issue, "url" | "blockedBy">;
	repository: string;
	readPr: (
		subject: string,
	) => Pick<
		PullRequest,
		"url" | "state" | "isDraft" | "headRefOid" | "baseRefName"
	>;
	readIssue: (url: string) => {
		url: string;
		state: string;
		body?: string;
		comments?: { body?: string }[];
	};
	reviewErrors: (ledger: ReviewLedger, current: Comparison) => string[];
}
import fs from "node:fs";
import { createHash } from "node:crypto";
import { command } from "./lib/agent-command.ts";

function verifyArtifact(artifact: Artifact | undefined) {
	const data = artifact?.path && fs.readFileSync(artifact.path);
	if (
		!data?.length ||
		!artifact?.sha256 ||
		createHash("sha256").update(data).digest("hex") !== artifact.sha256
	)
		throw new Error("Stack evidence artifact is missing or changed");
}
export function verifyStackReadiness(
	assessment: Assessment,
	context: Context,
	run = command,
) {
	if (
		assessment.head !== context.head ||
		assessment.issue !== context.issue.url ||
		!assessment.assessor?.trim() ||
		!assessment.rationale?.trim() ||
		!Array.isArray(assessment.blockers)
	)
		throw new Error(
			"Stack assessment must identify current head, issue, assessor and rationale",
		);
	const open = context.issue.blockedBy.nodes.filter(
		(blocker) => blocker.state !== "CLOSED",
	);
	if (
		assessment.blockers.length !== open.length ||
		new Set(assessment.blockers.map((blocker) => blocker.issue)).size !==
			open.length
	)
		throw new Error("Stack assessment must cover exactly the open blockers");
	const verified = new Set<string>();
	for (const blocker of open) {
		const evidence = assessment.blockers.find(
			(entry) => entry.issue === blocker.url,
		);
		if (
			!blocker.url ||
			!evidence ||
			!evidence.head ||
			!/^[a-f0-9]{40}$/.test(evidence.head ?? "") ||
			!evidence.acceptanceRationale?.trim()
		)
			throw new Error(
				"Each blocker requires its validated commit and acceptance assessment",
			);
		const pr = context.readPr(evidence.pr);
		if (
			!pr.url.startsWith(`https://github.com/${context.repository}/pull/`) ||
			!["OPEN", "MERGED"].includes(pr.state) ||
			pr.isDraft ||
			pr.headRefOid !== evidence.head
		)
			throw new Error(
				"Blocker PR must be in this repository, ready for review, and at the evidenced head",
			);
		run("git", ["merge-base", "--is-ancestor", evidence.head, context.head]);
		const validation: ValidationRecord = JSON.parse(
			fs.readFileSync(evidence.validationFile, "utf8"),
		);
		if (
			validation.head !== evidence.head ||
			validation.tree !==
				run("git", ["rev-parse", `${evidence.head}^{tree}`]).trim() ||
			validation.sourceDigest !==
				createHash("sha256").update("").digest("hex") ||
			validation.state !== "completed" ||
			validation.expect !== "success" ||
			!validation.expectationMet ||
			!validation.stable ||
			!validation.checks?.length ||
			validation.checks.some(
				(check) => check.exitCode !== 0 || check.signal || check.error,
			)
		)
			throw new Error(
				"Blocker requires completed passing validation at its commit",
			);
		for (const check of validation.checks) verifyArtifact(check.artifact);
		const ledger: ReviewLedger = JSON.parse(
			fs.readFileSync(evidence.reviewFile, "utf8"),
		);
		if (
			ledger.current?.head !== evidence.head ||
			![pr.baseRefName, `origin/${pr.baseRefName}`].includes(
				ledger.current.baseRef,
			) ||
			context.reviewErrors(ledger, ledger.current).length
		)
			throw new Error(
				"Blocker requires applicable completed independent review",
			);
		for (const review of ledger.reviews ?? [])
			for (const artifact of [
				...(review.artifacts ?? []),
				...(review.applicability?.artifacts ?? []),
			])
				verifyArtifact(artifact);
		const recorded = context.readIssue(blocker.url);
		const body = [
			recorded.body,
			...(recorded.comments ?? []).map((comment) => comment.body),
		].join("\n");
		if (
			recorded.url !== blocker.url ||
			recorded.state.toUpperCase() !== "OPEN" ||
			!body.includes(pr.url) ||
			!body.includes(evidence.head)
		)
			throw new Error(
				"Blocker issue must record its PR URL and validated commit",
			);
		verified.add(blocker.url);
	}
	return verified;
}
