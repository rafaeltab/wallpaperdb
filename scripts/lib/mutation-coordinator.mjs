import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { catalog } from "./mutation-catalog.mjs";
import { git, restoreBaseline } from "./mutation-state.mjs";
import {
	atomicJson,
	atomicCopy,
	importCheckpoint,
	publishCheckpoint,
	restoreScheduling,
} from "./mutation-checkpoint.mjs";
import { runStage } from "./mutation-stage.mjs";
import {
	combineStages,
	hash,
	resultCounts,
	resultIndex,
	isProcessed,
} from "./mutation-results.mjs";
import { downloadCheckpoint } from "./mutation-remote.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";
import { runBounded } from "./mutation-process.mjs";

function current(job, readBaseline) {
	if (!job) return null;
	const state = readBaseline(job.context);
	if (state?.inputDigest !== job.context.inputDigest) return null;
	return {
		...state,
		report: {
			...state.report,
			files: Object.fromEntries(
				Object.entries(state.report.files).filter(
					([file]) =>
						(state.provenance?.[file] ?? state.inputDigest) ===
						job.context.inputDigest,
				),
			),
		},
	};
}
function summarize(jobs, selected, evidenceJobs, readBaseline) {
	const workspaces = [];
	for (const workspace of [...new Set(jobs.map((job) => job.workspace))]) {
		const unit = evidenceJobs.find(
			(job) => job.workspace === workspace && job.suite === "unit",
		);
		const integration = jobs.find(
			(job) => job.workspace === workspace && job.suite === "integration",
		);
		const u = current(unit, readBaseline),
			i = current(integration, readBaseline);
		const applicable = (file) =>
			Boolean(integration?.sourceFiles.includes(file));
		const targets = [
			...new Set(
				jobs
					.filter((job) => job.workspace === workspace)
					.flatMap((job) => (selected ? job.mutate : job.sourceFiles)),
			),
		];
		const mutants = combineStages(
			u?.report,
			i?.report,
			applicable,
			Boolean(unit),
		).filter((mutant) => targets.includes(mutant.file));
		// No report is not an empty, complete baseline. Discovery must cover every
		// eligible file, including files with zero generated mutants.
		const discovered = [unit ?? integration].filter(Boolean).every((job) => {
			const state = current(job, readBaseline);
			const expected = targets;
			return (
				!expected.length ||
				(state?.discovery &&
					expected.every((file) => state.discovery.selected.includes(file)))
			);
		});
		const counts = resultCounts(mutants);
		workspaces.push({
			workspace,
			...counts,
			eligibleSourceFiles: targets.length,
			discovered,
			complete: discovered && counts.pending === 0,
			inputs: Object.fromEntries(
				[unit, integration].filter(Boolean).map((job) => [
					job.suite,
					{
						key: job.context.key,
						inputDigest: job.context.inputDigest,
						fresh: Boolean(current(job, readBaseline)),
					},
				]),
			),
			staleFiles: Object.fromEntries(
				[unit, integration].filter(Boolean).map((job) => {
					const state = readBaseline(job.context);
					return [
						job.suite,
						Object.keys(state?.report.files ?? {}).filter(
							(file) =>
								(state.provenance?.[file] ?? state.inputDigest) !==
								job.context.inputDigest,
						),
					];
				}),
			),
			mutants,
		});
	}
	return workspaces;
}

export async function coordinate() {
	const invocationStart = performance.now();
	const { values } = parseArgs({
		options: {
			package: { type: "string" },
			suite: { type: "string" },
			scope: { type: "string", default: "changed" },
			base: { type: "string", default: "origin/main" },
			budget: {
				type: "string",
				default: process.env.GITHUB_ACTIONS ? "900" : "60",
			},
			quantum: { type: "string", default: "120" },
			baseline: { type: "string" },
			offline: { type: "boolean", default: false },
			inventory: { type: "boolean", default: false },
			files: { type: "string" },
		},
	});
	if (!["changed", "all"].includes(values.scope))
		throw new Error("--scope must be changed or all");
	if (values.suite && !["unit", "integration"].includes(values.suite))
		throw new Error("Invalid --suite");
	const budgetMs = Number(values.budget) * 1000,
		quantumMs = Number(values.quantum) * 1000;
	const packages = values.package?.split(",");
	if (packages?.some((name) => !/^[a-z0-9-]+$/.test(name)))
		throw new Error("Invalid --package selection");
	if (!Number.isFinite(budgetMs) || budgetMs < 1000 || budgetMs > 3_600_000)
		throw new Error("--budget must be 1..3600 seconds");
	if (!Number.isFinite(quantumMs) || quantumMs < 1000 || quantumMs > 600_000)
		throw new Error("--quantum must be 1..600 seconds");
	const publicationReserveMs = Math.min(15_000, Math.floor(budgetMs / 5));
	if (
		!process.env.GITHUB_ACTIONS &&
		!values.inventory &&
		(!values.package || packages.length !== 1 || budgetMs > 300_000)
	)
		throw new Error(
			"Local diagnostics require --package and a budget of at most 300 seconds including shutdown. Build baselines in CI.",
		);
	const root = git(process.cwd(), "rev-parse", "--show-toplevel");
	const full = catalog(root, {
		scope: values.inventory ? "all" : values.scope,
		base: values.base,
	});
	if (values.inventory) {
		console.log(JSON.stringify(full.inventory, null, 2));
		return 0;
	}
	for (const name of packages ?? [])
		if (!full.jobs.some((job) => job.workspace.split("/").at(-1) === name))
			throw new Error(
				`No enabled stages for ${name}; see mutation.inventory.json`,
			);
	const jobs = full.jobs
		.filter(
			(job) => !packages || packages.includes(job.workspace.split("/").at(-1)),
		)
		.filter((job) => !values.suite || job.suite === values.suite);
	if (!jobs.length)
		throw new Error(
			"No enabled stages selected; consult make test-mutation ARGS=--inventory",
		);

	const output = join(root, "reports/mutation");
	mkdirSync(output, { recursive: true });
	const run = mkdtempSync(join(output, "run-"));
	let scheduling = restoreScheduling(root);
	let remote = "offline";
	if (values.baseline) {
		const imported = importCheckpoint(
			root,
			full.jobs,
			resolve(values.baseline),
		);
		if (imported.importedStages) scheduling = imported.scheduling;
		remote = imported.importedStages
			? "explicit-import"
			: "incompatible-explicit-import-cold-fallback";
	} else if (!values.offline) {
		const imported = await downloadCheckpoint(
			root,
			full.jobs,
			process.env.GITHUB_ACTIONS
				? Infinity
				: invocationStart + budgetMs - publicationReserveMs,
		);
		remote = imported
			? "default-branch-checkpoint"
			: "unavailable-bounded-cold-fallback";
		if (imported) {
			if (imported.importedStages) scheduling = imported.scheduling;
			else {
				remote = "incompatible-default-branch-checkpoint-cold-fallback";
				console.warn(
					"Default-branch artifact has no compatible stages; bounded cold fallback",
				);
			}
		}
	}
	// A declared environment can invalidate a stage without a Git diff. Resolve
	// selection after imports so compatible remote evidence keeps changed scope.
	for (const job of jobs) {
		if (job.config.environmentKeys?.length && !restoreBaseline(job.context)) {
			job.mutate = job.sourceFiles;
			job.scope = "all";
		}
	}
	if (values.files) {
		const files = values.files.split(",");
		for (const file of files)
			if (!jobs.some((job) => job.sourceFiles.includes(file)))
				throw new Error(`File outside eligible scope: ${file}`);
		for (const job of jobs) {
			job.mutate = job.mutate.filter((file) => files.includes(file));
			job.scope = "representative";
		}
	}

	const summary = {
		outcome: "completed",
		scope: values.files ? "representative" : values.scope,
		budgetSeconds: budgetMs / 1000,
		publicationReserveSeconds: publicationReserveMs / 1000,
		workerLimit: 1,
		runtime: full.jobs[0]?.context.compatibility.runtime,
		runtimeDiagnostics: full.jobs[0]?.context.compatibility.diagnostics,
		remote,
		stages: [],
		checkpointSaved: false,
		inventory: full.inventory,
		commit: git(root, "rev-parse", "HEAD"),
		inputIdentity: hash(
			JSON.stringify(full.jobs.map((job) => [job.id, job.context.inputDigest])),
		),
	};
	const start = performance.now(),
		deadline =
			(process.env.GITHUB_ACTIONS ? start : invocationStart) + budgetMs;
	const executionDeadline = deadline - publicationReserveMs;
	const baselines = new Map();
	const readBaseline = (context) => {
		if (!baselines.has(context.key))
			baselines.set(context.key, restoreBaseline(context));
		return baselines.get(context.key);
	};
	let cancelled = false;
	const cancel = () => {
		cancelled = true;
	};
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	let cursor = Math.max(
		0,
		jobs.findIndex((job) => job.id === scheduling.cursor),
	);
	let visits = 0;
	let preparationReady = true;
	try {
		if (!process.env.GITHUB_ACTIONS && jobs.some((job) => job.mutate.length)) {
			const preparationStart = performance.now();
			const remaining = executionDeadline - preparationStart;
			const graceMs = Math.min(15_000, Math.max(0, Math.floor(remaining / 4)));
			const result =
				remaining - graceMs >= 500
					? await runBounded(
							"make",
							[
								"build",
								`PACKAGE=${packages[0]}`,
								`TURBO_FLAGS=--filter=@wallpaperdb/${packages[0]}^... --concurrency=1`,
							],
							{ cwd: root, budgetMs: remaining - graceMs, graceMs },
						)
					: { outcome: "budget-exhausted" };
			summary.preparation = {
				...result,
				elapsedSeconds: (performance.now() - preparationStart) / 1000,
			};
			preparationReady = result.outcome === "completed";
			if (result.outcome === "failed") summary.outcome = "failed";
			if (result.outcome === "cancelled") cancelled = true;
			if (!preparationReady)
				summary.diagnostic =
					"Dependency preparation ended before mutation stages could start";
		}
		// A bounded pass visits each stage once. The persisted cursor rotates the
		// first stage of the next run even if this run expired during startup.
		while (
			preparationReady &&
			visits < jobs.length &&
			performance.now() < executionDeadline &&
			!cancelled
		) {
			const job = jobs[cursor];
			cursor = (cursor + 1) % jobs.length;
			visits++;
			scheduling.cursor = jobs[cursor].id;
			if (!job.mutate.length) continue;
			const unitJob = full.jobs.find(
				(other) => other.workspace === job.workspace && other.suite === "unit",
			);
			const unit =
				job.suite === "integration" && unitJob
					? current(unitJob, readBaseline)
					: null;
			if (
				job.suite === "integration" &&
				unitJob &&
				(!unit ||
					![...resultIndex(unit.report).values()].some(
						(m) =>
							job.mutate.includes(m.file) &&
							["Survived", "NoCoverage"].includes(m.status),
					))
			)
				continue;
			const before = current(job, readBaseline);
			let releaseLock;
			let result;
			try {
				if (job.suite === "integration" && !process.env.GITHUB_ACTIONS)
					releaseLock = acquireMutationLock(
						Math.max(
							1,
							Math.min(15_000, executionDeadline - performance.now()),
						),
					);
				const remaining = executionDeadline - performance.now();
				const visitMs = Math.min(quantumMs, remaining);
				const graceMs = Math.min(15_000, Math.floor(visitMs / 4));
				if (visitMs - graceMs < 500) break;
				console.log(
					`Mutation stage ${job.id}; ${(visitMs / 1000).toFixed(2)}s slice including ${(graceMs / 1000).toFixed(2)}s shutdown; ${(remaining / 1000).toFixed(1)}s aggregate budget remaining`,
				);
				result = await runStage({
					...job,
					root,
					unit: unit?.report,
					shouldCancel: () => cancelled,
					budgetMs: visitMs - graceMs,
					graceMs,
					output: join(root, job.workspace, "reports/mutation", job.suite),
				});
			} finally {
				releaseLock?.();
			}
			summary.stages.push(result.summary);
			baselines.delete(job.context.key);
			const after = current(job, readBaseline);
			const unitResults = resultIndex(unit?.report);
			const selectedEvidence = (state) =>
				[...resultIndex(state?.report)]
					.filter(
						([id, mutant]) =>
							job.mutate.includes(mutant.file) &&
							(!unit ||
								["Survived", "NoCoverage"].includes(
									unitResults.get(id)?.status,
								)),
					)
					.map(([, mutant]) => mutant);
			const processed = (state) =>
				selectedEvidence(state).filter(isProcessed).length;
			const prior = scheduling.attempts[job.id];
			const selectedComplete =
				after?.discovery &&
				job.mutate.every((file) => after.discovery.selected.includes(file)) &&
				selectedEvidence(after).every(isProcessed);
			const noProgress =
				processed(after) <= processed(before) && !selectedComplete;
			scheduling.attempts[job.id] = {
				inputDigest: job.context.inputDigest,
				noProgress: noProgress
					? (prior?.inputDigest === job.context.inputDigest
							? prior.noProgress
							: 0) + 1
					: 0,
			};
			if (scheduling.attempts[job.id].noProgress >= 2)
				console.warn(
					`Repeated lack of progress: ${job.id}; increase its CI quantum or diagnose startup/reset costs`,
				);
			if (result.summary.outcome === "failed") summary.outcome = "failed";
			if (result.summary.outcome === "cancelled") cancelled = true;
		}
	} catch (error) {
		summary.outcome = "failed";
		summary.error = error.stack;
		console.error(error.stack);
	} finally {
		try {
			const publicationStart = performance.now();
			summary.workspaces = summarize(full.jobs, false, full.jobs, readBaseline);
			const selected = summarize(jobs, true, full.jobs, readBaseline);
			summary.selectedWorkspaces = selected;
			summary.processed = selected.reduce((n, w) => n + w.processed, 0);
			summary.total = selected.reduce((n, w) => n + w.total, 0);
			summary.fullBaselineComplete = summary.workspaces.every(
				(workspace) => workspace.complete,
			);
			summary.fullEligibleTotal = summary.workspaces.every(
				(workspace) => workspace.discovered,
			)
				? summary.workspaces.reduce((n, workspace) => n + workspace.total, 0)
				: null;
			summary.selectedScopeComplete = selected.every(
				(workspace) => workspace.complete,
			);
			if (selected.some((workspace) => workspace.counts.RuntimeError))
				summary.outcome = "failed";
			if (summary.outcome !== "failed") {
				if (cancelled) summary.outcome = "cancelled";
				else if (!jobs.some((job) => job.mutate.length))
					summary.outcome = "no-changes";
				else if (!summary.selectedScopeComplete) summary.outcome = "incomplete";
			}
			summary.scheduling = scheduling;
			try {
				publishCheckpoint(
					root,
					full.jobs,
					scheduling,
					join(run, "checkpoint.json"),
					readBaseline,
				);
				atomicCopy(
					join(run, "checkpoint.json"),
					join(output, "checkpoint.json"),
				);
				summary.checkpointSaved = true;
			} catch (error) {
				summary.outcome = "failed";
				summary.publicationError = error.message;
			}
			// Signals received during synchronous publication need an event-loop
			// turn before their listeners can update the outcome.
			await new Promise((resolve) => setImmediate(resolve));
			if (cancelled && summary.outcome !== "failed")
				summary.outcome = "cancelled";
			summary.publicationSeconds =
				(performance.now() - publicationStart) / 1000;
			summary.elapsedSeconds =
				(performance.now() -
					(process.env.GITHUB_ACTIONS ? start : invocationStart)) /
				1000;
			atomicJson(join(run, "summary.json"), summary);
			atomicCopy(join(run, "summary.json"), join(output, "summary.json"));
			await new Promise((resolve) => setImmediate(resolve));
			if (cancelled && !["failed", "cancelled"].includes(summary.outcome)) {
				summary.outcome = "cancelled";
				atomicJson(join(run, "summary.json"), summary);
				atomicCopy(join(run, "summary.json"), join(output, "summary.json"));
			}
			console.log(
				`Mutation ${summary.outcome}: ${summary.processed}/${summary.total} discovered mutations processed; full baseline ${summary.fullBaselineComplete ? "complete" : "incomplete"}; checkpoint ${summary.checkpointSaved ? "saved" : "unavailable"}`,
			);
		} finally {
			process.removeListener("SIGINT", cancel);
			process.removeListener("SIGTERM", cancel);
		}
	}
	return summary.outcome === "failed"
		? 1
		: cancelled
			? 130
			: summary.outcome === "incomplete"
				? 2
				: 0;
}
