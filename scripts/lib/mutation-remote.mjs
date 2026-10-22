import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
	mkdtempSync,
	existsSync,
	rmSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBaseline } from "./mutation-state.mjs";
import { importCheckpoint } from "./mutation-checkpoint.mjs";

const execFileAsync = promisify(execFile);
const events = ["schedule", "workflow_dispatch", "push"];
const runListArgs = (branch, event) => [
	"run",
	"list",
	"--workflow",
	"mutation.yml",
	"--branch",
	branch,
	"--status",
	"success",
	"--event",
	event,
	"--limit",
	"5",
	"--json",
	"databaseId,event,createdAt",
];
function newestTrustedRuns(runs) {
	return [
		...new Map(
			runs
				.filter((run) => events.includes(run.event))
				.map((run) => [run.databaseId, run]),
		).values(),
	]
		.sort(
			(a, b) =>
				(b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
				b.databaseId - a.databaseId,
		)
		.slice(0, 5);
}
function trustedRuns(gh, branch) {
	return newestTrustedRuns(
		events.flatMap((event) => JSON.parse(gh(...runListArgs(branch, event)))),
	);
}

/** One repository artifact transfer, with an aggregate deadline outside execution. */
export async function downloadCheckpoint(
	root,
	jobs,
	invocationDeadline = Infinity,
	signal,
) {
	const importedStages = new Set();
	let scheduling;
	let validArtifact = false;
	await visitCheckpoints(root, invocationDeadline, signal, (file) => {
		const imported = importCheckpoint(root, jobs, file);
		validArtifact = true;
		if (imported.importedStages && !scheduling)
			scheduling = imported.scheduling;
		for (const job of jobs)
			if (imported.stages[job.id]?.key === job.context.key)
				importedStages.add(job.id);
		// Keep searching for compatible stages omitted by a newer artifact.
		return false;
	});
	if (validArtifact) return { importedStages: importedStages.size, scheduling };
	if (signal?.aborted) return false;
	console.warn(
		"No valid default-branch checkpoint available within 45 seconds; bounded cold fallback",
	);
	return false;
}

async function visitCheckpoints(root, invocationDeadline, signal, visit) {
	const temp = mkdtempSync(join(tmpdir(), "mutation-repository-download-"));
	const deadline = Math.min(performance.now() + 45_000, invocationDeadline);
	const gh = async (...args) => {
		signal?.throwIfAborted();
		if (performance.now() >= deadline)
			throw new Error("Checkpoint transfer deadline expired");
		const request = execFileAsync("gh", args, {
			cwd: root,
			encoding: "utf8",
			signal,
			killSignal: "SIGKILL",
			timeout: Math.max(
				1,
				Math.min(10_000, Math.floor(deadline - performance.now())),
			),
		});
		// Abort can reject before the child is reaped and its pipes are closed.
		const closed = new Promise((resolve) =>
			request.child.once("close", resolve),
		);
		try {
			return (await request).stdout;
		} finally {
			await closed;
		}
	};
	try {
		const repo = JSON.parse(
			await gh("repo", "view", "--json", "defaultBranchRef"),
		);
		const runs = [];
		for (const event of events)
			runs.push(
				...JSON.parse(
					await gh(...runListArgs(repo.defaultBranchRef.name, event)),
				),
			);
		for (const run of newestTrustedRuns(runs)) {
			if (performance.now() >= deadline || signal?.aborted) break;
			try {
				const dir = join(temp, String(run.databaseId));
				await gh(
					"run",
					"download",
					String(run.databaseId),
					"--name",
					"mutation-checkpoint",
					"--dir",
					dir,
				);
				if (visit(join(dir, "checkpoint.json"))) return true;
			} catch {
				/* Expired, missing or invalid artifacts do not prevent a bounded cold run. */
			}
		}
	} catch {
		/* Offline and inaccessible repositories use local progress. */
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
	return false;
}

function importStandalone(context, file) {
	if (!existsSync(file)) return false;
	const checkpoint = JSON.parse(readFileSync(file, "utf8"));
	const stage = checkpoint.stages
		? checkpoint.stages[`${context.workspace}:${context.suite}`]
		: checkpoint;
	if (!stage) return false;
	// Accept both the cumulative repository envelope and standalone snapshots.
	const selected = `${file}.stage.json`;
	writeFileSync(selected, JSON.stringify(stage));
	return importBaseline(context, selected);
}

export async function downloadBaselineCancellable(
	context,
	invocationDeadline = Infinity,
	signal,
) {
	const imported = await visitCheckpoints(
		context.root,
		invocationDeadline,
		signal,
		(file) => importStandalone(context, file),
	);
	if (!imported && !signal?.aborted)
		console.warn(
			"No compatible CI baseline available. Continuing with local state; --offline skips GitHub.",
		);
	return imported;
}

/** Only successful default-branch runs may seed another checkout. */
export function downloadBaseline(context, invocationDeadline = Infinity) {
	const temp = mkdtempSync(join(tmpdir(), "mutation-download-"));
	const deadline = Math.min(performance.now() + 45_000, invocationDeadline);
	const gh = (...args) => {
		if (performance.now() >= deadline)
			throw new Error("Checkpoint transfer deadline expired");
		return execFileSync("gh", args, {
			cwd: context.root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: Math.max(
				1,
				Math.min(10_000, Math.floor(deadline - performance.now())),
			),
		});
	};
	try {
		const branch = JSON.parse(gh("repo", "view", "--json", "defaultBranchRef"))
			.defaultBranchRef.name;
		const runs = trustedRuns(gh, branch);
		for (const run of runs) {
			if (performance.now() >= deadline) break;
			const dir = join(temp, String(run.databaseId));
			try {
				gh(
					"run",
					"download",
					String(run.databaseId),
					"--name",
					"mutation-checkpoint",
					"--dir",
					dir,
				);
				if (importStandalone(context, join(dir, "checkpoint.json")))
					return true;
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
