import { execFileSync } from "node:child_process";
import path from "node:path";
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
	} else throw new Error("Expected issue-preflight <issue> [status]");
}
if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
