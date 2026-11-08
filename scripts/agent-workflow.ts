import type {
	PullRequest,
	Issue,
	Check,
	Workflow,
	CiAssessment,
	Comparison,
	ReviewLedger,
	ValidationRecord,
	Exclusion,
} from "./lib/agent-types.ts";
import { recordCheck, sourceSnapshot } from "./record-check.ts";
import { verifyStackReadiness } from "./stack-readiness.ts";
import { videoReferences, verifyVideo } from "./verify-video.ts";
import { guardedPush } from "./guarded-push.ts";
import { reportToolingIncident } from "./report-tooling-incident.ts";
import { githubFeedback } from "./collect-feedback.ts";
import { publishMarkdown } from "./publish-markdown.ts";
export { publishMarkdown };
import { command, github } from "./lib/agent-command.ts";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const repository = fileURLToPath(new URL("../", import.meta.url));
export { command, github };
export function issuePreflight(
	issue: Issue,
	login: string,
	status: string,
	verifiedBlockers = new Set<string>(),
) {
	const errors: string[] = [];
	if (issue.state !== "OPEN") errors.push("Issue must be open");
	if (!issue.assignees?.some((a) => a.login === login))
		errors.push(`Issue must be assigned to ${login}`);
	if (issue.project?.owner !== "rafaeltab" || issue.project?.number !== 7)
		errors.push("Issue must belong to rafaeltab project 7");
	if (issue.project?.status !== status)
		errors.push(`Issue status must be ${status}`);
	if (issue.blockedBy?.totalCount !== issue.blockedBy?.nodes?.length)
		errors.push("Issue dependency discovery is incomplete");
	if (
		issue.blockedBy?.nodes?.some(
			(b) => b.state !== "CLOSED" && !verifiedBlockers.has(b.url ?? ""),
		)
	)
		errors.push("Open blockers require a verified stack-readiness assessment");
	return errors;
}
export function prReadiness(
	pr: Pick<PullRequest, "state" | "mergeable" | "statusCheckRollup">,
	expectedChecks: string[] | null | undefined,
	inapplicableChecks: Exclusion[] = [],
) {
	const errors: string[] = [];
	if (pr.state !== "OPEN") errors.push("PR is not open");
	if (pr.mergeable !== "MERGEABLE")
		errors.push("Merge-conflict status is not verified");
	if (!Array.isArray(expectedChecks))
		errors.push("CI applicability requires a recorded policy assessment");
	const checks = pr.statusCheckRollup ?? [];
	if (!Array.isArray(inapplicableChecks)) {
		errors.push("Conditional exclusions must be an array");
		inapplicableChecks = [];
	}
	for (const name of expectedChecks ?? [])
		if (!checks.some((check) => (check.name ?? check.context) === name))
			errors.push(`Missing expected check ${name}`);
	for (const check of checks) {
		if (check.advisory === true) continue;
		const name = check.name ?? check.context;
		const excluded = inapplicableChecks.find(
			(entry) =>
				entry.name === name && entry.policyPath && entry.rationale?.trim(),
		);
		if (
			excluded &&
			check.conclusion === "SKIPPED" &&
			!expectedChecks?.includes(name ?? "")
		)
			continue;
		if ((check.conclusion ?? check.state) !== "SUCCESS")
			errors.push(
				`Check ${check.name ?? check.context} is ${check.conclusion || check.state || check.status || "unknown"}`,
			);
	}
	return errors;
}
export function ciAssessmentErrors(
	assessment: CiAssessment | null,
	snapshot: {
		policySha: string;
		head: string;
		baseRef: string;
		mergeSha?: string | null;
		policy: Workflow[];
	},
) {
	const errors: string[] = [];
	if (!assessment) return errors;
	if (
		assessment.policySha !== snapshot.policySha ||
		assessment.head !== snapshot.head ||
		assessment.baseRef !== snapshot.baseRef ||
		!assessment.rationale?.trim()
	)
		errors.push(
			"CI assessment is not bound to current head, base branch and trusted policy",
		);
	if (assessment.expectedChecks?.length === 0 && !assessment.noCiReason?.trim())
		errors.push(
			"An empty expected-check list requires an intentional CI exclusion explanation",
		);
	if (assessment.inapplicableChecks !== undefined) {
		if (!Array.isArray(assessment.inapplicableChecks))
			return [...errors, "Conditional exclusions must be an array"];
		if (
			assessment.inapplicableChecks.length &&
			(!snapshot.mergeSha || assessment.mergeSha !== snapshot.mergeSha)
		)
			errors.push(
				"Conditional exclusions must bind the effective merge configuration",
			);
		for (const excluded of assessment.inapplicableChecks)
			if (
				!excluded.name?.trim() ||
				!excluded.rationale?.trim() ||
				!snapshot.policy.some((file) => file.path === excluded.policyPath) ||
				assessment.expectedChecks?.includes(excluded.name)
			)
				errors.push(
					"Conditional exclusion requires an inapplicable check, trusted workflow path and rationale",
				);
	}
	return errors;
}
export function markAdvisoryChecks<
	T extends { headRefOid: string; statusCheckRollup?: Check[] },
>(
	pr: T,
	repo: string,
	policy: Workflow[],
	lookup: (args: readonly string[]) => {
		path?: string;
		head_sha?: string;
	} = github,
) {
	const runs = new Map<string, { path?: string; head_sha?: string }>();
	const pilotExists = policy.some(
		(file) => file.path === ".github/workflows/mutation.yml",
	);
	for (const check of pr.statusCheckRollup ?? []) {
		if (!check.detailsUrl) continue;
		const parsed = new URL(check.detailsUrl);
		const match = parsed.pathname.match(
			/^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/job\/\d+$/,
		);
		if (parsed.origin !== "https://github.com" || match?.[1] !== repo) continue;
		const id = match[2];
		if (!runs.has(id))
			runs.set(id, lookup(["api", `repos/${repo}/actions/runs/${id}`]));
		const run = runs.get(id)!;
		check.advisory =
			pilotExists &&
			run.path?.split("@")[0] === ".github/workflows/mutation.yml" &&
			run.head_sha === pr.headRefOid;
	}
	return pr;
}
export function readPr(subject: string | undefined): PullRequest {
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
export function repositoryMetadata(): {
	nameWithOwner: string;
	defaultBranchRef: { name: string };
} {
	return github(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
}
export function workflowSnapshot(repo: string, ref: string) {
	const files = github<Workflow[]>([
		"api",
		`repos/${repo}/contents/.github/workflows?ref=${encodeURIComponent(ref)}`,
	]);
	return files
		.filter((file) => /\.ya?ml$/.test(file.path))
		.map((file) => ({
			path: file.path,
			sha: file.sha,
			content: github<{ content: string }>([
				"api",
				`repos/${repo}/contents/${file.path}?ref=${encodeURIComponent(ref)}`,
			]).content,
		}));
}
const oid = (value: unknown) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function reviewEvidenceErrors(
	ledger: ReviewLedger,
	current: Comparison,
) {
	const errors: string[] = [];
	if (!Array.isArray(ledger.automationIncidents))
		errors.push(
			"Explicit automationIncidents disclosure is required, including an empty array when none occurred",
		);
	else if (
		ledger.automationIncidents.some(
			(incident) =>
				!incident ||
				!/^https:\/\/github\.com\/rafaeltab\/wallpaperdb\/issues\/\d+$/.test(
					incident.url,
				) ||
				incident.userNotified !== true ||
				typeof incident.outcome !== "string" ||
				!incident.outcome.trim(),
		)
	)
		errors.push(
			"Automation incidents require a repository issue, explicit user notification and outcome",
		);
	if (ledger.pendingScopeDecisions?.length)
		errors.push("Pending scope decisions");
	for (const key of ["head", "baseSha", "mergeBase"] as const)
		if (!oid(current[key])) errors.push(`Invalid current ${key}`);
	for (const key of ["head", "baseRef", "baseSha", "mergeBase"] as const)
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
		] as const)
			if (typeof review[key] !== "string" || !review[key].trim())
				errors.push(`${axis}: missing ${key}`);
		for (const key of ["head", "baseSha", "mergeBase"] as const)
			if (!oid(review[key])) errors.push(`${axis}: invalid ${key}`);
		if (
			review.outcome !== "clean" ||
			!Array.isArray(review.findings) ||
			review.findings.some(
				(f) =>
					f.disposition !== "resolved" &&
					!(
						f.disposition === "follow-up" &&
						/^https:\/\/github.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(
							f.url ?? "",
						)
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
function requiredSubject(subject: string | undefined): string {
	if (!subject) throw new Error("Expected a subject or input file");
	return subject;
}
async function main() {
	const [action, subject, ...args] = process.argv.slice(2);
	if (action === "issue-preflight") {
		if (!subject || subject.startsWith("-"))
			throw new Error(
				"Expected issue number or URL and optional required status",
			);
		const issue = github<Issue & { id: string }>([
			"issue",
			"view",
			subject,
			"--json",
			"id,url,state,assignees,blockedBy",
		]);
		const expectedRepository = github<{ nameWithOwner: string }>([
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
		const connection = github<{
			data: {
				node: {
					projectItems: {
						pageInfo: { hasNextPage: boolean };
						nodes: {
							project: { number: number; owner: { login: string } };
							fieldValueByName?: { name: string };
						}[];
					};
				};
			};
		}>(["api", "graphql", "-f", `query=${query}`, "-f", `id=${issue.id}`]).data
			.node.projectItems;
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
		const login = github<{ login: string }>(["api", "user"]).login;
		const head = command("git", ["rev-parse", "HEAD"]).trim();
		const verifiedBlockers = args[1]
			? verifyStackReadiness(JSON.parse(fs.readFileSync(args[1], "utf8")), {
					head,
					issue,
					repository: expectedRepository,
					readPr,
					reviewErrors: reviewEvidenceErrors,
					readIssue(url) {
						const number = url.match(
							new RegExp(
								`^https://github\\.com/${expectedRepository}/issues/(\\d+)$`,
							),
						)?.[1];
						if (!number)
							throw new Error("Blocker issue belongs to another repository");
						const item = github<{
							html_url: string;
							state: string;
							body?: string;
							comments?: { body?: string }[];
						}>(["api", `repos/${expectedRepository}/issues/${number}`]);
						item.comments = github<{ body?: string }[][]>([
							"api",
							`repos/${expectedRepository}/issues/${number}/comments`,
							"--paginate",
							"--slurp",
						]).flat();
						return { ...item, url: item.html_url };
					},
				})
			: new Set<string>();
		const errors = issuePreflight(
			issue,
			login,
			args[0] ?? "In Progress",
			verifiedBlockers,
		);
		if (command("git", ["rev-parse", "HEAD"]).trim() !== head)
			errors.push("Local head changed during preflight");
		console.log(
			JSON.stringify(
				{ issue, verifiedBlockers: [...verifiedBlockers], errors },
				null,
				2,
			),
		);
		if (errors.length) process.exitCode = 1;
	} else if (action === "pr-snapshot") {
		const pr = readPr(subject);
		const repo = repositoryMetadata();
		if (!pr.url.startsWith(`https://github.com/${repo.nameWithOwner}/pull/`))
			throw new Error("PR belongs to another repository");
		const liveBase = github<{ object: { sha: string } }>([
			"api",
			`repos/${repo.nameWithOwner}/git/ref/heads/${encodeURIComponent(pr.baseRefName)}`,
		]).object.sha;
		const policySha = github<{ object: { sha: string } }>([
			"api",
			`repos/${repo.nameWithOwner}/git/ref/heads/${encodeURIComponent(repo.defaultBranchRef.name)}`,
		]).object.sha;
		const policy = workflowSnapshot(repo.nameWithOwner, policySha);
		const merge = github<{ merge_commit_sha: string | null }>([
			"api",
			`repos/${repo.nameWithOwner}/pulls/${pr.number}`,
		]).merge_commit_sha;
		const effective = merge
			? workflowSnapshot(repo.nameWithOwner, merge)
			: null;
		const assessment: CiAssessment | null = args[0]
			? JSON.parse(fs.readFileSync(args[0], "utf8"))
			: null;
		markAdvisoryChecks(pr, repo.nameWithOwner, policy);
		const errors = [
			...prReadiness(
				pr,
				assessment?.expectedChecks,
				assessment?.inapplicableChecks,
			),
			...ciAssessmentErrors(assessment, {
				policySha,
				head: pr.headRefOid,
				baseRef: pr.baseRefName,
				mergeSha: merge,
				policy,
			}),
		];
		const result = {
			pr,
			liveBase,
			policySha,
			policy,
			mergeSha: merge,
			effective,
			errors,
		};
		const refreshed = readPr(subject);
		if (
			refreshed.headRefOid !== pr.headRefOid ||
			refreshed.baseRefName !== pr.baseRefName
		)
			result.errors.push("PR comparison changed during snapshot");
		console.log(JSON.stringify(result, null, 2));
		if (errors.length) process.exitCode = 1;
	} else if (action === "review-evidence") {
		const ledger: ReviewLedger = JSON.parse(
			fs.readFileSync(requiredSubject(subject), "utf8"),
		);
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
		if (!errors.length)
			for (const incident of ledger.automationIncidents ?? []) {
				const issue = github<{
					state: string;
					assignees: { login: string }[];
					labels: { name: string }[];
				}>([
					"issue",
					"view",
					incident.url,
					"--repo",
					"rafaeltab/wallpaperdb",
					"--json",
					"state,assignees,labels",
				]);
				if (
					issue.state !== "OPEN" ||
					!issue.assignees.some(({ login }) => login === "rafaeltab") ||
					!issue.labels.some(({ name }) => name === "automation-impact")
				)
					errors.push(
						`Automation incident is not an open, labeled report assigned to the user: ${incident.url}`,
					);
			}
		console.log(
			JSON.stringify({ head, baseRef, baseSha, mergeBase, errors }, null, 2),
		);
		if (errors.length) process.exitCode = 1;
	} else if (action === "publish") {
		console.log(
			JSON.stringify(
				publishMarkdown(
					JSON.parse(fs.readFileSync(requiredSubject(subject), "utf8")),
				),
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
		const input: {
			pr: string;
			validationFile: string;
			expectedHead: string;
			rewriteAuthorized?: unknown;
		} = JSON.parse(fs.readFileSync(requiredSubject(subject), "utf8"));
		const pr = readPr(input.pr);
		const validation: ValidationRecord = JSON.parse(
			fs.readFileSync(input.validationFile, "utf8"),
		);
		if (
			!validation.checks?.length ||
			validation.checks.some((check) => check.exitCode !== 0)
		)
			throw new Error("Passing validation evidence is required");
		const head = command("git", ["rev-parse", "HEAD"]).trim();
		if (
			validation.expectationMet !== true ||
			validation.stable !== true ||
			validation.sourceDigest !== sourceSnapshot().sourceDigest
		)
			throw new Error(
				"Validation is incomplete or does not match the current source",
			);
		for (const check of validation.checks) {
			if (
				!check.artifact ||
				createHash("sha256")
					.update(fs.readFileSync(check.artifact.path))
					.digest("hex") !== check.artifact.sha256
			)
				throw new Error("Validation log is missing or changed");
		}
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
		const body = github<{ body_html?: string; body?: string }>([
			"api",
			`repos/${repo}/issues/${pr.number}`,
			"-H",
			"Accept: application/vnd.github.full+json",
		]);
		const videos = [];
		for (const url of videoReferences(body.body_html ?? "", body.body ?? ""))
			videos.push(await verifyVideo(url));
		console.log(JSON.stringify({ pr: pr.url, videos }, null, 2));
	} else if (action === "report-tooling-incident") {
		const result = reportToolingIncident(
			JSON.parse(fs.readFileSync(requiredSubject(subject), "utf8")),
		);
		console.log(result.userNotice);
		console.log(JSON.stringify(result, null, 2));
	} else if (action === "record-check") {
		const result = recordCheck(
			JSON.parse(fs.readFileSync(requiredSubject(subject), "utf8")),
		);
		console.log(JSON.stringify(result, null, 2));
		if (!result.expectationMet) process.exitCode = 1;
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
