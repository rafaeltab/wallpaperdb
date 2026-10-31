import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const now = () => performance.now();
const absent = (error) => ["ENOENT", "ESRCH"].includes(error.code);
function identity(pid) {
	try {
		const stat = () => {
			const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			return text.slice(text.lastIndexOf(")") + 2).split(" ");
		};
		const before = stat();
		if (before[0] === "Z") return null;
		const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
		const after = stat();
		if (
			before[19] !== after[19] ||
			before[2] !== after[2] ||
			before[3] !== after[3]
		)
			throw Error("Preview identity changed during inspection");
		return {
			pid: Number(pid),
			startTicks: after[19],
			group: Number(after[2]),
			session: Number(after[3]),
			parentPid: Number(after[1]),
			cwd,
		};
	} catch (error) {
		if (absent(error)) return null;
		throw error;
	}
}
function valid(record) {
	return (
		Number.isSafeInteger(record?.pid) &&
		record.pid > 1 &&
		typeof record.startTicks === "string" &&
		/^\d+$/.test(record.startTicks)
	);
}
const same = (a, b) =>
	a &&
	b &&
	a.pid === b.pid &&
	a.startTicks === b.startTicks &&
	a.group === b.group &&
	a.session === b.session &&
	a.cwd === b.cwd;
function read(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
function write(file, value) {
	const temporary = `${file}.${process.pid}`;
	fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
	fs.renameSync(temporary, file);
}
function ownedSession(record, root) {
	if (
		!valid(record) ||
		record.cwd !== root ||
		record.pid !== record.group ||
		record.pid !== record.session
	)
		throw Error(
			"Preview forward session ownership unavailable; record retained",
		);
}
// Follow only recorded identities and their children. Reparented captured
// members remain obligations. A surviving uncaptured group fails closed.
function members(record, captured, root) {
	ownedSession(record, root);
	const leader = identity(record.pid);
	if (leader && leader.startTicks !== record.startTicks)
		throw Error("Preview forward PID reused; record retained");
	const visited = new Set(),
		live = [];
	const visit = (previous) => {
		const key = `${previous.pid}:${previous.startTicks}`;
		if (visited.has(key)) return;
		visited.add(key);
		const current = identity(previous.pid);
		if (!current || current.startTicks !== previous.startTicks) return;
		if (
			!same(current, previous) ||
			current.cwd !== root ||
			current.group !== record.group ||
			current.session !== record.session
		)
			throw Error("Preview forward member ownership changed; record retained");
		captured.set(key, current);
		live.push(current);
		let children;
		try {
			children = fs
				.readFileSync(
					`/proc/${current.pid}/task/${current.pid}/children`,
					"utf8",
				)
				.trim()
				.split(/\s+/)
				.filter(Boolean);
		} catch (error) {
			if (absent(error)) return;
			throw error;
		}
		for (const pid of children) {
			const child = identity(Number(pid));
			if (!child) continue;
			captured.set(`${child.pid}:${child.startTicks}`, child);
			visit(child);
		}
	};
	visit(record);
	for (const previous of [...captured.values()]) visit(previous);
	if (live.length === 0) {
		try {
			process.kill(-record.group, 0);
		} catch (error) {
			if (absent(error)) return [];
			throw error;
		}
		throw Error("Preview session has uncaptured members; record retained");
	}
	return live;
}
function signal(record, signalName) {
	if (!same(identity(record.pid), record)) return;
	try {
		process.kill(record.pid, signalName);
	} catch (error) {
		if (!absent(error)) throw error;
	}
}
function listens(records, port) {
	const inodes = new Set(
		fs
			.readFileSync("/proc/net/tcp", "utf8")
			.trim()
			.split("\n")
			.slice(1)
			.flatMap((line) => {
				const fields = line.trim().split(/\s+/);
				return fields[3] === "0A" &&
					fields[1] ===
						`0100007F:${port.toString(16).toUpperCase().padStart(4, "0")}`
					? [fields[9]]
					: [];
			}),
	);
	return records.some((record) => {
		if (!same(identity(record.pid), record)) return false;
		let found = false;
		try {
			found = fs.readdirSync(`/proc/${record.pid}/fd`).some((fd) => {
				try {
					return inodes.has(
						fs
							.readlinkSync(`/proc/${record.pid}/fd/${fd}`)
							.match(/^socket:\[(\d+)\]$/)?.[1],
					);
				} catch (error) {
					if (absent(error)) return false;
					throw error;
				}
			});
		} catch (error) {
			if (!absent(error)) throw error;
		}
		return same(identity(record.pid), record) && found;
	});
}
function legacyForward(prior, root, argv) {
	const file = `/proc/${prior.pid}/task/${prior.pid}/children`;
	const candidates = fs
		.readFileSync(file, "utf8")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.flatMap((pid) => {
			const current = identity(Number(pid));
			if (!current) return [];
			const command = fs
				.readFileSync(`/proc/${pid}/cmdline`, "utf8")
				.split("\0")
				.filter(Boolean);
			return command.slice(-argv.length).join("\0") === argv.join("\0")
				? [current]
				: [];
		});
	if (candidates.length !== 1 || candidates[0].cwd !== root)
		throw Error(
			"Legacy preview forward ownership unavailable; record retained",
		);
	ownedSession(candidates[0], root);
	return candidates[0];
}

// Own local handover and the complete forward lifetime. Application readiness,
// credentials and HTTP/upgrade semantics remain with the calling controller.
export async function runPreview({
	root,
	cli,
	argv,
	privatePort,
	port,
	server,
	ready,
	record,
}) {
	const began = now(),
		deadline = began + 10000,
		acquisitionEnd = deadline - 1000;
	const generation = randomUUID(),
		controller = identity(process.pid);
	const directory = path.join(root, ".boat"),
		file = path.join(directory, "preview-process.json"),
		acquisition = path.join(directory, "preview-acquisition.json"),
		progress = path.join(directory, `preview-progress-${generation}.json`);
	const claim = {
		...controller,
		generation,
		progress: path.basename(progress),
	};
	const state = {
		...controller,
		generation,
		progress: path.basename(progress),
		phase: "acquiring",
		ready: false,
		forward: null,
		captured: [],
	};
	const sockets = new Set();
	let acquired = false,
		published = false,
		child,
		terminal,
		closed = false,
		listening = false,
		stopping = false,
		failure,
		monitor,
		wake;
	const stopped = new Promise((resolve) => {
		wake = resolve;
	});
	const emit = (stage, detail = {}) =>
		record("preview-lifetime", {
			generation,
			controller,
			stage,
			elapsedMs: now() - began,
			...detail,
		});
	const ownsFile = (current) =>
		current?.generation === generation &&
		current.pid === controller.pid &&
		current.startTicks === controller.startTicks &&
		current.cwd === root;
	const capture = new Map();
	const persist = () => {
		state.captured = [...capture.values()];
		// The exclusive shared identity claim is never rewritten. Progress belongs
		// to this generation even if the shared claim becomes foreign/unreadable.
		if (acquired || published) write(progress, state);
		if (published && ownsFile(read(file))) write(file, state);
	};
	const cancel = () => {
		stopping = true;
		wake();
	};
	const onError = (error) => {
		failure ??= error;
		wake();
	};
	const onConnection = (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	};
	server.on("connection", onConnection);
	server.on("error", onError);
	process.on("SIGTERM", cancel);
	process.on("SIGINT", cancel);
	const check = () => {
		if (acquired && !ownsFile(read(acquisition)))
			throw Error("Preview acquisition ownership changed; record retained");
		if (stopping) throw Error("Preview acquisition cancelled");
		if (failure) throw failure;
		if (terminal)
			throw Error(
				`Preview forward exited before readiness (${terminal.code ?? terminal.signal})`,
			);
		if (now() >= acquisitionEnd)
			throw Error("Preview local acquisition allowance exhausted");
	};
	const survey = () =>
		state.forward ? members(state.forward, capture, root) : [];
	const removeOwn = (name) => {
		if (ownsFile(read(name))) fs.rmSync(name);
	};
	const dispose = async () => {
		clearInterval(monitor);
		for (const socket of sockets) socket.destroy();
		// close() also cancels a pending listen. Merely seeing listening=false
		// does not prove that an acquisition-time bind cannot complete later.
		let publicClosed = false;
		server.close((error) => {
			publicClosed = !error || error.code === "ERR_SERVER_NOT_RUNNING";
		});
		// Startup disposal stays inside acquisition's original total. Once serving,
		// failure gets the selected 1s disposal reserve measured from that failure,
		// independent of the expired acquisition clock. Cooperative stop is unchanged.
		const disposalBegan = now();
		const disposalEnd = published
			? disposalBegan + (failure ? 1000 : 10000)
			: Math.min(deadline, disposalBegan + 1000);
		const forceAt = published && !failure ? disposalEnd - 1000 : disposalBegan;
		let unresolved = [];
		try {
			if (state.forward) {
				let remaining = survey();
				persist();
				for (const member of remaining) signal(member, "SIGTERM");
				let killed = false;
				for (;;) {
					remaining = survey();
					if (remaining.length === 0 && closed) break;
					if (!killed && now() >= forceAt + 500) {
						killed = true;
						for (const member of remaining) signal(member, "SIGKILL");
					}
					if (now() >= disposalEnd) {
						unresolved = remaining;
						throw Error("Preview local disposal unresolved; record retained");
					}
					await pause();
				}
			} else if (child && !closed) {
				while (!closed && now() < disposalEnd) await pause();
				if (!closed)
					throw Error("Preview spawn closure unresolved; record retained");
			}
			while (!publicClosed && now() < disposalEnd) await pause();
			if (!publicClosed)
				throw Error("Preview listener disposal unresolved; record retained");
			if (state.spawnedPid && !state.forward)
				throw Error(
					"Preview spawned forward identity unavailable; record retained",
				);
			if (state.predecessor)
				throw Error(
					"Preview predecessor retirement unresolved; record retained",
				);
			state.phase = "retired";
			state.ready = false;
			state.terminal = terminal ?? null;
			state.closed = child ? closed : true;
			state.failure = failure?.message ?? null;
			state.unresolved = [];
			persist();
			removeOwn(file);
			removeOwn(acquisition);
			if (!failure) removeOwn(progress);
			emit("retired", {
				forward: state.forward,
				captured: [...capture.values()],
				terminal,
				closed,
			});
		} catch (error) {
			failure = failure
				? new Error(`${failure.message}; ${error.message}`)
				: error;
			state.phase = "unresolved";
			state.ready = false;
			state.terminal = terminal ?? null;
			state.closed = child ? closed : true;
			state.unresolved = unresolved.length ? unresolved : [...capture.values()];
			state.failure = failure.message;
			child?.unref();
			server.unref();
			try {
				if (acquired || published || state.spawnedPid || state.predecessor)
					write(progress, state);
				emit("unresolved", { ownership: state });
			} catch (evidenceError) {
				failure = new Error(`${failure.message}; ${evidenceError.message}`);
			}
		}
		process.removeListener("SIGTERM", cancel);
		process.removeListener("SIGINT", cancel);
		server.removeListener("error", onError);
	};
	let prior;
	try {
		if (!controller || controller.cwd !== root)
			throw Error("Preview controller ownership unavailable");
		fs.writeFileSync(acquisition, JSON.stringify(claim), {
			flag: "wx",
			mode: 0o600,
		});
		acquired = true;
		persist();
		prior = read(file);
		if (prior) {
			if (!valid(prior) || prior.pid === process.pid)
				throw Error("Preview predecessor identity invalid; record retained");
			const current = identity(prior.pid);
			if (current && current.startTicks !== prior.startTicks)
				throw Error("Preview predecessor identity changed; record retained");
			if (current && current.cwd !== root)
				throw Error("Preview predecessor cwd changed; record retained");
			const forward =
				prior.forward ?? (current && legacyForward(current, root, argv));
			if (!forward)
				throw Error("Preview predecessor descendants unknown; record retained");
			const captured = new Map(
				(prior.captured ?? []).map((p) => [`${p.pid}:${p.startTicks}`, p]),
			);
			let remaining = members(forward, captured, root);
			state.predecessor = {
				...prior,
				forward,
				captured: [...captured.values()],
			};
			persist();
			if (current) signal(current, "SIGTERM");
			emit("predecessor-signalled", { predecessor: state.predecessor });
			for (;;) {
				check();
				const live = identity(prior.pid);
				remaining = members(forward, captured, root);
				state.predecessor.captured = [...captured.values()];
				persist();
				if (
					(!live || live.startTicks !== prior.startTicks) &&
					remaining.length === 0
				)
					break;
				if (live && (!same(live, current) || live.cwd !== root))
					throw Error("Preview predecessor ownership changed; record retained");
				await pause();
			}
			delete state.predecessor;
			emit("predecessor-retired", { predecessor: prior, forward });
		}
		check();
		child = spawn(cli, argv, { cwd: root, stdio: "inherit", detached: true });
		child.on("error", onError);
		child.on("exit", (code, signalName) => {
			terminal = { code, signal: signalName };
			wake();
		});
		child.on("close", () => {
			closed = true;
			wake();
		});
		if (child.pid) {
			state.spawnedPid = child.pid;
			state.forward = identity(child.pid);
			ownedSession(state.forward, root);
			capture.set(
				`${state.forward.pid}:${state.forward.startTicks}`,
				state.forward,
			);
			persist();
			emit("forward-spawned", { forward: state.forward });
		}
		server.listen(port, "127.0.0.1", () => {
			listening = true;
		});
		for (;;) {
			check();
			if (!child.pid) {
				await pause();
				continue;
			}
			const current = survey();
			persist();
			if (listening && listens(current, privatePort)) break;
			await pause();
		}
		check();
		state.ready = true;
		state.phase = "ready";
		persist();
		write(file, state);
		published = true;
		emit("ready", { forward: state.forward, captured: state.captured });
		ready();
		removeOwn(acquisition);
		acquired = false;
		monitor = setInterval(() => {
			try {
				const size = capture.size;
				survey();
				if (capture.size !== size) persist();
			} catch (error) {
				onError(error);
			}
		}, 20);
		await stopped;
		if (failure) throw failure;
		if (!stopping)
			throw Error(
				`Preview forward exited after readiness (${terminal?.code ?? terminal?.signal})`,
			);
	} catch (error) {
		failure = error;
		state.ready = false;
		state.phase = "failed";
		state.failure = error.message;
		try {
			persist();
			emit("failed", { message: error.message });
		} catch (evidenceError) {
			failure = new Error(`${error.message}; ${evidenceError.message}`);
		}
	} finally {
		await dispose();
	}
	if (failure) throw failure;
}
