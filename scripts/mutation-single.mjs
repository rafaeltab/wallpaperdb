import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	git,
	isMutationSource,
	isMutationToolInput,
	mutationContext,
	restoreBaseline,
	publishBaseline,
	importBaseline,
} from "./lib/mutation-state.mjs";
import { runBounded } from "./lib/mutation-process.mjs";
import { downloadBaselineCancellable } from "./lib/mutation-remote.mjs";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
async function main() {
	const invocationStart = performance.now();
	const { values } = parseArgs({
		options: {
			package: { type: "string" },
			suite: { type: "string", default: "unit" },
			scope: { type: "string", default: "changed" },
			base: { type: "string", default: "origin/main" },
			budget: {
				type: "string",
				default: process.env.GITHUB_ACTIONS ? "900" : "60",
			},
			baseline: { type: "string" },
			offline: { type: "boolean", default: false },
		},
	});
	if (!values.package || !/^[a-z0-9-]+$/.test(values.package))
		throw new Error("--package requires a workspace basename");
	if (!["all", "changed"].includes(values.scope))
		throw new Error("--scope must be all or changed");
	const budgetMs = Number(values.budget) * 1000;
	if (!Number.isFinite(budgetMs) || budgetMs < 1000 || budgetMs > 3_600_000)
		throw new Error("--budget must be 1 to 3600 seconds");
	if (!process.env.GITHUB_ACTIONS && budgetMs > 300_000)
		throw new Error(
			"Local mutation diagnostics require a budget of at most 300 seconds including shutdown",
		);
	const executionDeadline =
		invocationStart + budgetMs - Math.min(15_000, Math.floor(budgetMs / 5));
	const root = git(process.cwd(), "rev-parse", "--show-toplevel");
	const workspace = ["apps", "packages"]
		.map((p) => `${p}/${values.package}`)
		.find((p) => existsSync(join(root, p, "package.json")));
	if (!workspace) throw new Error(`Workspace not found: ${values.package}`);
	const cwd = join(root, workspace);
	const configPath = join(cwd, "mutation.config.json");
	if (!existsSync(configPath))
		throw new Error(
			`Add mutation.config.json to opt ${workspace} into mutation testing`,
		);
	const config = json(configPath).suites[values.suite];
	if (!config) throw new Error(`Unknown mutation suite: ${values.suite}`);
	if (config.fixture)
		throw new Error(
			"Standalone mode cannot run fixture-backed suites; use the repository coordinator",
		);
	const files = execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"--",
			workspace,
		],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	const sourceFiles = [
		...new Set(
			files
				.map((f) => f.slice(workspace.length + 1))
				.filter(
					(f) =>
						isMutationSource(f) &&
						existsSync(join(cwd, f)) &&
						(!config.sourceRoots ||
							config.sourceRoots.some((prefix) => f.startsWith(prefix))),
				),
		),
	].sort();
	const contextConfig = { ...config, sourceFiles };
	const context = mutationContext(root, workspace, values.suite, contextConfig);
	const output = join(cwd, "reports/mutation", values.suite);
	mkdirSync(output, { recursive: true });
	// Each invocation has private input/output files, even in the same worktree.
	const run = mkdtempSync(join(output, "run-"));
	let sandbox;
	let scope = values.scope,
		mutate = sourceFiles;
	if (scope === "changed") {
		const base = git(root, "merge-base", values.base, "HEAD");
		const changed = [
			...new Set(
				[
					...execFileSync("git", ["diff", "--name-only", "-z", base], {
						cwd: root,
						encoding: "utf8",
					}).split("\0"),
					...execFileSync(
						"git",
						["ls-files", "--others", "--exclude-standard", "-z"],
						{ cwd: root, encoding: "utf8" },
					).split("\0"),
				].filter(Boolean),
			),
		];
		// Source-only edits can narrow scope. Test/helper/toolchain/dependency changes
		// select the full workspace and let Stryker decide which results remain valid.
		if (
			changed
				.filter(
					(f) =>
						isMutationToolInput(f) ||
						context.watchRoots.some(
							(dir) => f === dir || f.startsWith(`${dir}/`),
						),
				)
				.some(
					(f) =>
						!f.startsWith(`${workspace}/`) ||
						!sourceFiles.includes(f.slice(workspace.length + 1)),
				)
		)
			scope = "all";
		else
			mutate = sourceFiles.filter((f) => changed.includes(`${workspace}/${f}`));
	}
	const summary = {
		workspace,
		suite: values.suite,
		scope,
		budgetSeconds: budgetMs / 1000,
		outcome: "completed",
		total: 0,
		completed: 0,
		executed: 0,
		errors: 0,
		baselineRestored: false,
		checkpointSaved: false,
	};
	let cancelled = false;
	const cancellation = new AbortController();
	const cancel = () => {
		cancelled = true;
		cancellation.abort();
	};
	process.on("SIGINT", cancel);
	process.on("SIGTERM", cancel);
	try {
		if (values.baseline && !importBaseline(context, resolve(values.baseline)))
			throw new Error("Baseline is incompatible with this workspace/toolchain");
		let baseline = restoreBaseline(context, { forExecution: true });
		if (
			!baseline &&
			!values.offline &&
			(mutate.length || config.environmentKeys?.length)
		) {
			await downloadBaselineCancellable(
				context,
				executionDeadline,
				cancellation.signal,
			);
			baseline = restoreBaseline(context, { forExecution: true });
		}
		// Remote transfer is finished before application tests inherit the environment.
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		if (config.environmentKeys?.length && !baseline) {
			scope = summary.scope = "all";
			mutate = sourceFiles;
		}
		await new Promise((resolve) => setImmediate(resolve));
		if (cancelled) {
			summary.outcome = "cancelled";
		} else if (mutate.length === 0) {
			summary.outcome = "no-changes";
			console.log(
				"No mutation sources selected. This does not establish a full baseline.",
			);
		} else {
			summary.baselineRestored = Boolean(baseline);
			const incrementalFile = join(run, "incremental.json");
			if (baseline)
				writeFileSync(incrementalFile, JSON.stringify(baseline.report));
			const initialReport = existsSync(incrementalFile)
				? readFileSync(incrementalFile, "utf8")
				: null;
			const progress = join(run, "progress.json"),
				complete = join(run, "complete");
			sandbox = mkdtempSync(join(tmpdir(), "wallpaperdb-mutation-"));
			const options = {
				testRunner: "vitest",
				plugins: [
					import.meta.resolve("@stryker-mutator/vitest-runner"),
					new URL("./lib/mutation-reporter.mjs", import.meta.url).href,
				],
				vitest: config.vitest,
				mutate,
				coverageAnalysis: "perTest",
				concurrency: 1,
				incremental: true,
				incrementalFile,
				tempDirName: sandbox,
				ignorePatterns: ["/reports", "/coverage", "/dist"],
				reporters: [
					"progress-append-only",
					"html",
					"json",
					"checkpoint-progress",
				],
				htmlReporter: { fileName: join(run, "mutation.html") },
				jsonReporter: { fileName: join(run, "mutation.json") },
				thresholds: { high: 80, low: 60, break: null },
				timeoutMS: config.timeoutMS ?? 5000,
				timeoutFactor: 1.5,
			};
			const configFile = join(run, "stryker.json");
			writeFileSync(configFile, JSON.stringify(options));
			const remaining = executionDeadline - performance.now();
			const graceMs = Math.min(15_000, Math.max(0, Math.floor(remaining / 4)));
			const result =
				remaining - graceMs < 500
					? { outcome: "budget-exhausted" }
					: await runBounded(
							process.execPath,
							[
								fileURLToPath(
									new URL("./mutation-worker.mjs", import.meta.url),
								),
								configFile,
								complete,
							],
							{
								cwd,
								budgetMs: remaining - graceMs,
								graceMs,
								env: {
									...process.env,
									WALLPAPERDB_MUTATION_PROGRESS: progress,
								},
							},
						);
			summary.elapsedSeconds =
				Math.round((performance.now() - invocationStart) / 100) / 10;
			Object.assign(
				summary,
				existsSync(progress) ? json(progress) : { total: null },
			);
			summary.outcome = result.outcome;
			if (
				summary.errors ||
				(result.outcome === "completed" && !existsSync(complete))
			)
				summary.outcome = "failed";
			const after = mutationContext(
				root,
				workspace,
				values.suite,
				contextConfig,
			);
			const unchanged =
				after.key === context.key && after.inputDigest === context.inputDigest;
			if (!unchanged) {
				summary.outcome = "failed";
				console.error(
					"Inputs changed during the run; checkpoint will not be published.",
				);
			}
			const updated =
				existsSync(incrementalFile) &&
				(existsSync(complete) ||
					readFileSync(incrementalFile, "utf8") !== initialReport);
			if (unchanged && updated && summary.outcome !== "failed") {
				const checkpoint = publishBaseline(context, json(incrementalFile), {
					complete: scope === "all" && summary.outcome === "completed",
				});
				copyFileSync(checkpoint, join(run, "checkpoint.json"));
				summary.checkpointSaved = true;
			}
		}
	} catch (error) {
		summary.outcome = "failed";
		throw error;
	} finally {
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		try {
			if (sandbox) rmSync(sandbox, { recursive: true, force: true });
			await new Promise((resolve) => setImmediate(resolve));
			if (cancelled && summary.outcome !== "failed")
				summary.outcome = "cancelled";
			summary.elapsedSeconds =
				Math.round((performance.now() - invocationStart) / 100) / 10;
			writeFileSync(
				join(run, "summary.json"),
				JSON.stringify(summary, null, 2),
			);
			// Stable paths are presentation/artifact outputs only, never cache inputs.
			for (const name of [
				"summary.json",
				"checkpoint.json",
				"mutation.json",
				"mutation.html",
			]) {
				const file = join(run, name),
					destination = join(output, name);
				if (existsSync(file)) copyFileSync(file, destination);
				else rmSync(destination, { force: true });
			}
			await new Promise((resolve) => setImmediate(resolve));
			if (cancelled && !["failed", "cancelled"].includes(summary.outcome)) {
				summary.outcome = "cancelled";
				writeFileSync(
					join(run, "summary.json"),
					JSON.stringify(summary, null, 2),
				);
				copyFileSync(join(run, "summary.json"), join(output, "summary.json"));
			}
			console.log(
				`Mutation ${summary.outcome}: ${summary.completed}/${summary.total ?? "?"} results, ${summary.executed} executed; checkpoint ${summary.checkpointSaved ? "saved" : "not saved"}.`,
			);
		} finally {
			process.removeListener("SIGINT", cancel);
			process.removeListener("SIGTERM", cancel);
		}
	}
	return ["completed", "no-changes"].includes(summary.outcome)
		? 0
		: summary.outcome === "budget-exhausted"
			? 2
			: summary.outcome === "cancelled"
				? 130
				: 1;
}
try {
	process.exitCode = await main();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
