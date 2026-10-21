import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { importBaseline } from "./mutation-state.mjs";

/** Only successful default-branch runs may seed another checkout. */
export function downloadBaseline(context) {
	const temp = mkdtempSync(join(tmpdir(), "mutation-download-"));
	const gh = (...args) =>
		execFileSync("gh", args, {
			cwd: context.root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 15_000,
		});
	try {
		const branch = JSON.parse(gh("repo", "view", "--json", "defaultBranchRef"))
			.defaultBranchRef.name;
		const runs = JSON.parse(
			gh(
				"run",
				"list",
				"--workflow",
				"mutation.yml",
				"--branch",
				branch,
				"--status",
				"success",
				"--limit",
				"5",
				"--json",
				"databaseId,event",
			),
		);
		for (const run of runs.filter((r) =>
			["workflow_dispatch", "push", "schedule"].includes(r.event),
		)) {
			const dir = join(temp, String(run.databaseId));
			try {
				gh(
					"run",
					"download",
					String(run.databaseId),
					"--name",
					`mutation-baseline-${basename(context.workspace)}-${context.suite}`,
					"--dir",
					dir,
				);
				const file = join(dir, "checkpoint.json");
				if (existsSync(file) && importBaseline(context, file)) return true;
			} catch {
				/* Expired or missing artifact. Try the next successful run. */
			}
		}
	} catch {
		console.warn(
			"No compatible CI baseline available. Continuing with local state; --offline skips GitHub.",
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
	return false;
}
