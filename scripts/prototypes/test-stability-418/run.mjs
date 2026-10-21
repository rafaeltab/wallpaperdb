// PROTOTYPE #418. Direct runner processes bypass Turbo result caching.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanDelays } from "./checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(join(root, "package.json"));
const pwRequire = createRequire(join(root, "apps/web-e2e/package.json"));
const vitest = join(
	dirname(require.resolve("vitest/package.json")),
	"vitest.mjs",
);
const playwright = join(
	dirname(pwRequire.resolve("@playwright/test/package.json")),
	"cli.js",
);
const seeds = [418, 200, 20261021];
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7) ?? "all";
const jobFilter = args.find((a) => a.startsWith("--job="))?.slice(6);
if (
	!["all", "controls", "samples"].includes(only) ||
	args.some((a) => !/^--(only|job)=/.test(a))
) {
	throw new Error(
		'Usage: make run PACKAGE=scripts SCRIPT=prototype:stability ARGS="--only=controls|samples|all --job=name"',
	);
}
const output = await mkdtemp(join(tmpdir(), "wallpaperdb-stability-418-"));
console.log(`PROTOTYPE #418 diagnostics: ${output}`);
const results = [];
const experimentStart = performance.now();
let started = 0;

async function run(name, runnerArgs, options = {}) {
	if (jobFilter && jobFilter !== name) return;
	started++;
	const directory = join(output, name);
	await mkdir(directory);
	const report = join(directory, "report.json");
	const attempts = join(directory, "attempts.json");
	const env = {
		...process.env,
		STABILITY_STRICT_RETRIES: "0",
		STABILITY_REPORT: report,
		STABILITY_ATTEMPTS: attempts,
		STABILITY_SETUP: join(directory, "setup-ready"),
		STABILITY_PW_OUTPUT: join(directory, "playwright-output"),
		STABILITY_DATA: directory,
		...options.env,
	};
	const isPW = options.playwright;
	const commandArgs = isPW
		? [
				playwright,
				"test",
				"--config",
				join(here, "playwright.config.mjs"),
				...runnerArgs,
			]
		: [
				vitest,
				"run",
				...runnerArgs,
				"--reporter=json",
				`--outputFile=${report}`,
				"--reporter",
				join(here, "retry-reporter.mjs"),
			];
	const command = [process.execPath, ...commandArgs];
	const log = createWriteStream(join(directory, "output.log"), { mode: 0o600 });
	const time = performance.now();
	const child = spawn(
		"/usr/bin/time",
		["-f", "%U %S %M", "-o", join(directory, "resources.txt"), ...command],
		{
			cwd: options.cwd ?? root,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	let timedOut = false;
	const deadline = setTimeout(() => {
		timedOut = true;
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
	}, 90000);
	const { code, signal } = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code, signal }));
	});
	clearTimeout(deadline);
	await new Promise((resolve) => log.end(resolve));
	const wallMs = Math.round(performance.now() - time);
	let diagnostics;
	let reportError;
	try {
		diagnostics = JSON.parse(await readFile(report, "utf8"));
	} catch (error) {
		reportError = error.message;
	}
	let cases = [];
	let attemptDiagnostics = [];
	if (isPW) {
		function visit(suite) {
			for (const spec of suite.specs ?? [])
				for (const test of spec.tests) {
					cases.push({
						name: spec.title,
						status: test.status,
						attempts: test.results,
					});
				}
			for (const nested of suite.suites ?? []) visit(nested);
		}
		if (diagnostics) visit(diagnostics);
	} else {
		cases =
			diagnostics?.testResults?.flatMap((file) =>
				file.assertionResults.map((test) => ({
					name: test.fullName,
					status: test.status,
					failures: test.failureMessages,
				})),
			) ?? [];
		try {
			attemptDiagnostics = JSON.parse(await readFile(attempts, "utf8"));
		} catch (error) {
			reportError = error.message;
		}
	}
	const resources = (await readFile(join(directory, "resources.txt"), "utf8"))
		.trim()
		.split("\n")
		.at(-1)
		.split(" ")
		.map(Number);
	const suiteLoadFailure = diagnostics?.testResults?.some(
		(file) => file.status === "failed" && !file.assertionResults.length,
	);
	const executedCases = cases.filter(
		(test) => !["pending", "skipped", "todo"].includes(test.status),
	);
	const result = {
		name,
		code,
		signal,
		timedOut,
		wallMs,
		userCpuSeconds: resources[0],
		systemCpuSeconds: resources[1],
		maxRSSKiB: resources[2],
		workers: options.workers ?? 1,
		seed: options.seed ?? null,
		expected: options.expected ?? 0,
		classification:
			timedOut || reportError || suiteLoadFailure || !executedCases.length
				? "infrastructure-or-runner"
				: code === 0
					? "passed"
					: "test-or-retry-failure",
		reportError,
		command,
		cwd: options.cwd ?? root,
		environment: Object.fromEntries(
			Object.entries(env).filter(([key]) => key.startsWith("STABILITY_")),
		),
		cases,
		executedCases: executedCases.length,
		attemptDiagnostics,
	};
	result.matchesExpected =
		result.classification !== "infrastructure-or-runner" &&
		code === result.expected;
	results.push(result);
	await writeFile(
		join(directory, "invocation.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(
		`${name}: exit=${code}, ${executedCases.length} executed cases, ${wallMs}ms, peak=${resources[2]}KiB, ${result.matchesExpected ? "expected" : "REVIEW"}`,
	);
	await writeFile(
		join(output, "results.json"),
		JSON.stringify(results, null, 2),
	);
}

const config = ["--config", join(here, "vitest.config.mjs")];
const shuffle = (seed) => ["--sequence.shuffle", `--sequence.seed=${seed}`];
if (only !== "samples") {
	for (const control of ["order", "globals", "timers", "valid"]) {
		await run(`control-${control}-baseline`, [...config, `${control}.fixture`]);
	}
	await run("control-delay", [...config, "delay.fixture"], { expected: 1 });
	for (const seed of seeds) {
		await run(
			`control-shuffle-${seed}`,
			[
				...config,
				"order.fixture",
				"globals.fixture",
				"timers.fixture",
				"valid.fixture",
				...shuffle(seed),
			],
			// This retained seed preserves the original order and misses all three faults.
			{ seed, expected: seed === 20261021 ? 0 : 1 },
		);
	}
	await run(
		"control-order-individual",
		[...config, "order.fixture", "-t", "^consumer depends"],
		{ expected: 1 },
	);
	await run("control-global-individual", [
		...config,
		"globals.fixture",
		"-t",
		"^reader requires",
	]);
	await run("control-timer-individual", [
		...config,
		"timers.fixture",
		"-t",
		"^reader requires",
	]);
	await run("control-data-serial", [
		...config,
		"data-a.fixture",
		"data-b.fixture",
	]);
	await run(
		"control-data-conflict",
		[
			...config,
			"data-a.fixture",
			"data-b.fixture",
			"--maxWorkers=2",
			"--fileParallelism",
		],
		{
			workers: 2,
			expected: 1,
			env: { STABILITY_BARRIER: "1" },
		},
	);
	await run(
		"control-data-isolated",
		[
			...config,
			"data-a.fixture",
			"data-b.fixture",
			"--maxWorkers=2",
			"--fileParallelism",
		],
		{
			workers: 2,
			env: { STABILITY_BARRIER: "1", STABILITY_ISOLATED: "1" },
		},
	);
	await run("vitest-retry-default", [...config, "retry.fixture"]);
	await run("vitest-retry-strict", [...config, "retry.fixture"], {
		expected: 1,
		env: { STABILITY_STRICT_RETRIES: "1" },
	});
	await run("vitest-retry-clean", [...config, "valid.fixture"], {
		env: { STABILITY_STRICT_RETRIES: "1" },
	});
	await run("playwright-retry-default", [], { playwright: true });
	await run("playwright-retry-strict", [], {
		playwright: true,
		expected: 1,
		env: { STABILITY_STRICT_RETRIES: "1" },
	});
	await run("playwright-retry-clean", ["--grep", "clean no-retry"], {
		playwright: true,
		env: { STABILITY_STRICT_RETRIES: "1" },
	});
}

if (only !== "controls") {
	const samples = [
		{
			name: "web",
			cwd: join(root, "apps/web"),
			config: "vitest.config.ts",
			file: "test/components/profile/profile-filter.dom.test.tsx",
			env: { STABILITY_STRICT_RETRIES: "1" },
			individuals: ["accepts a displayed @Handle", "searches a Handle alias"],
		},
		{
			name: "user",
			cwd: join(root, "apps/user"),
			config: "vitest.unit.config.ts",
			file: "test/profile-capability.unit.test.ts",
			env: { STABILITY_STRICT_RETRIES: "1" },
			individuals: [
				"normalizes changed details once",
				"adopts a staged picture just before expiry",
			],
		},
	];
	const sampleArgs = (sample) => [
		"--config",
		sample.config,
		sample.file,
		"--maxWorkers=1",
		"--no-file-parallelism",
		"--retry=0",
	];
	for (const sample of samples) {
		await run(`${sample.name}-baseline`, sampleArgs(sample), sample);
		for (const seed of seeds)
			await run(
				`${sample.name}-shuffle-${seed}`,
				[...sampleArgs(sample), ...shuffle(seed)],
				{ ...sample, seed },
			);
		for (let i = 0; i < sample.individuals.length; i++) {
			await run(
				`${sample.name}-individual-${i + 1}`,
				[...sampleArgs(sample), "-t", sample.individuals[i]],
				sample,
			);
		}
	}
	// Different processes, one worker each. No suite fixture becomes concurrent.
	await Promise.all(
		samples.map((sample) =>
			run(`${sample.name}-parallel`, sampleArgs(sample), sample),
		),
	);
}

if (!started) throw new Error(`No job matched ${jobFilter}`);
const scanFiles = [
	"apps/web/test/components/profile/profile-filter.dom.test.tsx",
	"apps/user/test/profile-capability.unit.test.ts",
	"apps/user/test/profile-picture-source.integration.test.ts",
];
const scans = [];
for (const file of scanFiles)
	scans.push({
		file,
		findings: scanDelays(await readFile(join(root, file), "utf8")),
	});
await writeFile(
	join(output, "delay-candidates.json"),
	JSON.stringify(scans, null, 2),
);
const summary = {
	prototype: 418,
	seeds,
	node: process.version,
	vitest: require("vitest/package.json").version,
	playwright: pwRequire("@playwright/test/package.json").version,
	cpuCount: cpus().length,
	jobs: results.length,
	wallMs: Math.round(performance.now() - experimentStart),
	unexpected: results.filter((r) => !r.matchesExpected).map((r) => r.name),
	invocationWallMs: results.reduce((sum, r) => sum + r.wallMs, 0),
	cpuSeconds: results.reduce(
		(sum, r) => sum + r.userCpuSeconds + r.systemCpuSeconds,
		0,
	),
	peakInvocationRSSKiB: Math.max(...results.map((r) => r.maxRSSKiB)),
	cache:
		"Direct Vitest/Playwright invocations, fresh report directory per process. No Turbo test result lookup.",
};
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.unexpected.length) process.exitCode = 1;
