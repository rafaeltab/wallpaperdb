interface Push {
	expectedHead: string;
	head: string;
	validatedHead: string;
	rewriteAuthorized?: unknown;
	pr: Pick<
		import("./lib/agent-types.ts").PullRequest,
		| "state"
		| "headRefOid"
		| "headRefName"
		| "headRepositoryOwner"
		| "headRepository"
	> & { url?: string };
}
import { command } from "./lib/agent-command.ts";
const oid = (value: unknown) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function guardedPush(
	input: Push,
	run = command,
	refresh: () => Push["pr"],
) {
	const { pr, expectedHead, head, validatedHead } = input;
	if (
		input.rewriteAuthorized !== undefined &&
		typeof input.rewriteAuthorized !== "boolean"
	)
		throw new Error("Rewrite authorization must be a boolean");
	if (!oid(expectedHead) || !oid(head))
		throw new Error("Expected full hexadecimal commit IDs");
	if (head !== validatedHead)
		throw new Error("Current head has not been validated");
	if (pr.state !== "OPEN") throw new Error("PR must remain open");
	if (pr.headRefOid !== expectedHead)
		throw new Error("PR head changed from the recorded expectation");
	const ref = `refs/heads/${pr.headRefName}`;
	run("git", ["check-ref-format", ref]);
	const owner = pr.headRepositoryOwner?.login;
	const repo = pr.headRepository?.name;
	if (
		!/^[a-zA-Z0-9_.-]+$/.test(owner ?? "") ||
		!/^[a-zA-Z0-9_.-]+$/.test(repo ?? "")
	)
		throw new Error("Invalid authenticated head repository");
	if (!input.rewriteAuthorized) {
		try {
			run("git", ["merge-base", "--is-ancestor", expectedHead, head]);
		} catch {
			throw new Error(
				"Published history rewrite requires existing user authorization",
			);
		}
	}
	const current = refresh();
	if (
		current.state !== "OPEN" ||
		current.headRefOid !== expectedHead ||
		current.headRefName !== pr.headRefName ||
		current.headRepositoryOwner?.login !== owner ||
		current.headRepository?.name !== repo
	)
		throw new Error("PR changed before publication");
	const remote = `https://github.com/${owner}/${repo}.git`;
	run("git", [
		"push",
		`--force-with-lease=${ref}:${expectedHead}`,
		"--",
		remote,
		`${head}:${ref}`,
	]);
	const published = refresh();
	if (published.headRefOid !== head)
		throw new Error("Published head readback differs");
	return { head, url: published.url ?? pr.url };
}
