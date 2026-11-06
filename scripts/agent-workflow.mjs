import { videoReferences, verifyVideo } from "./verify-video.mjs";
import { guardedPush } from "./guarded-push.mjs";
import { githubFeedback } from "./collect-feedback.mjs";
import { publishMarkdown } from "./publish-markdown.mjs";
export { publishMarkdown };
import { command, github } from "./lib/agent-command.mjs";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
export { command, github };
export function issuePreflight(issue, login, status) {
	const errors = [];
	if (issue.state !== "OPEN") errors.push("Issue must be open");
	if (!issue.assignees?.some((a) => a.login === login))
		errors.push(`Issue must be assigned to ${login}`);
	if (issue.project?.owner !== "rafaeltab" || issue.project?.number !== 7)
		errors.push("Issue must belong to rafaeltab project 7");
	if (issue.project?.status !== status)
		errors.push(`Issue status must be ${status}`);
	if (issue.blockedBy?.totalCount !== issue.blockedBy?.nodes?.length)
		errors.push("Issue dependency discovery is incomplete");
	if (issue.blockedBy?.nodes?.some((b) => b.state !== "CLOSED"))
		errors.push("Open blockers require a verified stack-readiness assessment");
	return errors;
}
export function prReadiness(pr, expectedChecks) {
	const errors = [];
	if (pr.state !== "OPEN") errors.push("PR is not open");
	if (pr.mergeable !== "MERGEABLE")
		errors.push("Merge-conflict status is not verified");
	if (!Array.isArray(expectedChecks))
		errors.push("CI applicability requires a recorded policy assessment");
	const checks = pr.statusCheckRollup ?? [];
	for (const name of expectedChecks ?? [])
		if (!checks.some((check) => (check.name ?? check.context) === name))
			errors.push(`Missing expected check ${name}`);
	for (const check of checks) {
		if (check.workflowName === "Mutation pilot") continue;
		if ((check.conclusion ?? check.state) !== "SUCCESS")
			errors.push(
				`Check ${check.name ?? check.context} is ${check.conclusion || check.state || check.status || "unknown"}`,
			);
	}
	return errors;
}
export function readPr(subject) {
	if (!subject || subject.startsWith("-"))
		throw new Error("Expected PR number or URL");
	return github([
		"pr",
		"view",
		subject,
		"--json",
		"url,number,state,isDraft,mergeable,headRefOid,headRefName,headRepository,headRepositoryOwner,baseRefName,statusCheckRollup,closingIssuesReferences",
	]);
}
export function repositoryMetadata() {
	return github(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
}
export function workflowSnapshot(repo, ref) {
	const files = github([
		"api",
		`repos/${repo}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`,
	]);
	return files
		.filter((file) => /\.ya?ml$/.test(file.path))
		.map((file) => ({
			path: file.path,
			sha: file.sha,
			content: github([
				"api",
				`repos/${repo}/contents/${file.path}?ref=${encodeURIComponent(ref)}`,
			]).content,
		}));
}
const oid = (value) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function reviewEvidenceErrors(ledger, current) {
	const errors = [];
	if (ledger.pendingScopeDecisions?.length)
		errors.push("Pending scope decisions");
	for (const key of ["head", "baseSha", "mergeBase"])
		if (!oid(current[key])) errors.push(`Invalid current ${key}`);
	for (const key of ["head", "baseRef", "baseSha", "mergeBase"])
		if (ledger.current?.[key] !== current[key])
			errors.push(`Evidence comparison differs at ${key}`);
	for (const axis of ["Standards", "Spec", "Defects"]) {
		const review = ledger.reviews?.filter((r) => r.axis === axis).at(-1);
		if (!review) {
			errors.push(`Missing ${axis} review`);
			continue;
		}
		for (const key of [
			"reviewer",
			"task",
			"baseRef",
			"diffCommand",
			"requirements",
			"scope",
		])
			if (typeof review[key] !== "string" || !review[key].trim())
				errors.push(`${axis}: missing ${key}`);
		for (const key of ["head", "baseSha", "mergeBase"])
			if (!oid(review[key])) errors.push(`${axis}: invalid ${key}`);
		if (
			review.outcome !== "clean" ||
			!Array.isArray(review.findings) ||
			review.findings.some(
				(f) =>
					f.disposition !== "resolved" &&
					!(
						f.disposition === "follow-up" &&
						/^https:\/\/github.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(f.url)
					),
			)
		)
			errors.push(`${axis}: required findings or review remain incomplete`);
		if (
			!review.artifacts?.length ||
			review.artifacts.some(
				(a) =>
					!path.isAbsolute(a.path ?? "") ||
					!/^[a-f0-9]{64}$/.test(a.sha256 ?? ""),
			)
		)
			errors.push(`${axis}: inspectable evidence artifacts required`);
		if (review.head !== current.head || review.baseRef !== current.baseRef) {
			const assessment = review.applicability;
			if (
				assessment?.head !== current.head ||
				assessment?.baseRef !== current.baseRef ||
				assessment?.reviewedHead !== review.head ||
				!assessment?.assessor ||
				!assessment?.rationale ||
				!assessment?.artifacts?.length
			)
				errors.push(`${axis}: explicit applicability assessment required`);
		}
	}
	return errors;
}
async function main() {
	const [action, subject, ...args] = process.argv.slice(2);
	if (action === "issue-preflight") {
		if (!subject || subject.startsWith("-"))
			throw new Error(
				"Expected issue number or URL and optional required status",
			);
		const issue = github([
			"issue",
			"view",
			subject,
			"--json",
			"id,url,state,assignees,blockedBy",
		]);
		const expectedRepository = github([
			"repo",
			"view",
			"--json",
			"nameWithOwner",
		]).nameWithOwner;
		if (
			!issue.url.startsWith(`https://github.com/${expectedRepository}/issues/`)
		)
			throw new Error("Issue belongs to another repository");
		const query = `query($id:ID!){node(id:$id){... on Issue{projectItems(first:100){nodes{project{number owner{... on User{login} ... on Organization{login}}} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}} pageInfo{hasNextPage}}}}}`;
		const connection = github([
			"api",
			"graphql",
			"-f",
			`query=${query}`,
			"-f",
			`id=${issue.id}`,
		]).data.node.projectItems;
		if (connection.pageInfo.hasNextPage)
			throw new Error("Project membership discovery is incomplete");
		const item = connection.nodes.find(
			(n) => n.project.number === 7 && n.project.owner.login === "rafaeltab",
		);
		issue.project = item
			? {
					owner: item.project.owner.login,
					number: item.project.number,
					status: item.fieldValueByName?.name,
				}
			: null;
		const login = github(["api", "user"]).login;
		const errors = issuePreflight(issue, login, args[0] ?? "In Progress");
		console.log(JSON.stringify({ issue, errors }, null, 2));
		if (errors.length) process.exitCode = 1;
	} else if (action === "pr-snapshot") {
		const pr = readPr(subject);
		const repo = repositoryMetadata();
		if (!pr.url.startsWith(`https://github.com/${repo.nameWithOwner}/pull/`))
			throw new Error("PR belongs to another repository");
		const liveBase = github([
			"api",
			`repos/${repo.nameWithOwner}/git/ref/heads/${encodeURIComponent(pr.baseRefName)}`,
		]).object.sha;
		const policySha = github([
			"api",
			`repos/${repo.nameWithOwner}/git/ref/heads/${encodeURIComponent(repo.defaultBranchRef.name)}`,
		]).object.sha;
		const policy = workflowSnapshot(repo.nameWithOwner, policySha);
		const merge = github([
			"api",
			`repos/${repo.nameWithOwner}/pulls/${pr.number}`,
		]).merge_commit_sha;
		const effective = merge
			? workflowSnapshot(repo.nameWithOwner, merge)
			: null;
		let assessment = args[0]
			? JSON.parse(fs.readFileSync(args[0], "utf8"))
			: null;
		const errors = prReadiness(pr, assessment?.expectedChecks);
		if (
			assessment &&
			(assessment.policySha !== policySha ||
				assessment.head !== pr.headRefOid ||
				assessment.baseRef !== pr.baseRefName ||
				!assessment.rationale)
		)
			errors.push(
				"CI assessment is not bound to current head, base branch and trusted policy",
			);
		if (assessment?.expectedChecks?.length === 0 && !assessment.noCiReason)
			errors.push(
				"An empty expected-check list requires an intentional CI exclusion explanation",
			);
		const result = { pr, liveBase, policySha, policy, effective, errors };
		const refreshed = readPr(subject);
		if (
			refreshed.headRefOid !== pr.headRefOid ||
			refreshed.baseRefName !== pr.baseRefName
		)
			result.errors.push("PR comparison changed during snapshot");
		console.log(JSON.stringify(result, null, 2));
		if (errors.length) process.exitCode = 1;
	} else if (action === "review-evidence") {
		const ledger = JSON.parse(fs.readFileSync(subject, "utf8"));
		const head = command("git", ["rev-parse", "HEAD"]).trim();
		const baseRef = ledger.current?.baseRef;
		if (!baseRef || baseRef.startsWith("-"))
			throw new Error("Expected comparison base ref");
		const baseSha = command("git", [
			"rev-parse",
			"--verify",
			`${baseRef}^{commit}`,
		]).trim();
		const mergeBase = command("git", ["merge-base", head, baseSha]).trim();
		const errors = reviewEvidenceErrors(ledger, {
			head,
			baseRef,
			baseSha,
			mergeBase,
		});
		for (const review of ledger.reviews ?? [])
			for (const artifact of [
				...(review.artifacts ?? []),
				...(review.applicability?.artifacts ?? []),
			]) {
				try {
					const data = fs.readFileSync(artifact.path);
					if (
						!data.length ||
						createHash("sha256").update(data).digest("hex") !== artifact.sha256
					)
						errors.push(`Changed or empty artifact ${artifact.path}`);
				} catch {
					errors.push(`Unavailable artifact ${artifact.path}`);
				}
			}
		console.log(
			JSON.stringify({ head, baseRef, baseSha, mergeBase, errors }, null, 2),
		);
		if (errors.length) process.exitCode = 1;
	} else if (action === "publish") {
		console.log(
			JSON.stringify(
				publishMarkdown(JSON.parse(fs.readFileSync(subject, "utf8"))),
				null,
				2,
			),
		);
	} else if (action === "feedback") {
		const pr = readPr(subject);
		const repo = repositoryMetadata();
		if (!pr.url.startsWith(`https://github.com/${repo.nameWithOwner}/pull/`))
			throw new Error("PR belongs to another repository");
		const feedback = githubFeedback(repo.nameWithOwner, pr.number);
		const refreshed = readPr(subject);
		const errors =
			refreshed.headRefOid === pr.headRefOid
				? []
				: ["PR head changed while collecting feedback"];
		console.log(
			JSON.stringify({ head: pr.headRefOid, ...feedback, errors }, null, 2),
		);
		if (errors.length) process.exitCode = 1;
	} else if (action === "push") {
		const input = JSON.parse(fs.readFileSync(subject, "utf8"));
		const pr = readPr(input.pr);
		const validation = JSON.parse(
			fs.readFileSync(input.validationFile, "utf8"),
		);
		if (
			!validation.checks?.length ||
			validation.checks.some((check) => check.exitCode !== 0)
		)
			throw new Error("Passing validation evidence is required");
		const head = command("git", ["rev-parse", "HEAD"]).trim();
		if (command("git", ["status", "--porcelain"]).trim())
			throw new Error("Commit or preserve local changes before publication");
		const result = guardedPush(
			{ ...input, pr, head, validatedHead: validation.head },
			command,
			() => readPr(input.pr),
		);
		console.log(JSON.stringify(result, null, 2));
	} else if (action === "verify-video") {
		const pr = readPr(subject);
		const parsed = new URL(pr.url);
		const repo = parsed.pathname.split("/").slice(1, 3).join("/");
		const body = github([
			"api",
			`repos/${repo}/issues/${pr.number}`,
			"-H",
			"Accept: application/vnd.github.full+json",
		]).body_html;
		const videos = [];
		for (const url of videoReferences(body ?? ""))
			videos.push(await verifyVideo(url));
		console.log(JSON.stringify({ pr: pr.url, videos }, null, 2));
	} else
		throw new Error("Expected issue-preflight, pr-snapshot or review-evidence");
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
