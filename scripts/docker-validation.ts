import { spawn } from "node:child_process";
import { constants } from "node:os";
import {
	acquireDockerLease,
	defaultDockerLock,
	inspectDockerQueue,
} from "./lib/docker-queue.ts";

const args = process.argv.slice(2);
const file =
	process.env.DOCKER_VALIDATION_LOCK_FILE ||
	process.env.E2E_LOCK_FILE ||
	defaultDockerLock;
const abort = new AbortController();
let child: import("node:child_process").ChildProcess;
let interrupted: number | undefined;
let killer: string | number | NodeJS.Timeout | undefined;
let stopping: Promise<void> | undefined;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		interrupted = 128 + constants.signals[signal as NodeJS.Signals];
		abort.abort();
		if (!child) return;
		try {
			process.kill(-child.pid!, signal);
		} catch {}
		stopping ??= new Promise<void>((resolve) => {
			killer = setTimeout(() => {
				try {
					process.kill(-child.pid!, "SIGKILL");
				} catch {}
				resolve();
			}, 5000);
			child.once("close", () => {
				try {
					process.kill(-child.pid!, 0);
				} catch (caught) {
					const error = caught as NodeJS.ErrnoException & { status?: number };
					if ((error as NodeJS.ErrnoException).code === "ESRCH") {
						clearTimeout(killer);
						resolve();
					}
				}
			});
		});
	});
}

let lease: Awaited<ReturnType<typeof acquireDockerLease>> | undefined;
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
				"Usage: docker-validation.ts [--label name] -- command [args...] | --status",
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
		const result = await new Promise<number>((resolve, reject) => {
			child = spawn(command, commandArgs, {
				detached: true,
				stdio: ["inherit", "inherit", "inherit", lease!.descriptor],
				env: {
					...process.env,
					WALLPAPERDB_DOCKER_LEASE_FD: "3",
					WALLPAPERDB_DOCKER_LEASE_FILE: lease!.file,
				},
			});
			child.on("error", reject);
			child.on("close", (status, signal) =>
				resolve(
					interrupted ??
						status ??
						128 + constants.signals[signal as NodeJS.Signals],
				),
			);
		});
		await stopping;
		console.log(
			`Docker validation waited ${(lease.waitedMs / 1000).toFixed(1)}s; execution ${((Date.now() - start) / 1000).toFixed(1)}s; exit ${result}.`,
		);
		process.exitCode = result;
	}
} catch (caught) {
	const error = caught as NodeJS.ErrnoException & { status?: number };
	console.error(error.message);
	process.exitCode =
		interrupted ?? (error as Error & { status?: number }).status ?? 1;
} finally {
	await stopping;
	clearTimeout(killer);
	lease?.release();
}
