import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import {
	availableParallelism,
	arch,
	constants,
	cpus,
	freemem,
	loadavg,
	platform,
	release,
	totalmem,
} from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";

const [phase, separator, command, ...args] = process.argv.slice(2);
if (!phase || !/^[a-z0-9_-]+$/i.test(phase) || separator !== "--" || !command) {
	console.error(
		"Usage: node scripts/ci-runtime.mjs <phase> -- <command> [args...]",
	);
	process.exit(2);
}

const directory = "test-results/ci-runtime";
const output = join(directory, `${phase}-${Date.now()}-${process.pid}.jsonl`);
const started = performance.now();
let evidenceFailed = false;

function failEvidence(error) {
	if (evidenceFailed) return;
	evidenceFailed = true;
	console.error(
		`ci-runtime: evidence write failed (${error.code}); command result is preserved.`,
	);
}

try {
	mkdirSync(directory, { recursive: true });
} catch (error) {
	failEvidence(error);
}

function record(type, data) {
	if (evidenceFailed) return;
	try {
		appendFileSync(
			output,
			`${JSON.stringify({
				type,
				phase,
				timestamp: new Date().toISOString(),
				elapsedMs: performance.now() - started,
				...data,
			})}\n`,
		);
	} catch (error) {
		failEvidence(error);
	}
}

function sample() {
	record("host-sample", {
		freeMemoryBytes: freemem(),
		loadAverage: loadavg(),
	});
}

record("start", {
	host: {
		platform: platform(),
		release: release(),
		architecture: arch(),
		cpuModel: cpus()[0]?.model,
		availableParallelism: availableParallelism(),
		totalMemoryBytes: totalmem(),
		freeMemoryBytes: freemem(),
		loadAverage: loadavg(),
	},
	github: Object.fromEntries(
		[
			"GITHUB_SHA",
			"GITHUB_RUN_ID",
			"GITHUB_RUN_ATTEMPT",
			"GITHUB_JOB",
			"ImageOS",
			"ImageVersion",
		].map((key) => [key, process.env[key] ?? null]),
	),
});
const interval = evidenceFailed ? undefined : setInterval(sample, 1000);
function observeDocker(kind, args) {
	const observer = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
	const closed = new Promise((resolve) => observer.once("close", resolve));
	observer.on("error", (error) =>
		record("observer-error", { kind, message: error.message }),
	);
	for (const [stream, type] of [
		[observer.stdout, `docker-${kind}`],
		[observer.stderr, "observer-diagnostic"],
	]) {
		const lines = createInterface({ input: stream });
		lines.on("line", (line) => {
			let data = line;
			try {
				data = JSON.parse(stripVTControlCharacters(line));
			} catch {
				/* Diagnostics need not be JSON. */
			}
			record(type, { kind, data });
		});
	}
	return { observer, closed };
}

async function stopObserver({ observer, closed }) {
	if (
		observer.exitCode !== null ||
		observer.signalCode !== null ||
		!observer.pid
	)
		return closed;
	observer.kill("SIGTERM");
	const timeout = setTimeout(() => observer.kill("SIGKILL"), 1000);
	await closed;
	clearTimeout(timeout);
}

const observers = evidenceFailed
	? []
	: [
			observeDocker("stats", ["stats", "--no-trunc", "--format", "{{json .}}"]),
			observeDocker("events", ["events", "--format", "{{json .}}"]),
		];
const childStarted = performance.now();
const child = spawn(command, args, { stdio: "inherit", detached: true });
let receivedSignal;
const handlers = new Map();
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
	const handler = () => {
		receivedSignal ??= signal;
		try {
			process.kill(-child.pid, signal);
		} catch {
			/* The command may have exited before the signal arrived. */
		}
	};
	handlers.set(signal, handler);
	process.on(signal, handler);
}

const result = await new Promise((resolve) => {
	child.on("error", (error) => {
		console.error(`ci-runtime: ${error.message}`);
		resolve({ code: error.code === "ENOENT" ? 127 : 126, signal: null });
	});
	child.on("exit", (code, signal) => resolve({ code, signal }));
});
const durationMs = performance.now() - childStarted;
clearInterval(interval);
await Promise.all(observers.map(stopObserver));
for (const [signal, handler] of handlers)
	process.removeListener(signal, handler);
const signal = receivedSignal ?? result.signal;
const exitCode = signal ? 128 + constants.signals[signal] : result.code;
sample();
record("finish", {
	exitCode,
	signal,
	durationMs,
	observerDurationMs: performance.now() - started,
	observerResourceUsage: process.resourceUsage(),
});
if (process.env.GITHUB_STEP_SUMMARY) {
	try {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`- ${phase}: ${(durationMs / 1000).toFixed(3)} s, exit ${exitCode}.\n`,
		);
	} catch (error) {
		console.error(
			`ci-runtime: summary write failed (${error.code}); command result is preserved.`,
		);
	}
}
process.exitCode = exitCode;
