import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	openSync,
	closeSync,
	readFileSync,
	rmSync,
	existsSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const runner = new URL("./docker-validation.mjs", import.meta.url).pathname;

test("Make automatically coordinates CI and integration, and provides queue status and experiments", () => {
	for (const target of [
		"ci",
		"test-integration",
		"docker-status",
		"docker-run",
	]) {
		const result = spawnSync(
			"make",
			[
				"-n",
				target,
				...(target === "docker-run" ? ["ARGS=docker version"] : []),
			],
			{ encoding: "utf8", env: { ...process.env, MAKEFLAGS: "", MFLAGS: "" } },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /docker-validation\.mjs/);
	}
});

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-docker-queue-test-"));
	const children = [];
	function closedWithin(child, milliseconds) {
		return new Promise((resolve) => {
			const deadline = setTimeout(() => resolve(false), milliseconds);
			child.done.then(() => {
				clearTimeout(deadline);
				resolve(true);
			});
		});
	}
	async function cleanup() {
		try {
			const results = await Promise.allSettled(
				children.map(async (child) => {
					child.stdin.end();
					child.kill("SIGTERM");
					if (await closedWithin(child, 1000)) return;
					if (existsSync(child.workloadFile)) {
						const pid = Number(readFileSync(child.workloadFile, "utf8"));
						assert.ok(Number.isSafeInteger(pid) && pid > 1);
						try {
							process.kill(-pid, "SIGKILL");
						} catch (error) {
							if (error.code !== "ESRCH") throw error;
						}
					}
					child.kill("SIGKILL");
					const closed = await closedWithin(child, 2000);
					if (!closed)
						for (const stream of [child.stdin, child.stdout, child.stderr])
							stream.destroy();
					assert.ok(
						closed,
						`fixture child ${child.pid} did not close after SIGKILL`,
					);
				}),
			);
			const failures = results.filter((result) => result.status === "rejected");
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Fixture teardown failed",
				);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	t.after(cleanup);
	const env = {
		...process.env,
		// This fixture proves host admission even when the suite runs on a worker.
		WALLPAPERDB_BOAT_WORKER: "",
		DOCKER_VALIDATION_LOCK_FILE: join(root, "host.lock"),
		DOCKER_VALIDATION_TIMEOUT: "5",
	};
	function start(label, code, options = {}) {
		const workloadFile = join(root, `workload-${children.length}.pid`);
		const child = spawn(
			process.execPath,
			[
				runner,
				"--label",
				label,
				"--",
				process.execPath,
				"-e",
				`require('node:fs').writeFileSync(${JSON.stringify(workloadFile)}, String(process.pid)); ${code}`,
			],
			{
				cwd: root,
				env: { ...env, ...options },
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		let output = "";
		for (const stream of [child.stdout, child.stderr])
			stream.on("data", (data) => {
				output += data;
			});
		child.done = new Promise((resolve) => {
			child.on("error", (error) =>
				resolve({ status: -1, output: String(error) }),
			);
			child.on("close", (status, signal) =>
				resolve({ status, signal, output }),
			);
		});
		children.push(child);
		child.workloadFile = workloadFile;
		child.output = () => output;
		return child;
	}
	function status() {
		const result = spawnSync(process.execPath, [runner, "--status"], {
			env,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		return result.stdout;
	}
	return { root, env, start, status, cleanup };
}

test("fixture teardown kills a coordinator that cannot process SIGTERM", async (t) => {
	let workloadPid;
	t.after(() => {
		if (!workloadPid) return;
		try {
			process.kill(-workloadPid, "SIGKILL");
		} catch (error) {
			if (error.code !== "ESRCH") throw error;
		}
	});
	const f = fixture(t);
	const child = f.start(
		"stopped",
		"process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000); require('node:fs').writeFileSync('started', '')",
	);
	await until(() => existsSync(join(f.root, "started")));
	workloadPid = Number(readFileSync(child.workloadFile, "utf8"));
	child.kill("SIGSTOP");
	const rescue = setTimeout(() => child.kill("SIGCONT"), 3000);
	try {
		await f.cleanup();
		assert.equal((await child.done).signal, "SIGKILL");
		await until(() => {
			try {
				const stat = readFileSync(`/proc/${workloadPid}/stat`, "utf8");
				return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
			} catch (error) {
				if (error.code === "ENOENT") return true;
				throw error;
			}
		});
		assert.equal(existsSync(f.root), false);
	} finally {
		clearTimeout(rescue);
		child.kill("SIGCONT");
	}
});

async function until(check, details = () => "", timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		assert.ok(
			Date.now() < deadline,
			`queue condition did not become true: ${details()}`,
		);
		await delay(20);
	}
}

function blockedFlockWaiters(file) {
	const { dev, ino } = statSync(file, { bigint: true });
	const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
	const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
	return readFileSync("/proc/locks", "utf8")
		.split("\n")
		.filter((line) => {
			const match = line.match(
				/^\d+:\s+->\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+([\da-f]+):([\da-f]+):(\d+)\s/,
			);
			return (
				match &&
				BigInt(`0x${match[1]}`) === major &&
				BigInt(`0x${match[2]}`) === minor &&
				BigInt(match[3]) === ino
			);
		}).length;
}

test("Docker validation exposes the owner and executes waiting work in admission order", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	const second = f.start(
		"second",
		"require('node:fs').appendFileSync('order', 'second\\n')",
	);
	await until(() => f.status().includes("waiting: second"));
	const third = f.start(
		"third",
		"require('node:fs').appendFileSync('order', 'third\\n')",
	);
	await until(() => f.status().includes("waiting: third"));
	assert.match(f.status(), /running: owner/);
	assert.equal(existsSync(join(f.root, "order")), false);
	owner.stdin.end();
	for (const child of [owner, second, third]) {
		const result = await child.done;
		assert.equal(result.status, 0, result.output);
		assert.match(result.output, /waited .*execution/);
	}
	assert.equal(readFileSync(join(f.root, "order"), "utf8"), "second\nthird\n");
	assert.doesNotMatch(f.status(), /running:|waiting:/);
});

test("timing out or interrupting queued work never runs its command or blocks later work", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	const timeout = f.start(
		"timeout",
		"require('node:fs').writeFileSync('wrong', '')",
		{ DOCKER_VALIDATION_TIMEOUT: "1" },
	);
	assert.equal((await timeout.done).status, 75);
	const interrupted = f.start(
		"interrupted",
		"require('node:fs').writeFileSync('wrong', '')",
	);
	await until(() => f.status().includes("waiting: interrupted"));
	interrupted.kill("SIGTERM");
	assert.equal((await interrupted.done).status, 143);
	owner.stdin.end();
	assert.equal((await owner.done).status, 0);
	assert.equal((await f.start("next", "process.exit(17)").done).status, 17);
	assert.equal(existsSync(join(f.root, "wrong")), false);
});

test("validation coordinates with legacy flock users without replacing the lock", async (t) => {
	const f = fixture(t);
	const legacy = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "legacy"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.after(() => legacy.kill("SIGTERM"));
	await until(() => existsSync(join(f.root, "legacy")));
	const waiting = f.start("new", "process.exit(0)");
	await until(() => f.status().includes("waiting: new"));
	legacy.stdin.end();
	const result = await waiting.done;
	assert.equal(result.status, 0, result.output);
});

test("a later blocking flock user cannot repeatedly overtake the queue head", async (t) => {
	const f = fixture(t);
	const owner = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "owner"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.after(() => {
		owner.stdin.end();
		owner.kill("SIGTERM");
	});
	await until(() => existsSync(join(f.root, "owner")));
	const queued = f.start(
		"queued",
		"require('node:fs').appendFileSync('order', 'queued\\n')",
	);
	await until(() => f.status().includes("waiting: queued"));
	await until(
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE) === 1,
		queued.output,
	);
	const legacy = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE,
			process.execPath,
			"-e",
			"require('node:fs').appendFileSync(process.argv[1], 'legacy\\n')",
			join(f.root, "order"),
		],
		{ stdio: "ignore" },
	);
	t.after(() => legacy.kill("SIGTERM"));
	const legacyDone = new Promise((resolve) => legacy.once("close", resolve));
	await until(
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE) === 2,
	);
	owner.stdin.end();
	const result = await queued.done;
	assert.equal(result.status, 0, result.output);
	assert.equal(await legacyDone, 0);
	assert.equal(readFileSync(join(f.root, "order"), "utf8"), "queued\nlegacy\n");
});

test("a queue head waiting on a legacy lock cancels without waiting for its deadline", async (t) => {
	const f = fixture(t);
	const owner = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "owner"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.after(() => {
		owner.stdin.end();
		owner.kill("SIGTERM");
	});
	await until(() => existsSync(join(f.root, "owner")));
	const queued = f.start(
		"cancelled",
		"require('node:fs').writeFileSync('wrong', '')",
		{ DOCKER_VALIDATION_TIMEOUT: "60" },
	);
	await until(() => f.status().includes("waiting: cancelled"));
	await until(
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE) === 1,
		queued.output,
	);
	let result;
	queued.done.then((value) => {
		result = value;
	});
	queued.kill("SIGTERM");
	await until(() => result !== undefined);
	assert.equal(result.status, 143, result.output);
	assert.equal(existsSync(join(f.root, "wrong")), false);
	owner.stdin.end();
	assert.equal((await f.start("next", "process.exit(0)").done).status, 0);
});

test("a killed waiter leaves no permanent queue blockage", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	const stale = f.start("stale", "process.exit(23)");
	await until(() => f.status().includes("waiting: stale"));
	stale.kill("SIGKILL");
	await stale.done;
	const next = f.start("next", "process.exit(0)");
	owner.stdin.end();
	assert.equal((await owner.done).status, 0);
	assert.equal((await next.done).status, 0);
});

test("an unreaped zombie waiter does not block later validation", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	const supervisor = spawn(
		process.execPath,
		[
			"-e",
			`
const fs = require('node:fs');
const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(runner)}, '--label', 'zombie', '--', process.execPath, '-e', "require('node:fs').writeFileSync('wrong', '')"], {stdio: 'ignore'});
fs.writeFileSync('waiter.pid', String(child.pid));
const deadline = Date.now() + 15000;
const barrier = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync('reap-child') && Date.now() < deadline) Atomics.wait(barrier, 0, 0, 20);
`,
		],
		{ cwd: f.root, env: f.env, stdio: "ignore" },
	);
	const supervisorDone = new Promise((resolve) =>
		supervisor.once("close", resolve),
	);
	let pid;
	try {
		await until(() => existsSync(join(f.root, "waiter.pid")));
		pid = Number(readFileSync(join(f.root, "waiter.pid"), "utf8"));
		await until(() => f.status().includes("waiting: zombie"));
		process.kill(pid, "SIGKILL");
		await until(() => {
			const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
			return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
		});
		const next = f.start("next", "process.exit(0)");
		owner.stdin.end();
		assert.equal((await owner.done).status, 0);
		const result = await next.done;
		assert.equal(result.status, 0, result.output);
		const zombie = readFileSync(`/proc/${pid}/stat`, "utf8");
		assert.match(zombie.slice(zombie.lastIndexOf(")") + 2), /^Z /);
		assert.equal(existsSync(join(f.root, "wrong")), false);
	} finally {
		if (pid) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {}
		}
		writeFileSync(join(f.root, "reap-child"), "");
		await supervisorDone;
	}
});

test("a nested coordinated command borrows its inherited lock instead of waiting on itself", async (t) => {
	const f = fixture(t);
	const nested = f.start(
		"outer",
		`const { spawnSync } = require('node:child_process'); process.exit(spawnSync(process.execPath, [${JSON.stringify(runner)}, '--label', 'inner', '--', process.execPath, '-e', 'process.exit(19)'], { stdio: ['inherit', 'inherit', 'inherit', 3] }).status)`,
	);
	const result = await nested.done;
	assert.equal(result.status, 19, result.output);
});

test("an unlocked descriptor for the same inode is rejected without acquiring a lease", (t) => {
	const f = fixture(t);
	const fd = openSync(f.env.DOCKER_VALIDATION_LOCK_FILE, "w", 0o600);
	t.after(() => closeSync(fd));
	const result = spawnSync(
		process.execPath,
		[
			runner,
			"--",
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync('wrong', '')",
		],
		{
			cwd: f.root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe", fd],
			env: {
				...f.env,
				WALLPAPERDB_DOCKER_LEASE_FD: "3",
				WALLPAPERDB_DOCKER_LEASE_FILE: f.env.DOCKER_VALIDATION_LOCK_FILE,
			},
		},
	);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /Inherited Docker lease does not own/);
	assert.equal(existsSync(join(f.root, "wrong")), false);
	assert.equal(existsSync(`${f.env.DOCKER_VALIDATION_LOCK_FILE}.queue`), false);
	assert.doesNotMatch(
		readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"),
		/^lock:/m,
	);
});

test("a nested launcher that drops the descriptor fails clearly before execution", async (t) => {
	const f = fixture(t);
	const nested = f.start(
		"outer",
		`const { spawnSync } = require('node:child_process'); process.exit(spawnSync(process.execPath, [${JSON.stringify(runner)}, '--label', 'inner', '--', process.execPath, '-e', "require('node:fs').writeFileSync('wrong', '')"], { stdio: 'inherit' }).status)`,
	);
	const result = await nested.done;
	assert.equal(result.status, 1, result.output);
	assert.match(result.output, /Cannot reuse inherited Docker lock descriptor/);
	assert.match(result.output, /Forward WALLPAPERDB_DOCKER_LEASE_FD/);
	assert.equal(existsSync(join(f.root, "wrong")), false);
});

test("killing a coordinator keeps the host locked until its surviving command exits", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"const fs = require('node:fs'); const watcher = fs.watch('.', () => { if (fs.existsSync('release')) { watcher.close(); clearTimeout(deadline); } }); const deadline = setTimeout(() => watcher.close(), 10000); fs.writeFileSync('started', '')",
	);
	await until(() => existsSync(join(f.root, "started")));
	const exited = new Promise((resolve) => owner.once("exit", resolve));
	owner.kill("SIGKILL");
	await exited;
	assert.notEqual(
		spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE, "true"])
			.status,
		0,
	);
	const next = f.start("next", "require('node:fs').writeFileSync('next', '')");
	await until(
		() => f.status().includes("waiting: next"),
		() => next.output(),
	);
	assert.equal(existsSync(join(f.root, "next")), false);
	writeFileSync(join(f.root, "release"), "");
	const result = await next.done;
	assert.equal(result.status, 0, result.output);
});

test("interruption completes promptly when the workload group exits", async (t) => {
	const f = fixture(t);
	const child = f.start(
		"graceful",
		"process.on('SIGTERM', () => process.exit(0)); require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	let result;
	child.done.then((value) => {
		result = value;
	});
	child.kill("SIGTERM");
	await until(() => result !== undefined, child.output, 2000);
	assert.equal(result.status, 143, result.output);
	assert.equal(
		spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE, "true"])
			.status,
		0,
	);
});

for (const inherit of [true, false]) {
	test(`interruption kills a surviving descendant after its parent exits, inherited lock=${inherit}`, async (t) => {
		let pid;
		t.after(() => {
			if (pid) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {}
			}
		});
		const f = fixture(t);
		const grandchild =
			"process.on('SIGTERM', () => {}); require('node:fs').writeFileSync('descendant', String(process.pid)); setInterval(() => {}, 1000)";
		const owner = f.start(
			"tree",
			`require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore','ignore','ignore'${inherit ? ",3" : ""}] }); process.on('SIGTERM', () => process.exit(0)); process.stdin.resume()`,
		);
		await until(() => existsSync(join(f.root, "descendant")));
		pid = Number(readFileSync(join(f.root, "descendant"), "utf8"));
		owner.kill("SIGTERM");
		assert.equal((await owner.done).status, 143);
		await until(() => {
			try {
				const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
				return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
			} catch (error) {
				if (error.code === "ENOENT") return true;
				throw error;
			}
		});
		assert.equal(
			spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE, "true"])
				.status,
			0,
		);
	});
}
