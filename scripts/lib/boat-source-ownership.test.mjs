import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { finiteShutdownProcess } from "./boat-shutdown.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processIdentity(pid) {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
		const fields = stat
			.slice(stat.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		return {
			pid,
			parent: Number(fields[1]),
			group: Number(fields[2]),
			session: Number(fields[3]),
			birth: fields[19],
			zombie: fields[0] === "Z",
			cwd: fields[0] === "Z" ? null : fs.readlinkSync(`/proc/${pid}/cwd`),
		};
	} catch (error) {
		if (["ENOENT", "ESRCH"].includes(error.code)) return null;
		throw error;
	}
}

function sameProcess(current, captured) {
	return (
		current &&
		captured &&
		current.pid === captured.pid &&
		current.birth === captured.birth &&
		current.group === captured.group &&
		current.session === captured.session
	);
}

function safetyKill(captured) {
	const current = processIdentity(captured.pid);
	const killed = !!sameProcess(current, captured) && !current.zombie;
	if (killed) {
		try {
			process.kill(current.pid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	}
	return { captured, before: current, killed };
}

async function observed(read, deadline, label) {
	while (performance.now() < deadline) {
		const value = read();
		if (value) return value;
		await pause(10);
	}
	throw new Error(`Independent observation deadline: ${label}`);
}

const helperScript = `
const fs = require('node:fs');
const path = require('node:path');
const [control, changedCwd] = process.argv.slice(2);
process.on('SIGTERM', () => fs.appendFileSync(path.join(control, 'helper-signals'), 'SIGTERM\\n'));
let ready = false, changed = false;
setInterval(() => {
  if (!ready && fs.existsSync(path.join(control, 'release-ready'))) {
    ready = true;
    fs.writeFileSync(path.join(control, 'ready'), String(process.pid));
    process.stdout.write('fixture-ready\\n');
  }
  if (ready && !changed && fs.existsSync(path.join(control, 'release-cwd'))) {
    changed = true;
    process.chdir(changedCwd);
    fs.writeFileSync(path.join(control, 'changed'), process.cwd());
    process.stdout.write('fixture-cwd-changed\\n');
  }
}, 5);
`;

const leaderScript = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [control, helperScript, changedCwd] = process.argv.slice(2);
const helper = spawn(process.execPath, [helperScript, control, changedCwd], {
  stdio: ['ignore', 'inherit', 'inherit']
});
fs.writeFileSync(path.join(control, 'helper-pid'), String(helper.pid));
setInterval(() => {}, 1000);
`;

test("source local ownership retains an unresolved helper after its captured cwd changes", async (t) => {
	const evidenceRoot = process.env.BOAT_SOURCE_OWNERSHIP_EVIDENCE_DIR;
	if (evidenceRoot)
		fs.mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
	const directory = fs.mkdtempSync(
		path.join(evidenceRoot || os.tmpdir(), "boat-source-ownership-"),
	);
	const originalCwd = path.join(directory, "original");
	const changedCwd = path.join(directory, "changed-cwd");
	const control = path.join(directory, "control");
	for (const dir of [originalCwd, changedCwd, control])
		fs.mkdirSync(dir, { mode: 0o700 });
	const helperFile = path.join(directory, "helper.cjs");
	const leaderFile = path.join(directory, "leader.cjs");
	fs.writeFileSync(helperFile, helperScript, { mode: 0o600 });
	fs.writeFileSync(leaderFile, leaderScript, { mode: 0o600 });
	const recordFile = path.join(directory, "ownership.jsonl");
	const recordFd = fs.openSync(recordFile, "wx", 0o600);
	const receipts = [];
	const writeJson = (name, value) =>
		fs.writeFileSync(
			path.join(directory, name),
			JSON.stringify(value, null, 2),
			{
				mode: 0o600,
			},
		);
	const snapshot = (name, pid) => {
		const identity = processIdentity(pid);
		writeJson(`${name}.json`, identity);
		if (identity && !identity.zombie) {
			fs.writeFileSync(
				path.join(directory, `${name}.stat`),
				fs.readFileSync(`/proc/${pid}/stat`),
				{ mode: 0o600 },
			);
			writeJson(`${name}.pipes.json`, {
				stdout: fs.readlinkSync(`/proc/${pid}/fd/1`),
				stderr: fs.readlinkSync(`/proc/${pid}/fd/2`),
			});
		}
		return identity;
	};

	let leader, helper, child, outcome, settledAt, changedAt, verdict;
	let watchdog;
	// Start this independent bound before any awaited readiness or disposal.
	const start = performance.now();
	const observationDeadline = start + 8000;
	const independentDeadline = new Promise((_, reject) => {
		watchdog = setTimeout(
			() => reject(new Error("Independent source ownership watchdog expired")),
			observationDeadline - performance.now(),
		);
	});
	const phase = {
		phase: "source-cwd-control",
		sourceScope: { cwd: originalCwd },
		deadline: Infinity,
		disposalMs: 2000,
		record(receipt) {
			fs.writeSync(recordFd, `${JSON.stringify(receipt)}\n`);
			fs.fsyncSync(recordFd);
			receipts.push(structuredClone(receipt));
		},
	};
	try {
		child = spawn(
			process.execPath,
			[leaderFile, control, helperFile, changedCwd],
			{
				cwd: originalCwd,
				detached: true,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		for (const [name, stream] of [
			["stdout", child.stdout],
			["stderr", child.stderr],
		])
			stream.on("data", (bytes) =>
				fs.appendFileSync(path.join(directory, name), bytes, { mode: 0o600 }),
			);
		const managed = finiteShutdownProcess(child, phase).then(
			(value) => {
				settledAt = performance.now();
				outcome = { resolved: value };
				return outcome;
			},
			(error) => {
				settledAt = performance.now();
				outcome = { rejected: error.message };
				return outcome;
			},
		);
		await Promise.race([
			independentDeadline,
			(async () => {
				leader = snapshot("leader-before-ready", child.pid);
				assert.ok(leader && !leader.zombie);
				assert.equal(leader.pid, leader.group);
				assert.equal(leader.pid, leader.session);
				assert.equal(leader.cwd, originalCwd);
				const helperPid = await observed(
					() =>
						fs.existsSync(path.join(control, "helper-pid")) &&
						Number(fs.readFileSync(path.join(control, "helper-pid"), "utf8")),
					observationDeadline,
					"the owned leader's helper PID",
				);
				helper = snapshot("helper-before-ready", helperPid);
				assert.ok(helper && !helper.zombie);
				assert.equal(helper.parent, leader.pid);
				assert.equal(helper.cwd, originalCwd);
				assert.equal(helper.group, leader.group);
				assert.equal(helper.session, leader.session);
				const children = fs.readFileSync(
					`/proc/${leader.pid}/task/${leader.pid}/children`,
					"utf8",
				);
				fs.writeFileSync(path.join(directory, "leader.children"), children, {
					mode: 0o600,
				});
				assert.ok(children.trim().split(/\s+/).includes(String(helper.pid)));
				for (const fd of [1, 2])
					assert.equal(
						fs.readlinkSync(`/proc/${helper.pid}/fd/${fd}`),
						fs.readlinkSync(`/proc/${leader.pid}/fd/${fd}`),
						`helper inherits leader pipe ${fd}`,
					);
				await observed(
					() =>
						receipts.find(
							(r) =>
								r.stage === "acquired" &&
								r.observed.some((p) => p.pid === helper.pid),
						),
					observationDeadline,
					"durable acquisition of the original helper identity",
				);
				const durable = fs
					.readFileSync(recordFile, "utf8")
					.trim()
					.split("\n")
					.map(JSON.parse);
				const acquired = durable.find((r) =>
					r.observed.some((p) => p.pid === helper.pid),
				);
				assert.deepEqual(acquired.leader, leader);
				assert.deepEqual(
					acquired.observed.find((p) => p.pid === helper.pid),
					helper,
				);
				assert.equal(acquired.pipesClosed, false);
				assert.equal(acquired.failure, undefined);
				assert.equal(fs.existsSync(path.join(control, "ready")), false);
				assert.equal(phase.deadline, Infinity);
				assert.equal(outcome, undefined);
				fs.writeFileSync(path.join(control, "release-ready"), "", {
					mode: 0o600,
				});
				await observed(
					() => fs.existsSync(path.join(control, "ready")),
					observationDeadline,
					"fixture readiness after original identity capture",
				);
				assert.equal(phase.deadline, Infinity);
				changedAt = performance.now();
				fs.writeFileSync(path.join(control, "release-cwd"), "", {
					mode: 0o600,
				});
				await observed(
					() => fs.existsSync(path.join(control, "changed")),
					observationDeadline,
					"explicitly released cwd change",
				);
				const changed = snapshot("helper-after-change", helper.pid);
				assert.ok(sameProcess(changed, helper));
				assert.equal(changed.cwd, changedCwd);
				assert.equal(changed.zombie, false);
				const result = await managed;
				assert.match(
					result.rejected || "",
					/changed captured ownership.*unresolved/,
				);
				assert.equal(Object.hasOwn(result, "resolved"), false);
				assert.ok(
					settledAt - changedAt >= 2000,
					"preserve the normal disposal window",
				);
				assert.ok(
					settledAt - changedAt < 3000,
					"do not inflate failure disposal",
				);
				assert.ok(phase.deadline - changedAt >= 2000);
				assert.ok(phase.deadline - changedAt < 2300);
				const final = receipts.at(-1);
				assert.equal(final.stage, "finished");
				assert.equal(final.retired, false);
				assert.equal(final.pipesClosed, false);
				assert.equal(
					final.failure,
					"observed local process changed captured ownership",
				);
				assert.deepEqual(final.leader, leader);
				assert.deepEqual(
					final.observed.find((p) => p.pid === helper.pid),
					helper,
				);
				assert.equal(final.unresolved.length, 1);
				const current = snapshot("helper-before-safety", helper.pid);
				assert.ok(sameProcess(current, helper));
				assert.equal(current.zombie, false);
				assert.equal(current.cwd, changedCwd);
				assert.deepEqual(final.unresolved, [current]);
				assert.deepEqual(final.terminal, { code: null, signal: "SIGTERM" });
				assert.equal(
					fs.existsSync(path.join(control, "helper-signals")),
					false,
				);
				verdict = {
					result,
					beforeSafety: true,
					final,
					current,
					elapsedMs: settledAt - changedAt,
				};
				writeJson("verdict.json", verdict);
			})(),
		]);
	} finally {
		clearTimeout(watchdog);
		// A failed manager receipt must be established before this separate owner
		// cleans up. This controlled cwd change makes no general OS escape claim.
		writeJson("before-safety.json", {
			verdict: verdict || null,
			outcome: outcome || null,
			lastReceipt: receipts.at(-1),
			elapsedMs: performance.now() - start,
		});
		if (!helper && fs.existsSync(path.join(control, "helper-pid"))) {
			const candidate = processIdentity(
				Number(fs.readFileSync(path.join(control, "helper-pid"), "utf8")),
			);
			if (candidate?.group === child?.pid && candidate.session === child.pid)
				helper = candidate;
		}
		leader ||= child?.pid && processIdentity(child.pid);
		const cleanup = [helper, leader].filter(Boolean).map(safetyKill);
		await observed(
			() =>
				cleanup.every(({ captured }) => {
					const current = processIdentity(captured.pid);
					return !sameProcess(current, captured) || current.zombie;
				}),
			performance.now() + 2000,
			"test-owned safety cleanup",
		);
		child?.stdin?.destroy();
		child?.stdout?.destroy();
		child?.stderr?.destroy();
		child?.unref();
		writeJson(
			"safety.json",
			cleanup.map((entry) => ({
				...entry,
				after: processIdentity(entry.captured.pid),
			})),
		);
		fs.closeSync(recordFd);
		t.diagnostic(`local ownership evidence: ${directory}`);
		if (!evidenceRoot) fs.rmSync(directory, { recursive: true, force: true });
	}
});
