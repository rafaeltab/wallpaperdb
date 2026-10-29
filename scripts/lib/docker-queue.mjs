import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const defaultDockerLock = "/tmp/wallpaperdb-perf-validation.lock";

function identity(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		if (fields[0] === "Z") return null;
		return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${fields[19]}`;
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ESRCH") return null;
		throw error;
	}
}

function safeStat(stat, directory = false) {
	return (
		(directory ? stat.isDirectory() : stat.isFile()) &&
		stat.uid === process.getuid() &&
		!(stat.mode & 0o022) &&
		(directory || stat.nlink === 1)
	);
}

function openLock(file) {
	let fd;
	try {
		fd = openSync(
			file,
			constants.O_CREAT |
				constants.O_RDWR |
				constants.O_APPEND |
				constants.O_NOFOLLOW |
				constants.O_NONBLOCK,
			0o600,
		);
		const stat = fstatSync(fd);
		if (!safeStat(stat) || stat.size !== 0)
			throw new Error(
				"expected an empty owned regular file without hard links or group/other write access",
			);
		return fd;
	} catch (error) {
		if (fd !== undefined) closeSync(fd);
		throw new Error(`Unsafe Docker host lock target ${file}: ${error.message}`);
	}
}

function verifyLock(file, fd) {
	const current = lstatSync(file);
	const opened = fstatSync(fd);
	if (
		!safeStat(current) ||
		!safeStat(opened) ||
		current.ino !== opened.ino ||
		current.dev !== opened.dev ||
		opened.size !== 0
	)
		throw new Error(
			`Unsafe Docker host lock target ${file}: file changed while acquiring ownership.`,
		);
}

function directoryFor(file, create) {
	const directory = `${file}.queue`;
	if (create) {
		try {
			mkdirSync(directory, { mode: 0o700 });
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
	}
	try {
		if (!safeStat(lstatSync(directory), true))
			throw new Error(`Unsafe Docker queue directory ${directory}`);
	} catch (error) {
		if (!create && error.code === "ENOENT") return null;
		throw error;
	}
	return directory;
}

function entries(directory, prune) {
	if (!directory) return [];
	const result = [];
	for (const name of readdirSync(directory)
		.filter((name) => /^\d{24}-[a-f0-9-]+\.json$/.test(name))
		.sort()) {
		const path = join(directory, name);
		let record;
		try {
			const stat = lstatSync(path);
			if (!safeStat(stat) || stat.size > 4096)
				throw new Error(`Unsafe Docker queue entry ${path}`);
			record = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (
			!Number.isSafeInteger(record.pid) ||
			record.pid <= 0 ||
			typeof record.identity !== "string" ||
			typeof record.label !== "string" ||
			!["waiting", "running"].includes(record.state)
		)
			throw new Error(`Invalid Docker queue entry ${path}`);
		if (identity(record.pid) !== record.identity) {
			if (prune) {
				try {
					unlinkSync(path);
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
				}
			}
			continue;
		}
		result.push({ ...record, name });
	}
	return result;
}

function saveTicket(path, record) {
	const temporary = `${path}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(record), {
			flag: "wx",
			mode: 0o600,
		});
		renameSync(temporary, path);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch (cleanup) {
			if (cleanup.code !== "ENOENT")
				throw new AggregateError(
					[error, cleanup],
					"Docker queue publication and cleanup failed.",
				);
		}
		throw error;
	}
}

export function inspectDockerQueue(file = defaultDockerLock) {
	return entries(directoryFor(file, false), false);
}

function lock(fd) {
	const result = spawnSync("flock", ["-E", "75", "-n", "3"], {
		stdio: ["ignore", "pipe", "pipe", fd],
		encoding: "utf8",
		timeout: 1000,
	});
	if (result.error)
		throw new Error(
			`Docker validation requires flock (util-linux): ${result.error.message}`,
		);
	if (result.status === 0) return true;
	if (result.status === 75) return false;
	throw new Error(
		`Docker host lock failed: ${result.stderr || result.signal || result.status}`,
	);
}

async function waitForLock(fd, timeoutMs, signal, reportProgress) {
	return await new Promise((resolve, reject) => {
		const child = spawn(
			"flock",
			["-E", "75", "-w", String(timeoutMs / 1000), "3"],
			{
				stdio: ["ignore", "ignore", "pipe", fd],
				signal,
			},
		);
		let stderr = "";
		let progressFailure;
		const ticker = setInterval(() => {
			try {
				reportProgress();
			} catch (error) {
				progressFailure = error;
				child.kill("SIGTERM");
			}
		}, 5000);
		child.stderr.on("data", (data) => {
			stderr = (stderr + data).slice(0, 4096);
		});
		child.once("error", (error) => {
			clearInterval(ticker);
			reject(error);
		});
		child.once("close", (status, termination) => {
			clearInterval(ticker);
			if (progressFailure) reject(progressFailure);
			else if (status === 0) resolve(true);
			else if (status === 75) resolve(false);
			else
				reject(
					new Error(
						`Docker host lock failed: ${stderr || termination || status}`,
					),
				);
		});
	});
}

export async function acquireDockerLease({
	file = defaultDockerLock,
	timeoutSeconds = "900",
	label = "validation",
	signal,
	report = () => {},
} = {}) {
	// #557 workers deliberately measure contention without a Docker scheduler.
	// A real descriptor preserves the existing launcher contract without a lock.
	if (process.env.WALLPAPERDB_BOAT_WORKER === "1") {
		const descriptor = openSync("/dev/null", "r");
		return { descriptor, file, waitedMs: 0, release: () => closeSync(descriptor) };
	}
	file = resolve(file);
	if (
		!/^\d+$/.test(String(timeoutSeconds)) ||
		!Number.isSafeInteger(Number(timeoutSeconds) * 1000) ||
		Number(timeoutSeconds) <= 0
	)
		throw new Error(
			"Docker validation timeout must be a positive integer in seconds.",
		);
	if (!/^[\w .:/-]{1,160}$/.test(label))
		throw new Error("Invalid Docker validation label.");
	const inherited = process.env.WALLPAPERDB_DOCKER_LEASE_FD;
	if (
		inherited !== undefined &&
		process.env.WALLPAPERDB_DOCKER_LEASE_FILE === file
	) {
		if (!/^\d+$/.test(inherited) || Number(inherited) < 3)
			throw new Error("Invalid inherited Docker lease descriptor.");
		const descriptor = Number(inherited);
		try {
			verifyLock(file, descriptor);
		} catch (error) {
			throw new Error(
				`Cannot reuse inherited Docker lock descriptor ${descriptor}. The launcher may have closed or replaced it. Forward WALLPAPERDB_DOCKER_LEASE_FD through every launcher, or run the coordinated Make target directly. ${error.message}`,
				{ cause: error },
			);
		}
		// fdinfo reports locks on this open file description without acquiring one.
		const info = readFileSync(`/proc/self/fdinfo/${descriptor}`, "utf8");
		if (
			!/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+\S+\s+0\s+EOF$/m.test(
				info,
			)
		)
			throw new Error(
				"Inherited Docker lease does not own the selected host lock.",
			);
		report("Reusing the inherited Docker host lock.");
		return { descriptor, file, waitedMs: 0, release() {} };
	}
	const fd = openLock(file);
	let ticket;
	let released = false;
	const started = Date.now();
	const deadline = started + Number(timeoutSeconds) * 1000;
	function release() {
		if (released) return;
		released = true;
		try {
			if (ticket) unlinkSync(ticket);
		} finally {
			closeSync(fd);
		}
	}
	try {
		const directory = directoryFor(file, true);
		const name = `${process.hrtime.bigint().toString().padStart(24, "0")}-${randomUUID()}.json`;
		const destination = join(directory, name);
		const record = {
			pid: process.pid,
			identity: identity(process.pid),
			label,
			workspace: basename(process.cwd()),
			state: "waiting",
			queuedAt: new Date(started).toISOString(),
		};
		if (!record.identity)
			throw new Error(
				"Docker validation requires Linux procfs to identify queue owners.",
			);
		saveTicket(destination, record);
		ticket = destination;
		report(
			`Waiting for Docker host lock ${file} (deadline ${timeoutSeconds}s)...`,
		);
		let lastReport = 0;
		function reportBusy(queue = entries(directory, true)) {
			const owner = queue.find((entry) => entry.state === "running");
			report(
				`Docker host lock busy; owner: ${owner ? `${owner.label} (${owner.workspace}, pid ${owner.pid})` : "unregistered flock user"}; ${queue.filter((entry) => entry.state === "waiting").length} waiting; ${Math.ceil(Math.max(0, deadline - Date.now()) / 1000)}s remaining.`,
			);
			lastReport = Date.now();
		}
		while (true) {
			signal?.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining <= 0)
				throw Object.assign(
					new Error("Docker host lock timed out before execution."),
					{ status: 75 },
				);
			const queue = entries(directory, true);
			if (queue[0]?.name === name) {
				let acquired = lock(fd);
				if (!acquired) {
					reportBusy(queue);
					acquired = await waitForLock(fd, remaining, signal, reportBusy);
				}
				signal?.throwIfAborted();
				if (!acquired)
					throw Object.assign(
						new Error("Docker host lock timed out before execution."),
						{ status: 75 },
					);
				verifyLock(file, fd);
				record.state = "running";
				record.startedAt = new Date().toISOString();
				saveTicket(ticket, record);
				const waitedMs = Date.now() - started;
				report(
					`Docker host lock acquired after ${(waitedMs / 1000).toFixed(1)}s.`,
				);
				return { descriptor: fd, file, waitedMs, release };
			}
			if (Date.now() - lastReport >= 5000) {
				reportBusy(queue);
			}
			await delay(Math.min(100, remaining), undefined, { signal });
		}
	} catch (error) {
		release();
		throw error;
	}
}
