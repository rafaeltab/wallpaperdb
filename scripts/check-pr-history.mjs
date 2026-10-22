import { spawnSync } from "node:child_process";

function git(...args) {
	const result = spawnSync("git", args, { encoding: "utf8" });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
	return result.stdout.trim();
}

try {
	const [baseRef = "origin/main", headRef = "HEAD", ...extra] =
		process.argv.slice(2);
	if (extra.length)
		throw new Error("Usage: check-pr-history.mjs [base [head]]");
	const base = git(
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${baseRef}^{commit}`,
	);
	const head = git(
		"rev-parse",
		"--verify",
		"--end-of-options",
		`${headRef}^{commit}`,
	);
	const merges = git("rev-list", "--min-parents=2", `${base}..${head}`);
	if (merges)
		throw new Error(
			`PR history contains merge commits. This repository uses rebase merging; resolve the branch history before publication.\n${merges}`,
		);
	const mergedTree = git("merge-tree", "--write-tree", base, head);
	if (!git("diff", "--name-only", `${base}^{tree}`, mergedTree, "--"))
		throw new Error(
			"PR contents already match its base after applying the branch. Verify whether the work has landed instead of reporting it merge-ready.",
		);
	console.log(
		"PR history is linear and its contents differ from the base. Verify GitHub rebaseable status before handoff.",
	);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
