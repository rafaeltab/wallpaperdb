import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runBounded } from "./mutation-process.mjs";
import { FixtureCleanupError, mutationFixture } from "./mutation-fixture.mjs";
import { readMutationTimings } from "./mutation-timings.mjs";
import {
	mutationContext,
	restoreBaseline,
	publishBaseline,
} from "./mutation-state.mjs";
import {
	isProcessed,
	mergeReports,
	resultIndex,
	resultCounts,
} from "./mutation-results.mjs";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));

/** One native Stryker/Vitest stage, with a private sandbox and report files. */
export async function runStage({
	root,
	workspace,
	suite,
	config,
	sourceFiles,
	mutate,
	budgetMs,
	graceMs,
	unit,
	output,
	shouldCancel = () => false,
	signal,
}) {
	const start = performance.now();
	const postgres = config.fixture === "postgres";
	const fixtureCleanupMs = postgres
		? Math.max(1, Math.floor(graceMs / 2))
		: Math.max(100, graceMs / 2);
	const runnerGraceMs = postgres
		? graceMs - fixtureCleanupMs
		: fixtureCleanupMs;
	const cwd = join(root, workspace);
	const contextConfig = { ...config, sourceFiles };
	const context = mutationContext(root, workspace, suite, contextConfig);
	const reuseStart = performance.now();
	const baseline = restoreBaseline(context);
	const executionBaseline = restoreBaseline(context, { forExecution: true });
	mkdirSync(output, { recursive: true });
	const run = mkdtempSync(join(output, "run-"));
	let sandbox;
	const incrementalFile = join(run, "incremental.json");
	if (executionBaseline)
		writeFileSync(incrementalFile, JSON.stringify(executionBaseline.report));
	const initial = existsSync(incrementalFile)
		? readFileSync(incrementalFile, "utf8")
		: null;
	const checkpointReuseSeconds = (performance.now() - reuseStart) / 1000;
	const complete = join(run, "complete"),
		progress = join(run, "progress.json");
	const plan = join(run, "plan.json"),
		gate = join(run, "gate.json");
	const fixtureFailure = join(run, "fixture-failure.json");
	const runnerTimings = join(run, "runner-timings.jsonl");
	const clientTimings = join(run, "client-timings.jsonl");
	if (unit)
		writeFileSync(
			gate,
			JSON.stringify(
				[...resultIndex(unit)]
					.filter(([, m]) => ["Survived", "NoCoverage"].includes(m.status))
					.map(([id]) => id),
			),
		);
	const options = {
		testRunner: "checkpoint-vitest",
		plugins: [
			import.meta.resolve("@stryker-mutator/vitest-runner"),
			new URL("./mutation-reporter.mjs", import.meta.url).href,
		],
		vitest: config.vitest,
		mutate,
		coverageAnalysis: "perTest",
		concurrency: 1,
		incremental: true,
		incrementalFile,
		ignorePatterns: ["/reports", "/coverage", "/dist"],
		reporters: ["checkpoint-progress", "progress-append-only", "html", "json"],
		htmlReporter: { fileName: join(run, "mutation.html") },
		jsonReporter: { fileName: join(run, "mutation.json") },
		thresholds: { high: 80, low: 60, break: null },
		timeoutMS: config.timeoutMS ?? 5000,
		timeoutFactor: 1.5,
	};
	const summary = {
		workspace,
		suite,
		total: null,
		completed: 0,
		executed: 0,
		errors: 0,
		baselineRestored: Boolean(baseline),
		checkpointSaved: false,
		checkpointReuseSeconds,
		run,
	};
	let report;
	let fixture;
	let fixtureClosed = false;
	let cleanupFailed = false;
	const closeFixture = async () => {
		if (!fixture || fixtureClosed) return;
		fixtureClosed = true;
		try {
			await fixture.close();
		} catch (error) {
			cleanupFailed = true;
			summary.invalidFixtureResults = true;
			summary.outcome = "failed";
			summary.cleanupError = error.message;
		}
	};
	let workerStarted = false;
	try {
		sandbox = mkdtempSync(join(tmpdir(), "wallpaperdb-mutation-"));
		options.tempDirName = sandbox;
		writeFileSync(join(run, "stryker.json"), JSON.stringify(options));
		fixture = await mutationFixture(
			cwd,
			config,
			// PostgreSQL may finish an in-flight reset while the native runner drains.
			// This uses the reserved runner grace, leaving fixture cleanup separate.
			start + budgetMs + (postgres ? runnerGraceMs : 0),
			fixtureCleanupMs,
			signal,
		);
		const remaining = budgetMs - (performance.now() - start);
		if (shouldCancel()) {
			summary.outcome = "cancelled";
			return { summary, context };
		}
		if (remaining <= 0)
			throw new Error(
				"Fixture setup consumed the stage budget without mutation progress",
			);
		workerStarted = true;
		const result = await runBounded(
			process.execPath,
			[
				fileURLToPath(new URL("../mutation-worker.mjs", import.meta.url)),
				join(run, "stryker.json"),
				complete,
			],
			{
				cwd,
				budgetMs: remaining,
				graceMs: fixture ? runnerGraceMs : graceMs,
				failureSignal: fixture?.failureSignal,
				env: {
					...process.env,
					...fixture?.env,
					WALLPAPERDB_MUTATION_PROGRESS: progress,
					WALLPAPERDB_MUTATION_TIMINGS: runnerTimings,
					WALLPAPERDB_MUTATION_CLIENT_TIMINGS: clientTimings,
					WALLPAPERDB_MUTATION_PLAN: plan,
					WALLPAPERDB_MUTATION_GATE: unit ? gate : "",
					WALLPAPERDB_MUTATION_FAILURE_FILE: fixtureFailure,
					WALLPAPERDB_MUTATION_EXECUTION_DEADLINE: String(
						Date.now() + remaining,
					),
				},
			},
		);
		Object.assign(summary, existsSync(progress) ? json(progress) : {});
		summary.elapsedSeconds = (performance.now() - start) / 1000;
		summary.outcome = result.outcome;
		// Resource disposal is part of the evidence, before checkpoint publication.
		await closeFixture();
		if (
			summary.errors ||
			(result.outcome === "completed" && !existsSync(complete))
		)
			summary.outcome = "failed";
		if (fixture?.failure) {
			summary.outcome = "failed";
			summary.fixtureError = fixture.failure.message;
		}
		const resetFailed = existsSync(fixtureFailure);
		if (resetFailed) {
			summary.outcome = "failed";
			summary.fixtureError ??=
				"Owned fixture reset failed in the test worker; stage results are not reusable";
		}
		if (fixture?.failure || resetFailed || cleanupFailed) {
			summary.invalidFixtureResults = true;
			summary.discardedProgress = {
				completed: summary.completed,
				executed: summary.executed,
			};
			summary.completed = 0;
			summary.executed = 0;
			// Retain raw native diagnostics privately, never as an authoritative report.
			for (const extension of ["json", "html"]) {
				const file = join(run, `mutation.${extension}`);
				if (existsSync(file))
					renameSync(file, join(run, `invalid-mutation.${extension}`));
			}
		}
		const after = mutationContext(root, workspace, suite, contextConfig);
		if (after.key !== context.key || after.inputDigest !== context.inputDigest)
			throw new Error(
				"Inputs changed during mutation execution; refusing checkpoint publication",
			);
		const updated =
			existsSync(incrementalFile) &&
			(existsSync(complete) ||
				readFileSync(incrementalFile, "utf8") !== initial);
		if (
			existsSync(plan) &&
			!fixture?.failure &&
			!resetFailed &&
			!cleanupFailed
		) {
			const planned = json(plan);
			report = mergeReports([
				planned,
				...(updated ? [json(incrementalFile)] : []),
			]);
			// A stage gate is deferral, never evidence of detection or survival.
			for (const file of Object.values(report.files))
				for (const mutant of file.mutants)
					if (mutant.status === "Ignored") mutant.status = "Pending";
			if (baseline) {
				// Preserve unselected files with their original suite-input identity.
				// The next full run can reconsider them through native incremental
				// analysis. They cannot establish current baseline completeness.
				const unselected = {
					...baseline.report,
					files: Object.fromEntries(
						Object.entries(baseline.report.files).filter(
							([file]) =>
								!mutate.includes(file) ||
								(baseline.provenance?.[file] ?? baseline.inputDigest) ===
									context.inputDigest,
						),
					),
				};
				report = mergeReports([unselected, report]);
			}
			const provenance = Object.fromEntries(
				Object.keys(report.files).map((file) => [
					file,
					mutate.includes(file)
						? context.inputDigest
						: (baseline?.provenance?.[file] ?? baseline?.inputDigest),
				]),
			);
			const discovery = {
				files: sourceFiles,
				selected: mutate,
				total: summary.total,
			};
			summary.results = resultCounts([...resultIndex(report).values()]);
			if (summary.results.counts.RuntimeError) summary.outcome = "failed";
			const checkpoint = publishBaseline(context, report, {
				discovery,
				provenance,
				complete:
					mutate.length === sourceFiles.length &&
					summary.outcome === "completed" &&
					Object.values(report.files).every((file) =>
						file.mutants.every(isProcessed),
					),
			});
			copyFileSync(checkpoint, join(run, "checkpoint.json"));
			summary.checkpointSaved = true;
		}
		if (!summary.executed && summary.outcome === "budget-exhausted")
			summary.diagnostic =
				"Startup/coverage collection exhausted this slice without executing mutations";
		return { summary, report, context };
	} catch (error) {
		const cleanupFailed = error instanceof FixtureCleanupError;
		if (cleanupFailed) summary.cleanupError = error.message;
		if (
			!cleanupFailed &&
			(shouldCancel() ||
				(!workerStarted && performance.now() >= start + budgetMs))
		) {
			summary.outcome = shouldCancel() ? "cancelled" : "budget-exhausted";
			summary.diagnostic = `Fixture/startup ended without mutation progress: ${error.message}`;
			return { summary, context };
		}
		summary.outcome = "failed";
		summary.error = error.message;
		if (config.fixture) {
			summary.invalidFixtureResults = true;
			return { summary, context };
		}
		throw error;
	} finally {
		if (fixture) {
			await closeFixture();
			summary.fixture = {
				name: fixture.name,
				image: fixture.image,
				containerIds: fixture.containerIds,
				...fixture.timings,
			};
		}
		if (sandbox) rmSync(sandbox, { recursive: true, force: true });
		Object.assign(summary, readMutationTimings(runnerTimings));
		if (existsSync(clientTimings)) {
			const entries = readFileSync(clientTimings, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(JSON.parse);
			summary.clients = Object.fromEntries(
				["created", "disposed"].map((phase) => {
					const samples = entries.filter((entry) => entry.phase === phase);
					return [
						phase,
						{
							count: samples.length,
							seconds: samples.reduce((sum, entry) => sum + entry.seconds, 0),
						},
					];
				}),
			);
		}
		summary.elapsedSeconds = (performance.now() - start) / 1000;
		writeFileSync(join(run, "summary.json"), JSON.stringify(summary, null, 2));
		for (const name of [
			"summary.json",
			"checkpoint.json",
			"mutation.json",
			"mutation.html",
		]) {
			if (existsSync(join(run, name)))
				copyFileSync(join(run, name), join(output, name));
			else rmSync(join(output, name), { force: true });
		}
	}
}
