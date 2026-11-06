import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
export function command(program, args, options = {}) {
	return execFileSync(program, args, {
		cwd: repository,
		encoding: "utf8",
		timeout: 60_000,
		maxBuffer: 32 * 1024 * 1024,
		...options,
	});
}
export function github(args) {
	const value = JSON.parse(command("gh", args));
	if (value.errors?.length)
		throw new Error(`GitHub GraphQL error: ${JSON.stringify(value.errors)}`);
	return value;
}
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
	} else throw new Error("Expected issue-preflight or pr-snapshot");
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
