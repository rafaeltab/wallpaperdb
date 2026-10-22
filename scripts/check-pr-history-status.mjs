import { spawnSync } from "node:child_process";

const repository = process.env.GITHUB_REPOSITORY;
const [number, ...extra] = process.argv.slice(2);
const baseRef = process.env.HISTORY_BASE;
const checker = new URL("./check-pr-history.mjs", import.meta.url).pathname;

function command(program, args, input) {
	const result = spawnSync(program, args, {
		encoding: "utf8",
		input,
		timeout: 60_000,
		maxBuffer: 16_777_216,
	});
	if (result.error) throw result.error;
	return result;
}

function api(endpoint, body) {
	const result = command(
		"gh",
		["api", ...(body ? ["--method", "POST", "--input", "-"] : []), endpoint],
		body ? JSON.stringify(body) : undefined,
	);
	if (result.status !== 0)
		throw new Error(result.stderr || "GitHub request failed");
	return JSON.parse(result.stdout);
}

function comparison(pr) {
	return `${pr.head.sha}:${pr.base.ref}:${pr.base.sha}`;
}

function validate(pr) {
	if (
		!Number.isSafeInteger(pr.number) ||
		pr.number <= 0 ||
		!/^[0-9a-f]{40}$/.test(pr.head.sha) ||
		!/^[0-9a-f]{40}$/.test(pr.base.sha)
	)
		throw new Error("Invalid authenticated PR comparison metadata");
}

function status(pr, state, detail) {
	api(`repos/${repository}/statuses/${pr.head.sha}`, {
		state,
		context: `PR history #${pr.number}`,
		description: `Base ${pr.base.sha.slice(0, 12)}: ${detail}`,
	});
}

function currentPullRequest(number) {
	const pr = api(`repos/${repository}/pulls/${number}`);
	if (pr.state === "open") {
		const base = api(
			`repos/${repository}/git/ref/heads/${encodeURIComponent(pr.base.ref)}`,
		);
		pr.base.sha = base.object.sha;
		validate(pr);
	}
	return pr;
}

function check(number, failRun = false) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const pr = currentPullRequest(number);
		if (pr.state !== "open" || (baseRef && pr.base.ref !== baseRef)) return;
		validate(pr);
		status(pr, "pending", "checking branch history");
		const fetched = command("git", [
			"fetch",
			"--no-tags",
			"origin",
			pr.base.sha,
			pr.head.sha,
		]);
		let result;
		if (fetched.status !== 0) result = fetched;
		else
			result = command(process.execPath, [checker, pr.base.sha, pr.head.sha]);
		const current = currentPullRequest(number);
		if (current.state !== "open") return;
		if (comparison(current) !== comparison(pr)) continue;
		status(
			pr,
			result.status === 0 ? "success" : "failure",
			result.status === 0
				? "branch adds changes without merge commits"
				: "history check failed; inspect workflow logs",
		);
		console.log(
			`PR #${pr.number}, ${comparison(pr)}: ${result.stdout || result.stderr}`,
		);
		if (failRun && result.status !== 0) process.exitCode = 1;
		return;
	}
	throw new Error(
		`PR #${number} changed comparison repeatedly; no final history status published`,
	);
}

try {
	if (
		!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
		extra.length ||
		(number && !/^[1-9]\d*$/.test(number)) ||
		(!number && !baseRef)
	)
		throw new Error(
			"Set GITHUB_REPOSITORY and provide a PR number or HISTORY_BASE",
		);
	if (number) check(Number(number), true);
	else {
		const listed = command("gh", [
			"api",
			"--paginate",
			"--slurp",
			`repos/${repository}/pulls?state=open&base=${encodeURIComponent(baseRef)}&per_page=100`,
		]);
		if (listed.status !== 0)
			throw new Error(listed.stderr || "Could not list open PRs");
		for (const pr of JSON.parse(listed.stdout).flat()) {
			validate(pr);
			check(pr.number);
		}
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
