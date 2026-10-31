import fs from "node:fs";
import { randomUUID } from "node:crypto";

const now = () => performance.now();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const allocation = {
	lock: [10000, 10000],
	initial: [10000, 20000],
	retirement: [15000, 35000],
	cleanup: [25000, 60000],
	submission: [15000, 75000],
	observation: [10000, 165000],
	usage: [10000, 175000],
	disposal: [5000, 180000],
};

// Private enrollment can tighten, never enlarge, the one shutdown enclosure.
export function shutdownBudget(milliseconds = 180000, record = () => {}) {
	if (
		!Number.isSafeInteger(milliseconds) ||
		milliseconds <= 0 ||
		milliseconds > 180000
	)
		throw new Error(
			"shutdownBudgetMs must be a positive integer no greater than 180000",
		);
	const start = now();
	const ratio = milliseconds / 180000;
	const id = randomUUID();
	record({ kind: "budget", shutdownId: id, budgetMs: milliseconds });
	const receipt = (value) =>
		record({ ...value, shutdownId: id, elapsedMs: now() - start });
	return {
		id,
		remaining(phase) {
			return Math.max(0, start + allocation[phase][1] * ratio - now());
		},
		phase(phase) {
			const [cap, cutoff] = allocation[phase];
			const deadline = Math.min(now() + cap * ratio, start + cutoff * ratio);
			receipt({
				kind: "phase",
				phase,
				deadlineMs: deadline - start,
				disposalMs: 1000 * ratio,
			});
			return { phase, deadline, disposalMs: 1000 * ratio, record: receipt };
		},
	};
}

function identity(pid) {
	try {
		const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
		return {
			pid: Number(pid),
			parent: Number(fields[1]),
			group: Number(fields[2]),
			session: Number(fields[3]),
			birth: fields[19],
			zombie: fields[0] === "Z",
		};
	} catch (error) {
		if (["ENOENT", "ESRCH"].includes(error.code)) return null;
		throw error;
	}
}
const same = (a, b) =>
	a &&
	b &&
	a.pid === b.pid &&
	a.birth === b.birth &&
	a.group === b.group &&
	a.session === b.session;
function groupMembers(leader) {
	return fs
		.readdirSync("/proc")
		.filter((pid) => /^\d+$/.test(pid))
		.flatMap((pid) => {
			const member = identity(pid);
			return member &&
				!member.zombie &&
				member.group === leader.group &&
				member.session === leader.session &&
				BigInt(member.birth) >= BigInt(leader.birth)
				? [member]
				: [];
		});
}
function signalOwned(members, signal) {
	for (const member of members) {
		if (!same(identity(member.pid), member)) continue;
		try {
			process.kill(member.pid, signal);
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
}

// Own only this fresh session/group and its observed identities. Arbitrary
// daemon/session escapes are NOT contained by procfs polling or this receipt.
export function finiteShutdownProcess(child, phase) {
	return new Promise((resolve, reject) => {
		let leader, ownershipFailure;
		try {
			leader = identity(child.pid);
		} catch {
			ownershipFailure = "local process identity unavailable";
		}
		const observed = new Map();
		if (leader && leader.pid === leader.group && leader.pid === leader.session)
			observed.set(`${leader.pid}:${leader.birth}`, leader);
		let closed = false,
			terminal,
			failure = ownershipFailure,
			cancelling = false,
			killed = false,
			finished = false;
		const remember = () => {
			if (
				!leader ||
				leader.pid !== leader.group ||
				leader.pid !== leader.session
			)
				return [];
			const members = groupMembers(leader);
			for (const p of members) observed.set(`${p.pid}:${p.birth}`, p);
			// An observed member that changes session is unresolved, not permission
			// to kill an unverified group or report complete local disposal.
			for (const p of observed.values()) {
				const current = identity(p.pid);
				if (
					current &&
					!current.zombie &&
					current.birth === p.birth &&
					!same(current, p)
				) {
					failure = "observed local process escaped session ownership";
					members.push(current);
				}
			}
			return members;
		};
		const finish = (members) => {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			child.stdin?.destroy();
			child.stdout?.destroy();
			child.stderr?.destroy();
			const receipt = {
				phase: phase.phase,
				spawnedPid: child.pid,
				leader,
				observed: [...observed.values()],
				unresolved: leader
					? members
					: [{ pid: child.pid, reason: "identity-unavailable" }],
				pipesClosed: closed,
				terminal,
				failure,
			};
			// Closing handles bounds this controller even if the kernel cannot retire
			// a process. Its exact unresolved identity remains a failed receipt.
			child.unref();
			try {
				phase.record(receipt);
			} catch {
				failure = "local disposal evidence write failed";
			}
			if (failure || members.length || !closed)
				reject(
					new Error(
						`Shutdown ${phase.phase}: ${failure ?? "local ownership unresolved"}${members.length ? "; local ownership unresolved" : ""}`,
					),
				);
			else resolve(terminal);
		};
		const tick = () => {
			if (finished) return;
			let members;
			try {
				members = remember();
			} catch {
				failure = "process ownership inspection failed";
				members = [...observed.values()].filter((p) => {
					try {
						return same(identity(p.pid), p);
					} catch {
						return true;
					}
				});
			}
			if (now() >= phase.deadline - phase.disposalMs)
				failure ??= "deadline exceeded";
			if (closed && members.length === 0) {
				finish(members);
				return;
			}
			if (now() >= phase.deadline - phase.disposalMs && !cancelling) {
				cancelling = true;
				failure ??= "deadline exceeded";
				child.stdin?.destroy();
				try {
					signalOwned(
						members.filter((p) => same(observed.get(`${p.pid}:${p.birth}`), p)),
						"SIGTERM",
					);
				} catch {
					failure = "local TERM failed";
				}
			}
			if (now() >= phase.deadline - phase.disposalMs / 2 && !killed) {
				killed = true;
				try {
					signalOwned(
						members.filter((p) => same(observed.get(`${p.pid}:${p.birth}`), p)),
						"SIGKILL",
					);
				} catch {
					failure = "local KILL failed";
				}
			}
			// Revalidate every observed identity even when its leader has already exited.
			if (now() >= phase.deadline) finish(members);
		};
		child.on("exit", (code, signal) => {
			terminal = { code, signal };
		});
		child.on("close", (code, signal) => {
			closed = true;
			terminal = { code, signal };
			tick();
		});
		child.on("error", () => {
			failure = "local spawn failed";
		});
		const timer = setInterval(
			tick,
			Math.max(1, Math.min(20, phase.disposalMs / 5)),
		);
		if (!leader || leader.pid !== leader.group || leader.pid !== leader.session)
			failure = "fresh local session ownership unavailable";
		tick();
	});
}

export async function retireShutdownTunnel(record, protectedPids, phase) {
	if (!record?.pid) return;
	if (
		!Number.isSafeInteger(record.pid) ||
		record.pid <= 1 ||
		typeof record.startTicks !== "string" ||
		!/^\d+$/.test(record.startTicks)
	)
		throw new Error(
			"Shutdown disposal: incomplete tunnel identity; record retained",
		);
	const current = identity(record.pid);
	if (!current || current.zombie) {
		const survivors = groupMembers({
			group: record.pid,
			session: record.pid,
			birth: record.startTicks,
		});
		if (survivors.length) {
			phase.record({ phase: "tunnel-disposal", unresolved: survivors });
			throw new Error(
				"Shutdown disposal: tunnel leader unavailable; ownership record retained",
			);
		}
		return;
	}
	if (current.birth !== record.startTicks)
		throw new Error(
			"Shutdown disposal: tunnel identity changed; record retained",
		);
	if (
		protectedPids.includes(record.pid) ||
		record.pid !== current.group ||
		record.pid !== current.session
	)
		throw new Error(
			"Shutdown disposal: tunnel ownership unresolved; record retained",
		);
	const leader = current;
	const controller = identity(process.pid);
	let members = groupMembers(leader);
	if (
		members.some((p) => protectedPids.includes(p.pid)) ||
		leader.group === controller.group ||
		leader.session === controller.session
	)
		throw new Error(
			"Shutdown disposal: tunnel group overlaps protected resources; record retained",
		);
	const observed = new Map(members.map((p) => [`${p.pid}:${p.birth}`, p]));
	const remaining = () => {
		const group = groupMembers(leader);
		for (const p of group) observed.set(`${p.pid}:${p.birth}`, p);
		for (const p of observed.values()) {
			const live = identity(p.pid);
			if (live && !live.zombie && live.birth === p.birth && !same(live, p))
				group.push(live);
		}
		return group;
	};
	signalOwned(members, "SIGTERM");
	while (members.length && now() < phase.deadline) {
		if (now() >= phase.deadline - phase.disposalMs / 2)
			signalOwned(
				members.filter((p) => same(observed.get(`${p.pid}:${p.birth}`), p)),
				"SIGKILL",
			);
		await pause(Math.max(1, Math.min(20, phase.deadline - now())));
		members = remaining();
	}
	phase.record({
		phase: "tunnel-disposal",
		leader,
		observed: [...observed.values()],
		unresolved: members,
	});
	if (members.length)
		throw new Error("Shutdown disposal: tunnel did not exit; record retained");
}
