import {
	copyFileSync,
	closeSync,
	constants,
	existsSync,
	fstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { runBounded } from "./mutation-process.mjs";
import { FixtureCleanupError, mutationFixture } from "./mutation-fixture.mjs";
import {
	nativeCancellationWindow,
	readMutationTimings,
} from "./mutation-timings.mjs";
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

// Owned interrupted-Pending proofs read native reports before finalization.
const ownedCloseReport = (file, family = "S3") => {
	let fd, value, error;
	try {
		fd = openSync(
			file,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const before = fstatSync(fd);
		if (
			!before.isFile() ||
			!Number.isSafeInteger(before.size) ||
			before.size > 16 * 1024 * 1024
		)
			throw new Error(
				`Owned ${family} native report is not a bounded regular file`,
			);
		const bytes = Buffer.alloc(before.size);
		let size = 0;
		while (size < bytes.length) {
			const count = readSync(fd, bytes, size, bytes.length - size, size);
			if (!count) break;
			size += count;
		}
		const after = fstatSync(fd);
		if (
			size !== before.size ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		)
			throw new Error(
				`Owned ${family} native report changed during observation`,
			);
		value = JSON.parse(bytes.toString("utf8"));
	} catch (cause) {
		error = new Error(
			`Owned ${family} native close report observation failed`,
			{
				cause,
			},
		);
	} finally {
		try {
			if (fd !== undefined) closeSync(fd);
		} catch (cause) {
			const cleanup = new Error(
				`Owned ${family} native report descriptor cleanup failed`,
				{ cause },
			);
			error = error
				? new AggregateError(
						[error, cleanup],
						`Owned ${family} native report observation and cleanup failed`,
						{ cause: error },
					)
				: cleanup;
		}
	}
	if (error) throw error;
	return value;
};

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
	const finalizedFixture = ["s3-owned", "opensearch-owned"].includes(
		config.fixture,
	);
	const finalizationFamily =
		config.fixture === "opensearch-owned" ? "OpenSearch" : "S3";
	const drainingFixture = [
		"postgres-owned",
		"nats-owned",
		"s3-owned",
		"opensearch-owned",
	].includes(config.fixture);
	const fixtureCleanupMs = drainingFixture
		? Math.max(1, Math.floor(graceMs / 2))
		: Math.max(100, graceMs / 2);
	const runnerGraceMs = drainingFixture
		? graceMs - fixtureCleanupMs
		: fixtureCleanupMs;
	const cwd = join(root, workspace);
	const contextConfig = { ...config, sourceFiles };
	const context = mutationContext(root, workspace, suite, contextConfig);
	config = context.config;
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
	const quarantineProgress = () => {
		summary.discardedProgress ??= {
			completed: summary.completed,
			executed: summary.executed,
		};
		summary.completed = 0;
		summary.executed = 0;
		delete summary.results;
		report = undefined;
		for (const extension of ["json", "html"]) {
			const file = join(run, `mutation.${extension}`);
			if (existsSync(file))
				renameSync(file, join(run, `invalid-mutation.${extension}`));
		}
	};
	const assertFixtureHealthy = () => {
		if (
			shouldCancel() ||
			signal?.aborted ||
			fixture?.failure ||
			fixture?.failureSignal.aborted ||
			existsSync(fixtureFailure) ||
			summary.errors
		)
			throw new Error(
				`Owned ${finalizationFamily} finalization has cancellation or failure evidence`,
			);
	};
	const closeFixture = async (s3Context) => {
		if (!fixture || fixtureClosed) return;
		fixtureClosed = true;
		try {
			if (finalizedFixture) await fixture.close(s3Context);
			else await fixture.close();
		} catch (error) {
			cleanupFailed = true;
			summary.invalidFixtureResults = true;
			summary.outcome = "failed";
			summary.cleanupError = error.message;
		}
	};
	let workerStarted = false;
	let cancellationRequested = false;
	const cancelAfterNativeProgress =
		["nats-owned", "s3-owned", "opensearch-owned"].includes(config.fixture) &&
		config.diagnosticCancellation === "after-progress"
			? async (operationDeadline) => {
					if (cancellationRequested) return;
					const window = nativeCancellationWindow(runnerTimings);
					if (!window) return;
					if (
						!signal ||
						signal.aborted ||
						shouldCancel() ||
						performance.now() >= start + budgetMs
					)
						throw new Error(
							"Cancellation diagnostic has no active controller budget",
						);
					const waitMs = Math.min(
						1000,
						Math.floor(operationDeadline - performance.now()),
					);
					if (waitMs <= 0)
						throw new Error("Cancellation diagnostic reset deadline expired");
					cancellationRequested = true;
					const receipt = {
						origin: "injected-self",
						signal: "SIGINT",
						controllerPid: process.pid,
						requestedAt: Date.now(),
						monotonic: performance.now(),
						operationDeadline,
						waitMs,
						...window,
					};
					summary.cancellationDiagnostic = receipt;
					// This independent delivery deadline must survive the intended
					// coordinator handler aborting the fixture's cancellation signal.
					const delivery = new AbortController();
					const timer = setTimeout(() => delivery.abort(), waitMs);
					const received = once(process, "SIGINT", { signal: delivery.signal });
					try {
						process.kill(process.pid, "SIGINT");
						await received;
						receipt.deliveredAt = Date.now();
					} catch (error) {
						receipt.failed = true;
						throw new Error("Self-SIGINT diagnostic delivery failed", {
							cause: error,
						});
					} finally {
						clearTimeout(timer);
						delivery.abort();
						await received.catch(() => {});
					}
				}
			: undefined;
	try {
		sandbox = mkdtempSync(join(tmpdir(), "wallpaperdb-mutation-"));
		options.tempDirName = sandbox;
		writeFileSync(join(run, "stryker.json"), JSON.stringify(options));
		fixture = await mutationFixture(
			cwd,
			config,
			// These fixtures may finish an in-flight reset while the native runner drains.
			// This uses the reserved runner grace, leaving fixture cleanup separate.
			start + budgetMs + (drainingFixture ? runnerGraceMs : 0),
			fixtureCleanupMs,
			signal,
			cancelAfterNativeProgress,
			clientTimings,
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
		const executionDeadline = Date.now() + remaining;
		if (drainingFixture)
			summary.shutdown = {
				executionDeadline,
				runnerGraceMs,
				fixtureCleanupMs: fixture.cleanupMs,
				fixtureDeadlineOffsetMs: fixture.operationDeadline - (start + budgetMs),
			};
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
					// Never inherit another stage's private ordering control.
					WALLPAPERDB_MUTATION_PLAN_ORDER: [
						"nats-owned",
						"s3-owned",
						"opensearch-owned",
					].includes(config.fixture)
						? config.diagnosticOrder
						: "native",
					WALLPAPERDB_MUTATION_FAILURE_FILE: fixtureFailure,
					WALLPAPERDB_MUTATION_EXECUTION_DEADLINE: String(executionDeadline),
				},
			},
		);
		summary.shutdown = { ...summary.shutdown, runner: result.shutdown };
		const shutdownFailed =
			!result.shutdown?.confirmed || Boolean(result.shutdown.failure);
		if (shutdownFailed) summary.invalidWorkerResults = true;
		Object.assign(summary, existsSync(progress) ? json(progress) : {});
		summary.elapsedSeconds = (performance.now() - start) / 1000;
		summary.outcome = result.outcome;
		let s3Reports;
		// Resource disposal is part of the evidence, before checkpoint publication.
		await closeFixture(
			finalizedFixture
				? {
						result,
						assertHealthy: assertFixtureHealthy,
						reports: () =>
							(s3Reports ??= {
								planned: ownedCloseReport(
									plan,
									config.fixture === "opensearch-owned" ? "OpenSearch" : "S3",
								),
								partial: existsSync(incrementalFile)
									? ownedCloseReport(
											incrementalFile,
											config.fixture === "opensearch-owned"
												? "OpenSearch"
												: "S3",
										)
									: undefined,
								initial: executionBaseline?.report,
							}),
					}
				: undefined,
		);
		if (finalizedFixture) assertFixtureHealthy();
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
		if (fixture?.failure || resetFailed || cleanupFailed || shutdownFailed) {
			if (fixture?.failure || resetFailed || cleanupFailed)
				summary.invalidFixtureResults = true;
			// Retain raw native diagnostics privately, never as an authoritative report.
			quarantineProgress();
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
			!cleanupFailed &&
			!shutdownFailed
		) {
			const planned = s3Reports?.planned ?? json(plan);
			report = mergeReports([
				planned,
				...(updated ? [s3Reports?.partial ?? json(incrementalFile)] : []),
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
			if (finalizedFixture) {
				// Deliver queued signals after synchronous hashing/merging, before
				// checking eligibility. Signals arriving after this check can still race.
				await new Promise((resolve) => setImmediate(resolve));
				assertFixtureHealthy();
			}
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
		const startupCleanupFailed = error instanceof FixtureCleanupError;
		if (startupCleanupFailed) summary.cleanupError = error.message;
		const hasCleanupFailure =
			startupCleanupFailed ||
			(finalizedFixture && (cleanupFailed || Boolean(summary.cleanupError)));
		if (finalizedFixture && workerStarted) {
			summary.invalidFixtureResults = true;
			quarantineProgress();
		}
		if (
			!hasCleanupFailure &&
			(shouldCancel() ||
				(!workerStarted && performance.now() >= start + budgetMs))
		) {
			summary.outcome = shouldCancel() ? "cancelled" : "budget-exhausted";
			summary.diagnostic =
				finalizedFixture && workerStarted
					? `Owned ${finalizationFamily} execution was quarantined during cancellation`
					: `Fixture/startup ended without mutation progress: ${error.message}`;
			return { summary, context };
		}
		summary.outcome = "failed";
		summary.error = error.message;
		if (config.fixture) {
			summary.invalidFixtureResults = true;
			if (finalizedFixture) quarantineProgress();
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
				boundaries: fixture.boundaries,
				...(config.fixture === "opensearch-owned"
					? { history: fixture.history }
					: {}),
				...(finalizedFixture
					? { boundariesDropped: fixture.boundariesDropped }
					: {}),
				...(["nats-owned", "s3-owned", "opensearch-owned"].includes(
					config.fixture,
				)
					? { finalization: fixture.finalization }
					: {}),
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
			if (config.fixture === "nats-owned")
				summary.clients.scope = "nats-helper-only";
			if (config.fixture === "s3-owned")
				summary.clients.scope = "observed-sdk-instances-and-node-agents";
			if (config.fixture === "opensearch-owned")
				summary.clients.scope =
					"observed-opensearch-sdk-application-adapter-agents-and-sockets";
		}
		summary.elapsedSeconds = (performance.now() - start) / 1000;
		writeFileSync(join(run, "summary.json"), JSON.stringify(summary, null, 2));
		for (const name of [
			"summary.json",
			"checkpoint.json",
			"mutation.json",
			"mutation.html",
		]) {
			if (
				existsSync(join(run, name)) &&
				!(summary.invalidWorkerResults && name !== "summary.json")
			)
				copyFileSync(join(run, name), join(output, name));
			else rmSync(join(output, name), { force: true });
		}
	}
}
