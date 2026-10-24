import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

function identity(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const end = stat.lastIndexOf(")");
		const fields = stat
			.slice(end + 2)
			.trim()
			.split(/\s+/);
		if (
			end < 0 ||
			Number(stat.slice(0, stat.indexOf(" "))) !== pid ||
			fields.length < 20 ||
			!/^[RSDZTWtXxKIP]$/.test(fields[0]) ||
			!/^\d+$/.test(fields[19]) ||
			![fields[2], fields[3]].every(
				(value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)),
			)
		)
			throw new Error("Invalid process identity");
		return {
			pid,
			pgid: Number(fields[2]),
			sid: Number(fields[3]),
			startTicks: fields[19],
		};
	} catch (error) {
		if (["ENOENT", "ESRCH"].includes(error.code)) return null;
		throw new Error("Process identity unavailable");
	}
}

function groupAbsent(pgid) {
	// Include zombies. Unreadable/malformed metadata is unknown, never empty.
	for (const name of readdirSync("/proc")) {
		if (/^\d+$/.test(name) && identity(Number(name))?.pgid === pgid)
			return false;
	}
	try {
		process.kill(-pgid, 0);
		return false;
	} catch (error) {
		if (error.code === "ESRCH") return true;
		throw new Error("Process group observation unavailable");
	}
}

/** Interrupt the command leader, then confirm its owned Linux group stopped. */
export function runBounded(
	command,
	args,
	{ budgetMs, graceMs = 15_000, failureSignal, stdio = "inherit", ...options },
) {
	if (!Number.isFinite(budgetMs) || budgetMs <= 0)
		throw new Error("A positive budget is required");
	if (!Number.isFinite(graceMs) || graceMs < 0)
		throw new Error("A nonnegative grace is required");
	const executionDeadline = performance.now() + budgetMs;
	let hardDeadline = executionDeadline + graceMs;
	const shutdown = {
		confirmed: false,
		platform: process.platform,
		executionDeadline,
		deadline: hardDeadline,
		receipts: [],
	};
	const record = (event, fields = {}) => {
		if (shutdown.receipts.length < 24)
			shutdown.receipts.push({
				event,
				at: Date.now(),
				monotonic: performance.now(),
				...fields,
			});
	};
	const descriptors = Array.isArray(stdio) ? [...stdio] : [stdio, stdio, stdio];
	while (descriptors.length < 3) descriptors.push("ignore");
	// Preserve inherited descriptors, especially the Docker lease's exact slot.
	// Piped/IPC streams have no supported public consumer in this runner.
	if (
		process.platform !== "linux" ||
		descriptors.some(
			(fd) =>
				!["inherit", "ignore"].includes(fd) &&
				!(Number.isInteger(fd) && fd >= 0),
		)
	) {
		shutdown.failure =
			process.platform !== "linux"
				? "linux-process-ownership-required"
				: "unsupported-runner-stdio";
		record("failure");
		return Promise.resolve({ outcome: "failed", shutdown });
	}
	const commandStdio = descriptors.map((fd, slot) =>
		fd === "ignore" ? "ignore" : slot,
	);
	return new Promise((resolve) => {
		const anchor = spawn(
			process.execPath,
			[
				fileURLToPath(
					new URL("./mutation-process-anchor.mjs", import.meta.url),
				),
				command,
				...args,
			],
			{
				...options,
				stdio: [...descriptors, "ipc"],
				detached: true,
				// A caller's shell/argv0 apply to the command, not the Node anchor.
				shell: false,
				argv0: undefined,
			},
		);
		let owner,
			outcome,
			leaderExit,
			anchorExited = false,
			killing = false,
			settled = false;
		let forceTimer, executionTimer, confirmationTimer;
		const fail = (reason) => {
			if (!shutdown.failure)
				hardDeadline = Math.min(hardDeadline, performance.now() + graceMs);
			shutdown.deadline = hardDeadline;
			shutdown.failure ??= reason;
			outcome = "failed";
		};
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(forceTimer);
			clearTimeout(executionTimer);
			clearTimeout(confirmationTimer);
			process.removeListener("SIGINT", interrupt);
			process.removeListener("SIGTERM", interrupt);
			failureSignal?.removeEventListener("abort", fixtureFailed);
			if (anchor.connected) anchor.disconnect();
			anchor.unref();
			resolve({
				outcome: shutdown.confirmed
					? (outcome ?? (leaderExit?.code === 0 ? "completed" : "failed"))
					: "failed",
				code: leaderExit?.code ?? null,
				signal: leaderExit?.signal ?? null,
				shutdown,
			});
		};
		const confirm = () => {
			if (settled) return;
			try {
				if (anchorExited && owner && groupAbsent(owner.pgid)) {
					if (performance.now() > hardDeadline) fail("shutdown-deadline");
					else shutdown.confirmed = true;
					record(shutdown.confirmed ? "group-quiescent" : "failure");
					finish();
					return;
				}
			} catch {
				fail("group-observation-unavailable");
				record("failure");
				finish();
				return;
			}
			if (performance.now() >= hardDeadline) {
				fail("group-survived-or-unknown-at-deadline");
				record("deadline");
				finish();
			} else
				confirmationTimer = setTimeout(
					confirm,
					Math.max(0, Math.min(25, hardDeadline - performance.now())),
				);
		};
		const force = () => {
			if (settled || killing) return;
			killing = true;
			clearTimeout(forceTimer);
			try {
				const current = owner && identity(owner.pid);
				if (
					!current ||
					anchorExited ||
					current.startTicks !== owner.startTicks ||
					current.pgid !== owner.pid ||
					current.sid !== owner.pid
				) {
					fail("anchor-identity-lost");
					record("failure");
				} else {
					process.kill(-owner.pgid, "SIGKILL");
					record("group-kill-dispatched");
				}
			} catch {
				fail("group-kill-unconfirmed");
				record("failure");
			}
			confirm();
		};
		const scheduleForce = () => {
			clearTimeout(forceTimer);
			// Confirm within the original grace; never allocate fresh grace on exit.
			forceTimer = setTimeout(
				force,
				Math.max(
					0,
					hardDeadline - Math.min(250, graceMs / 4) - performance.now(),
				),
			);
		};
		const send = (message) => {
			if (!anchor.connected) {
				fail("anchor-channel-unavailable");
				force();
				return;
			}
			anchor.send(message, (error) => {
				if (error && !killing && !settled) {
					fail("anchor-channel-unavailable");
					force();
				}
			});
		};
		const stop = (reason) => {
			if (settled || outcome) return;
			outcome = reason;
			hardDeadline = Math.min(hardDeadline, performance.now() + graceMs);
			shutdown.deadline = hardDeadline;
			if (!killing) {
				record("leader-interrupt-requested", { reason });
				send({ type: "interrupt" });
				scheduleForce();
			}
		};
		const interrupt = () => stop("cancelled");
		const fixtureFailed = () => stop("failed");
		process.once("SIGINT", interrupt);
		process.once("SIGTERM", interrupt);
		failureSignal?.addEventListener("abort", fixtureFailed, { once: true });
		executionTimer = setTimeout(
			() => stop("budget-exhausted"),
			Math.max(0, executionDeadline - performance.now()),
		);
		anchor.once("spawn", () => {
			try {
				owner = identity(anchor.pid);
				if (!owner || owner.pgid !== anchor.pid || owner.sid !== anchor.pid)
					throw new Error();
				Object.assign(shutdown, owner);
				record("anchor-owned");
				send({
					type: "start",
					stdio: commandStdio,
					shell: options.shell ?? false,
					argv0: options.argv0,
				});
				if (failureSignal?.aborted) fixtureFailed();
			} catch {
				fail("anchor-ownership-unavailable");
				force();
			}
		});
		anchor.on("message", (message) => {
			if (settled || killing) return;
			if (
				message?.type === "leader-start" &&
				Number.isSafeInteger(message.pid) &&
				message.pid > 0
			) {
				shutdown.leaderPid = message.pid;
				record("leader-start", { pid: message.pid });
			} else if (message?.type === "leader-exit") {
				clearTimeout(executionTimer);
				leaderExit = {
					code: Number.isInteger(message.code) ? message.code : null,
					signal: Object.hasOwn(constants.signals, message.signal)
						? message.signal
						: null,
				};
				record("leader-exit", leaderExit);
				force();
			} else if (message?.type === "leader-interrupt")
				record("leader-interrupt-dispatched");
			else {
				fail("anchor-protocol-failure");
				force();
			}
		});
		anchor.once("error", () => {
			fail("anchor-spawn-or-channel-failure");
			force();
		});
		anchor.once("exit", (code) => {
			anchorExited = true;
			record("anchor-exit", { code });
			if (!killing) {
				fail("anchor-exited-before-group-stop");
				force();
			}
		});
	});
}
