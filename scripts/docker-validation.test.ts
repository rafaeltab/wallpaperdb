type Workload = import("node:child_process").ChildProcessWithoutNullStreams & {
	done: Promise<{
		status: number | null;
		signal?: NodeJS.Signals | null;
		output: string;
	}>;
	workloadFile: string;
	output: () => string;
};
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
import { expect, test, type TestContext } from "vitest";

const runner = new URL("./docker-validation.ts", import.meta.url).pathname;

test("Make automatically coordinates CI and integration, and provides queue status and experiments", () => {
	for (const target of [
		"ci",
		"test-integration",
		"docker-status",
		"docker-run",
	] as const) {
		const result = spawnSync(
			"make",
			[
				"-n",
				target,
				...(target === "docker-run" ? ["ARGS=docker version"] : []),
			],
			{ encoding: "utf8", env: { ...process.env, MAKEFLAGS: "", MFLAGS: "" } },
		);
		expect(result!.status, result.stderr).toBe(0);
		expect(result.stdout).toMatch(/docker-validation\.ts/);
	}
});

function fixture(t: TestContext & object) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-docker-queue-test-"));
	const children: Workload[] = [];
	function closedWithin(
		child: { done: Promise<any> },
		milliseconds: number | undefined,
	) {
		return new Promise<boolean>((resolve) => {
			const deadline = setTimeout(() => resolve(false), milliseconds);
			void child.done.then(() => {
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
						const pid: number | undefined = Number(
							readFileSync(child.workloadFile, "utf8"),
						);
						expect(Number.isSafeInteger(pid) && pid > 1).toBeTruthy();
						try {
							process.kill(-pid, "SIGKILL");
						} catch (caught) {
							const error = caught as NodeJS.ErrnoException & {
								status?: number;
							};
							if ((error as NodeJS.ErrnoException).code !== "ESRCH")
								throw error;
						}
					}
					child.kill("SIGKILL");
					const closed = await closedWithin(child, 2000);
					if (!closed)
						for (const stream of [
							child.stdin,
							child.stdout,
							child.stderr,
						] as const)
							stream.destroy();
					expect(
						closed,
						`fixture child ${child.pid} did not close after SIGKILL`,
					).toBeTruthy();
				}),
			);
			const failures = results.filter(
				(result) => result!.status === "rejected",
			);
			if (failures.length)
				throw new AggregateError(
					failures.map((result) => result.reason),
					"Fixture teardown failed",
				);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	t.onTestFinished(cleanup);
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DOCKER_VALIDATION_LOCK_FILE: join(root, "host.lock"),
		DOCKER_VALIDATION_TIMEOUT: "5",
	};
	function start(label: string, code: any, options = {}) {
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
		) as Workload;
		let output = "";
		for (const stream of [child.stdout, child.stderr] as const)
			stream.on("data", (data) => {
				output += data;
			});
		child.done = new Promise<{
			status: number | null;
			signal?: NodeJS.Signals | null;
			output: string;
		}>((resolve) => {
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
		expect(result!.status, result.stderr).toBe(0);
		return result.stdout;
	}
	return { root, env, start, status, cleanup };
}

test("fixture teardown kills a coordinator that cannot process SIGTERM", async (t) => {
	let workloadPid: number | undefined;
	t.onTestFinished(() => {
		if (!workloadPid) return;
		try {
			process.kill(-workloadPid, "SIGKILL");
		} catch (caught) {
			const error = caught as NodeJS.ErrnoException & { status?: number };
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
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
		expect((await child.done).signal).toBe("SIGKILL");
		await until(() => {
			try {
				const stat = readFileSync(`/proc/${workloadPid}/stat`, "utf8");
				return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
			} catch (caught) {
				const error = caught as NodeJS.ErrnoException & { status?: number };
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
				throw error;
			}
		});
		expect(existsSync(f.root)).toBe(false);
	} finally {
		clearTimeout(rescue);
		child.kill("SIGCONT");
	}
});

async function until(
	check: {
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): boolean;
		(): any;
	},
	details = () => "",
	timeoutMs = 5000,
) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		expect(
			Date.now() < deadline,
			`queue condition did not become true: ${details()}`,
		).toBeTruthy();
		await delay(20);
	}
}

function blockedFlockWaiters(file: string) {
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
	expect(f.status()).toMatch(/running: owner/);
	expect(existsSync(join(f.root, "order"))).toBe(false);
	owner.stdin.end();
	for (const child of [owner, second, third] as const) {
		const result = await child.done;
		expect(result!.status, result.output).toBe(0);
		expect(result.output).toMatch(/waited .*execution/);
	}
	expect(readFileSync(join(f.root, "order"), "utf8")).toBe("second\nthird\n");
	expect(f.status()).not.toMatch(/running:|waiting:/);
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
	expect((await timeout.done).status).toBe(75);
	const interrupted = f.start(
		"interrupted",
		"require('node:fs').writeFileSync('wrong', '')",
	);
	await until(() => f.status().includes("waiting: interrupted"));
	interrupted.kill("SIGTERM");
	expect((await interrupted.done).status).toBe(143);
	owner.stdin.end();
	expect((await owner.done).status).toBe(0);
	expect((await f.start("next", "process.exit(17)").done).status).toBe(17);
	expect(existsSync(join(f.root, "wrong"))).toBe(false);
});

test("validation coordinates with legacy flock users without replacing the lock", async (t) => {
	const f = fixture(t);
	const legacy = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE!,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "legacy"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.onTestFinished(() => {
		legacy.kill("SIGTERM");
	});
	await until(() => existsSync(join(f.root, "legacy")));
	const waiting = f.start("new", "process.exit(0)");
	await until(() => f.status().includes("waiting: new"));
	legacy.stdin.end();
	const result = await waiting.done;
	expect(result!.status, result.output).toBe(0);
});

test("a later blocking flock user cannot repeatedly overtake the queue head", async (t) => {
	const f = fixture(t);
	const owner = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE!,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "owner"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.onTestFinished(() => {
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
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE!) === 1,
		queued.output,
	);
	const legacy = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE!,
			process.execPath,
			"-e",
			"require('node:fs').appendFileSync(process.argv[1], 'legacy\\n')",
			join(f.root, "order"),
		],
		{ stdio: "ignore" },
	);
	t.onTestFinished(() => {
		legacy.kill("SIGTERM");
	});
	const legacyDone = new Promise<void>((resolve) =>
		legacy.once("close", resolve),
	);
	await until(
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE!) === 2,
	);
	owner.stdin.end();
	const result = await queued.done;
	expect(result!.status, result.output).toBe(0);
	expect(await legacyDone).toBe(0);
	expect(readFileSync(join(f.root, "order"), "utf8")).toBe("queued\nlegacy\n");
});

test("a queue head waiting on a legacy lock cancels without waiting for its deadline", async (t) => {
	const f = fixture(t);
	const owner = spawn(
		"flock",
		[
			f.env.DOCKER_VALIDATION_LOCK_FILE!,
			process.execPath,
			"-e",
			"require('node:fs').writeFileSync(process.argv[1], ''); process.stdin.resume()",
			join(f.root, "owner"),
		],
		{ stdio: ["pipe", "ignore", "ignore"] },
	);
	t.onTestFinished(() => {
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
		() => blockedFlockWaiters(f.env.DOCKER_VALIDATION_LOCK_FILE!) === 1,
		queued.output,
	);
	let result: { status: any; output: string | undefined } | undefined;
	queued.done.then((value: any) => {
		result = value;
	});
	queued.kill("SIGTERM");
	await until(() => result !== undefined);
	expect(result!.status, result!.output).toBe(143);
	expect(existsSync(join(f.root, "wrong"))).toBe(false);
	owner.stdin.end();
	expect((await f.start("next", "process.exit(0)").done).status).toBe(0);
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
	expect((await owner.done).status).toBe(0);
	expect((await next.done).status).toBe(0);
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
	const supervisorDone = new Promise<void>((resolve) =>
		supervisor.once("close", resolve),
	);
	let pid: number | undefined;
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
		expect((await owner.done).status).toBe(0);
		const result = await next.done;
		expect(result!.status, result.output).toBe(0);
		const zombie = readFileSync(`/proc/${pid}/stat`, "utf8");
		expect(zombie.slice(zombie.lastIndexOf(")") + 2)).toMatch(/^Z /);
		expect(existsSync(join(f.root, "wrong"))).toBe(false);
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
	expect(result!.status, result.output).toBe(19);
});

test("an unlocked descriptor for the same inode is rejected without acquiring a lease", (t) => {
	const f = fixture(t);
	const fd = openSync(f.env.DOCKER_VALIDATION_LOCK_FILE!, "w", 0o600);
	t.onTestFinished(() => closeSync(fd));
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
				WALLPAPERDB_DOCKER_LEASE_FILE: f.env.DOCKER_VALIDATION_LOCK_FILE!,
			},
		},
	);
	expect(result!.status, result.stdout + result.stderr).toBe(1);
	expect(result.stderr).toMatch(/Inherited Docker lease does not own/);
	expect(existsSync(join(f.root, "wrong"))).toBe(false);
	expect(existsSync(`${f.env.DOCKER_VALIDATION_LOCK_FILE!}.queue`)).toBe(false);
	expect(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8")).not.toMatch(
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
	expect(result!.status, result.output).toBe(1);
	expect(result.output).toMatch(
		/Cannot reuse inherited Docker lock descriptor/,
	);
	expect(result.output).toMatch(/Forward WALLPAPERDB_DOCKER_LEASE_FD/);
	expect(existsSync(join(f.root, "wrong"))).toBe(false);
});

test("killing a coordinator keeps the host locked until its surviving command exits", async (t) => {
	const f = fixture(t);
	const owner = f.start(
		"owner",
		"const fs = require('node:fs'); const watcher = fs.watch('.', () => { if (fs.existsSync('release')) { watcher.close(); clearTimeout(deadline); } }); const deadline = setTimeout(() => watcher.close(), 10000); fs.writeFileSync('started', '')",
	);
	await until(() => existsSync(join(f.root, "started")));
	const exited = new Promise<boolean>((resolve) => owner.once("exit", resolve));
	owner.kill("SIGKILL");
	await exited;
	expect(
		spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE!, "true"])
			.status,
	).not.toBe(0);
	const next = f.start("next", "require('node:fs').writeFileSync('next', '')");
	await until(
		() => f.status().includes("waiting: next"),
		() => next.output(),
	);
	expect(existsSync(join(f.root, "next"))).toBe(false);
	writeFileSync(join(f.root, "release"), "");
	const result = await next.done;
	expect(result!.status, result.output).toBe(0);
});

test("interruption completes promptly when the workload group exits", async (t) => {
	const f = fixture(t);
	const child = f.start(
		"graceful",
		"process.on('SIGTERM', () => process.exit(0)); require('node:fs').writeFileSync('started', ''); process.stdin.resume()",
	);
	await until(() => existsSync(join(f.root, "started")));
	let result: { status: any; output: string | undefined } | undefined;
	child.done.then((value: any) => {
		result = value;
	});
	child.kill("SIGTERM");
	await until(() => result !== undefined, child.output, 2000);
	expect(result!.status, result!.output).toBe(143);
	expect(
		spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE!, "true"])
			.status,
	).toBe(0);
});

for (const inherit of [true, false] as const) {
	test(`interruption kills a surviving descendant after its parent exits, inherited lock=${inherit}`, async (t) => {
		let pid: number | undefined;
		t.onTestFinished(() => {
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
		expect((await owner.done).status).toBe(143);
		await until(() => {
			try {
				const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
				return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
			} catch (caught) {
				const error = caught as NodeJS.ErrnoException & { status?: number };
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
				throw error;
			}
		});
		expect(
			spawnSync("flock", ["-n", f.env.DOCKER_VALIDATION_LOCK_FILE!, "true"])
				.status,
		).toBe(0);
	});
}
