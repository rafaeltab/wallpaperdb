// Read-only experiment sampler. Sampling never resumes or extends a worker.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { worktreeProcesses } from "./lib/boat.mjs";

const execute = promisify(execFile);
const [taskFile, output, ...options] = process.argv.slice(2);
if (!taskFile || !output)
	throw new Error("Expected task inventory and output directory");
const tasks = JSON.parse(fs.readFileSync(taskFile, "utf8"));
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const read = (file) => fs.readFileSync(file, "utf8");
const host = () => ({
	at: Date.now(),
	load: os.loadavg(),
	stat: read("/proc/stat"),
	meminfo: read("/proc/meminfo"),
	diskstats: read("/proc/diskstats"),
	pressure: Object.fromEntries(
		["cpu", "memory", "io"].map((name) => [
			name,
			read(`/proc/pressure/${name}`),
		]),
	),
	worktrees: Object.fromEntries(
		tasks.map((task) => [task.issue, worktreeProcesses(task.worktreePath)]),
	),
});
const routes = [
	"/web/",
	...[
		"ingestor",
		"asset",
		"wallpaper",
		"gateway",
		"variant-generator",
		"color-extractor",
		"user",
	].map((name) => `/${name}/ready`),
];
const workerCommand =
	"date -u; cat /proc/stat /proc/meminfo; df -k /; cat /proc/pressure/cpu /proc/pressure/memory /proc/pressure/io";
async function sample(task) {
	const started = Date.now();
	try {
		const root = task.worktreePath;
		const state = JSON.parse(read(path.join(root, ".boat/state.json")));
		if (!state.runningSince)
			return { issue: task.issue, started, stopped: true, healthy: false };
		const port = read(path.join(root, ".worktree")).match(
			/^INGRESS_PORT\s*[:?]?=\s*(\d+)/m,
		)?.[1];
		if (!port) throw new Error("Missing ingress port");
		const [health, worker] = await Promise.all([
			Promise.all(
				routes.map(async (route) => {
					try {
						const response = await fetch(`http://127.0.0.1:${port}${route}`, {
							signal: AbortSignal.timeout(5000),
						});
						await response.arrayBuffer();
						return { route, status: response.status };
					} catch (error) {
						return { route, error: error.message };
					}
				}),
			),
			execute(
				path.join(root, ".mise/boat/boat"),
				["--no-update", "ssh", state.id, "--", "bash", "-lc", workerCommand],
				{ cwd: root, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
			).then(
				({ stdout, stderr }) => ({ stdout, stderr }),
				(error) => ({ error: error.message }),
			),
		]);
		return {
			issue: task.issue,
			id: state.id,
			started,
			ended: Date.now(),
			health,
			worker,
			healthy: health.every(
				(probe) => probe.status >= 200 && probe.status < 400,
			),
		};
	} catch (error) {
		return {
			issue: task.issue,
			started,
			ended: Date.now(),
			healthy: false,
			error: error.message,
		};
	}
}
do {
	const started = Date.now();
	const phase = fs.existsSync(path.join(output, "phase.json"))
		? JSON.parse(read(path.join(output, "phase.json")))
		: { name: "baseline" };
	const before = host();
	const stacks = await Promise.all(tasks.map(sample));
	const record = {
		started,
		ended: Date.now(),
		phase,
		hostBefore: before,
		hostAfter: host(),
		stacks,
		allHealthy: stacks.length === 5 && stacks.every((stack) => stack.healthy),
	};
	fs.appendFileSync(
		path.join(output, "aligned-samples.jsonl"),
		`${JSON.stringify(record)}\n`,
		{ mode: 0o600 },
	);
	if (options.includes("--once")) break;
	await new Promise((resolve) =>
		setTimeout(resolve, Math.max(0, 10000 - (Date.now() - started))),
	);
} while (!fs.existsSync(path.join(output, "sampling-stop")));
