import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	existsSync,
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
	t.after(async () => {
		for (const child of children) {
			child.stdin.end();
			child.kill("SIGTERM");
		}
		await Promise.all(children.map((child) => child.done));
		rmSync(root, { recursive: true, force: true });
	});
	const env = {
		...process.env,
		DOCKER_VALIDATION_LOCK_FILE: join(root, "host.lock"),
		DOCKER_VALIDATION_TIMEOUT: "5",
	};
	function start(label, code, options = {}) {
		const child = spawn(
			process.execPath,
			[runner, "--label", label, "--", process.execPath, "-e", code],
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
	return { root, env, start, status };
}

async function until(check, details = () => "") {
	const deadline = Date.now() + 5000;
	while (!check()) {
		assert.ok(
			Date.now() < deadline,
			`queue condition did not become true: ${details()}`,
		);
		await delay(20);
	}
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

test("a nested coordinated command borrows its inherited lock instead of waiting on itself", async (t) => {
	const f = fixture(t);
	const nested = f.start(
		"outer",
		`const { spawnSync } = require('node:child_process'); process.exit(spawnSync(process.execPath, [${JSON.stringify(runner)}, '--label', 'inner', '--', process.execPath, '-e', 'process.exit(19)'], { stdio: ['inherit', 'inherit', 'inherit', 3] }).status)`,
	);
	const result = await nested.done;
	assert.equal(result.status, 19, result.output);
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
