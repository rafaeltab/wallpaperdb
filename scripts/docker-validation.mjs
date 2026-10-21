import { spawn } from "node:child_process";
import { constants } from "node:os";
import {
	acquireDockerLease,
	defaultDockerLock,
	inspectDockerQueue,
} from "./lib/docker-queue.mjs";

const args = process.argv.slice(2);
const file =
	process.env.DOCKER_VALIDATION_LOCK_FILE ||
	process.env.E2E_LOCK_FILE ||
	defaultDockerLock;
const abort = new AbortController();
let child;
let interrupted;
let killer;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		interrupted = 128 + constants.signals[signal];
		abort.abort();
		if (!child) return;
		try {
			process.kill(-child.pid, signal);
		} catch {}
		killer = setTimeout(() => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
		}, 5000);
		killer.unref();
	});
}

let lease;
try {
	if (args.length === 1 && args[0] === "--status") {
		const queue = inspectDockerQueue(file);
		console.log(`Docker validation queue: ${file}`);
		for (const entry of queue)
			console.log(
				`${entry.state}: ${entry.label} (${entry.workspace}, pid ${entry.pid}, queued ${entry.queuedAt})`,
			);
		if (!queue.length)
			console.log(
				"No registered validation. Legacy flock users do not publish queue metadata.",
			);
	} else {
		const separator = args.indexOf("--");
		const options = args.slice(0, separator);
		if (
			separator < 0 ||
			separator === args.length - 1 ||
			(options.length && (options.length !== 2 || options[0] !== "--label"))
		)
			throw new Error(
				"Usage: docker-validation.mjs [--label name] -- command [args...] | --status",
			);
		lease = await acquireDockerLease({
			file,
			timeoutSeconds:
				process.env.DOCKER_VALIDATION_TIMEOUT ??
				process.env.E2E_LOCK_TIMEOUT ??
				"900",
			label: options[1] ?? "experiment",
			signal: abort.signal,
			report: console.log,
		});
		const start = Date.now();
		const [command, ...commandArgs] = args.slice(separator + 1);
		const result = await new Promise((resolve, reject) => {
			child = spawn(command, commandArgs, {
				detached: true,
				stdio: ["inherit", "inherit", "inherit", lease.descriptor],
				env: {
					...process.env,
					WALLPAPERDB_DOCKER_LEASE_FD: "3",
					WALLPAPERDB_DOCKER_LEASE_FILE: lease.file,
				},
			});
			child.on("error", reject);
			child.on("close", (status, signal) =>
				resolve(interrupted ?? status ?? 128 + constants.signals[signal]),
			);
		});
		console.log(
			`Docker validation waited ${(lease.waitedMs / 1000).toFixed(1)}s; execution ${((Date.now() - start) / 1000).toFixed(1)}s; exit ${result}.`,
		);
		process.exitCode = result;
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = interrupted ?? error.status ?? 1;
} finally {
	clearTimeout(killer);
	lease?.release();
}
