import assert from "node:assert/strict";
import { test } from "node:test";
import {
	route,
	delta,
	quote,
	estimate,
	parseBoatJson,
	workerState,
	meaningfulPreviewRequest,
	worktreeProcesses,
	liveOwnedProcess,
	forwardPreviewDisconnect,
} from "./lib/boat.mjs";
import http from "node:http";
import { once } from "node:events";

test("preview forwards downstream cancellation after the request body completes", async (t) => {
	let disconnected;
	const closed = new Promise((resolve) => {
		disconnected = resolve;
	});
	const upstream = http.createServer((req, res) => {
		req.resume();
		res.on("close", disconnected);
	});
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const proxy = http.createServer((req, res) => {
		const request = http.request(
			{ hostname: "127.0.0.1", port: upstream.address().port },
			(response) => response.pipe(res),
		);
		request.on("error", () => {});
		forwardPreviewDisconnect(req, res, request);
		req.pipe(request);
	});
	proxy.listen(0, "127.0.0.1");
	await once(proxy, "listening");
	t.after(() => {
		proxy.closeAllConnections();
		proxy.close();
		upstream.closeAllConnections();
		upstream.close();
	});
	const arrived = once(upstream, "request");
	const client = http.get({
		hostname: "127.0.0.1",
		port: proxy.address().port,
	});
	client.on("error", () => {});
	await arrived;
	client.destroy();
	await Promise.race([
		closed,
		new Promise((_, reject) => {
			const timer = setTimeout(
				() =>
					reject(
						new Error("Upstream request survived downstream cancellation"),
					),
				1000,
			);
			timer.unref();
		}),
	]);
});

test("preview retains a normally completed response", async (t) => {
	const upstream = http.createServer((req, res) => res.end("healthy control"));
	upstream.listen(0, "127.0.0.1");
	await once(upstream, "listening");
	const proxy = http.createServer((req, res) => {
		const request = http.request(
			{ hostname: "127.0.0.1", port: upstream.address().port },
			(response) => response.pipe(res),
		);
		forwardPreviewDisconnect(req, res, request);
		req.pipe(request);
	});
	proxy.listen(0, "127.0.0.1");
	await once(proxy, "listening");
	t.after(() => {
		proxy.close();
		upstream.close();
	});
	const body = await new Promise((resolve, reject) => {
		http
			.get(
				{ hostname: "127.0.0.1", port: proxy.address().port },
				(response) => {
					let text = "";
					response.on("data", (chunk) => {
						text += chunk;
					});
					response.on("end", () => resolve(text));
				},
			)
			.on("error", reject);
	});
	assert.equal(body, "healthy control");
});
test("worktree process measurement includes its own process without command arguments", () => {
	const sample = worktreeProcesses(process.cwd()).find(
		(p) => p.pid === process.pid,
	);
	assert.ok(sample.rssKB > 0);
	assert.ok(sample.cpuTicks >= 0);
	assert.equal("args" in sample, false);
	assert.equal(liveOwnedProcess(process.cwd(), sample), true);
	assert.equal(
		liveOwnedProcess(process.cwd(), { ...sample, startTicks: "0" }),
		false,
	);
	assert.equal(liveOwnedProcess(process.cwd(), { pid: process.pid }), false);
});
test("background queries and health probes do not keep previews awake", () => {
	assert.equal(
		meaningfulPreviewRequest("/gateway/graphql", { "sec-fetch-mode": "cors" }),
		false,
	);
	assert.equal(
		meaningfulPreviewRequest("/asset/ready", { "sec-fetch-mode": "navigate" }),
		false,
	);
	assert.equal(
		meaningfulPreviewRequest("/web/", { "sec-fetch-mode": "navigate" }),
		true,
	);
	assert.equal(
		meaningfulPreviewRequest("/__boat557/activity", { "x-boat-activity": "1" }),
		true,
	);
});
test("Boat CLI JSONL creation and idle worker info retain the provisioned identity", () => {
	assert.equal(
		parseBoatJson(
			'{"event":"creating","id":"bx_one"}\n{"event":"ready","sandbox":{"id":"bx_one","state":"idle"}}\n',
		).sandbox.id,
		"bx_one",
	);
	assert.equal(workerState({ sandbox: { state: "idle" } }), "idle");
	assert.equal(
		parseBoatJson('{"sandbox":{"id":"bx_one"}}').sandbox.id,
		"bx_one",
	);
});
import { cacheServer } from "./lib/boat-cache.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireDockerLease } from "./lib/docker-queue.mjs";
import { ownsWatch } from "./boat-stop-watch.mjs";

test("retirement fails explicitly when a matching watcher cannot be inspected", async (t) => {
	if (process.getuid() === 0)
		return t.skip("Root can inspect non-dumpable processes");
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-protected-watch-"));
	const python = execFileSync(
		"python",
		["-c", "import sys;print(sys.executable)"],
		{ encoding: "utf8" },
	).trim();
	const executable = path.join(root, "docker-compose");
	fs.symlinkSync(python, executable);
	const child = spawn(
		executable,
		[
			"-c",
			"import ctypes,time; assert ctypes.CDLL(None).prctl(4,0)==0; print('ready',flush=True); time.sleep(60)",
			"compose",
			"-p",
			"protected-test",
			"watch",
		],
		{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	t.after(() => {
		child.kill("SIGKILL");
		fs.rmSync(root, { recursive: true, force: true });
	});
	await new Promise((resolve, reject) => {
		child.stdout.once("data", resolve);
		child.once("error", reject);
	});
	const helper = fileURLToPath(
		new URL("./boat-stop-watch.mjs", import.meta.url),
	);
	const result = await new Promise((resolve, reject) => {
		const runner = spawn(process.execPath, [helper], {
			cwd: root,
			env: { ...process.env, COMPOSE_PROJECT_NAME: "protected-test" },
			stdio: "pipe",
		});
		let output = "";
		runner.stderr.on("data", (data) => (output += data));
		runner.once("error", reject);
		runner.once("close", (code) => resolve({ code, output }));
	});
	assert.notEqual(result.code, 0);
	assert.match(result.output, /privileged inspection is required/);
	assert.equal(child.exitCode, null);
});

test("watcher retirement observes delayed owned shutdown before reporting success", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-watch-retirement-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const executable = path.join(root, "docker-compose");
	fs.symlinkSync(process.execPath, executable);
	const child = spawn(
		executable,
		[
			"-e",
			"const fs=require('fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync('terminated','yes');process.exit(0)},150));console.log('ready');setInterval(()=>{},1000)",
			"--",
			"compose",
			"-p",
			"owned-test",
			"watch",
		],
		{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	t.after(() => {
		try {
			child.kill("SIGKILL");
		} catch {}
	});
	await new Promise((resolve, reject) => {
		child.stdout.once("data", resolve);
		child.once("error", reject);
	});
	const helper = fileURLToPath(
		new URL("./boat-stop-watch.mjs", import.meta.url),
	);
	await new Promise((resolve, reject) => {
		const runner = spawn(process.execPath, [helper], {
			cwd: root,
			env: { ...process.env, COMPOSE_PROJECT_NAME: "owned-test" },
			stdio: "pipe",
		});
		let output = "";
		runner.stdout.on("data", (data) => (output += data));
		runner.stderr.on("data", (data) => (output += data));
		runner.once("error", reject);
		runner.once("close", (code) =>
			code === 0 ? resolve() : reject(new Error(output)),
		);
	});
	assert.equal(fs.readFileSync(path.join(root, "terminated"), "utf8"), "yes");
});

test("restoration stops only a Compose watcher for this checkout and exact project", () => {
	const input = {
		root: "/owned",
		cwd: "/owned",
		project: "owned-stack",
		argv: [
			"/managed/docker-compose",
			"compose",
			"-p",
			"owned-stack",
			"-f",
			"compose.yml",
			"watch",
		],
	};
	assert.equal(ownsWatch(input), true);
	assert.equal(ownsWatch({ ...input, cwd: "/sibling" }), false);
	assert.equal(ownsWatch({ ...input, project: "owned" }), false);
	assert.equal(
		ownsWatch({ ...input, argv: ["/bin/sh", "-p", "owned-stack", "watch"] }),
		false,
	);
	assert.equal(ownsWatch({ ...input, argv: input.argv.slice(0, -1) }), false);
});
import {
	fingerprint,
	validateAuthority,
	generatedAuthority,
	prepareEnvironment,
	installationInputs,
} from "./lib/boat-preparation.mjs";

test("setup helper, workspace and template edits invalidate actual preparation selection", (t) => {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-installation-inputs-"),
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const files = installationInputs([
		".npmrc",
		"package.json",
		"apps/user/package.json",
		"apps/user/.env.example",
	]);
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), "initial");
	}
	let previous = fingerprint(root, files);
	for (const file of [
		"scripts/lib/worktree-project.mjs",
		"apps/user/.env.example",
		"apps/user/package.json",
		".npmrc",
		"pnpm-workspace.yaml",
	]) {
		fs.appendFileSync(path.join(root, file), "changed");
		const next = fingerprint(root, files);
		assert.notEqual(next, previous, file);
		previous = next;
	}
});

test("actual Make routing preserves enrolled remote tasks and explicit local/worker overrides", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-routing-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const repository = path.resolve(import.meta.dirname, "..");
	for (const name of [
		"Makefile",
		"scripts/boat-route.mk",
		"scripts/lib/boat.mjs",
	]) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.copyFileSync(path.join(repository, name), path.join(root, name));
	}
	const run = (override) =>
		execFileSync(
			"make",
			[
				"-n",
				"build",
				"SHELL=/bin/sh",
				...(override ? [`BOAT_EXEC=${override}`] : []),
			],
			{
				cwd: root,
				env: {
					...process.env,
					MAKEFLAGS: "",
					MFLAGS: "",
					MAKEOVERRIDES: "",
					BOAT_EXEC: "",
				},
			},
		).toString();
	assert.match(run(), /turbo.*run build/);
	fs.mkdirSync(path.join(root, ".boat"));
	fs.writeFileSync(
		path.join(root, ".boat/enrollment.json"),
		JSON.stringify({ mode: "development" }),
	);
	assert.match(run(), /boat.mjs command -- build/);
	assert.match(run("local"), /turbo.*run build/);
	assert.match(run("worker"), /turbo.*run build/);
});

test("preparation rejects missing mounts and directories and invalidates changed generated inputs", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-prepare-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	assert.throws(() => fingerprint(root, ["mount"]), /ENOENT/);
	fs.mkdirSync(path.join(root, "mount"));
	assert.throws(() => fingerprint(root, ["mount"]), /regular file/);
	fs.rmSync(path.join(root, "mount"), { recursive: true });
	fs.writeFileSync(path.join(root, "mount"), "first");
	const initial = fingerprint(root, ["mount"]);
	assert.equal(fingerprint(root, ["mount"]), initial);
	fs.writeFileSync(path.join(root, "mount"), "second");
	assert.notEqual(fingerprint(root, ["mount"]), initial);
});

test("preparation requires issuer, JWKS and origins to agree with actual worktree configuration", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-authority-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const name of generatedAuthority) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), "{}");
	}
	fs.writeFileSync(path.join(root, ".worktree"), "INGRESS_PORT=9120\n");
	fs.writeFileSync(
		path.join(root, "apps/user/.env"),
		"CLERK_DOMAIN=example.clerk.accounts.dev\n",
	);
	const clerk = {
		issuer: "https://example.clerk.accounts.dev",
		jwksUrl: "https://example.clerk.accounts.dev/.well-known/jwks.json",
		authorizedParties: ["http://localhost:9120", "http://127.0.0.1:9120"],
	};
	const save = () =>
		fs.writeFileSync(
			path.join(root, generatedAuthority[0]),
			JSON.stringify({ identityProviders: { clerk } }),
		);
	save();
	validateAuthority(root);
	fs.writeFileSync(
		path.join(root, "apps/user/.env"),
		"CLERK_DOMAIN=https://example.clerk.accounts.dev/\n",
	);
	validateAuthority(root);
	clerk.authorizedParties = ["http://localhost:8000"];
	save();
	assert.throws(() => validateAuthority(root), /does not match/);
});

test("preparation upgrades existing placeholders before projection, restores postinstall inputs and skips unchanged installation", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-prepare-sequence-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const name of generatedAuthority) {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), "{}");
	}
	fs.writeFileSync(path.join(root, ".worktree"), "INGRESS_PORT=9120\n");
	fs.writeFileSync(
		path.join(root, "apps/user/.env"),
		"CLERK_DOMAIN=example.clerk.accounts.dev\n",
	);
	const authorityPath = path.join(root, generatedAuthority[0]);
	fs.writeFileSync(
		authorityPath,
		JSON.stringify({
			credentials: "preserve",
			identityProviders: {
				clerk: { issuer: "https://unconfigured.clerk.accounts.dev" },
			},
		}),
	);
	let previous = {},
		remoteEnv = "",
		calls = [];
	const configuration = [".worktree", "apps/user/.env", ...generatedAuthority];
	const run = () =>
		prepareEnvironment({
			root,
			previous,
			configuration,
			dependencies: "frozen-lockfiles",
			generate: async () => {
				calls.push("generate");
				const authority = JSON.parse(fs.readFileSync(authorityPath));
				authority.identityProviders.clerk = {
					issuer: "https://example.clerk.accounts.dev",
					jwksUrl: "https://example.clerk.accounts.dev/.well-known/jwks.json",
					authorizedParties: ["http://localhost:9120", "http://127.0.0.1:9120"],
				};
				fs.writeFileSync(authorityPath, JSON.stringify(authority));
			},
			project: async () => {
				calls.push("project");
				remoteEnv = fs.readFileSync(path.join(root, "apps/user/.env"), "utf8");
			},
			install: async () => {
				calls.push("install");
				assert.match(remoteEnv, /example.clerk/);
				remoteEnv = "placeholder overwritten by postinstall";
			},
			validateMounts: async () => {
				calls.push("mounts");
				assert.match(remoteEnv, /example.clerk/);
			},
			persist: async (record) => {
				previous = record;
			},
		});
	assert.equal((await run()).changed, true);
	assert.deepEqual(calls, [
		"generate",
		"project",
		"install",
		"project",
		"mounts",
	]);
	assert.equal(
		JSON.parse(fs.readFileSync(authorityPath)).credentials,
		"preserve",
	);
	calls = [];
	assert.equal((await run()).changed, false);
	assert.deepEqual(calls, ["mounts"]);
	calls = [];
	fs.appendFileSync(path.join(root, "apps/user/.env"), "# new configuration\n");
	await run();
	assert.deepEqual(calls, ["generate", "project", "mounts"]);
});

test("settled child cannot stop its active parent sharing the worktree", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boat-owners-test-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const db = path.join(directory, "state.sqlite");
	const setup = `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
c.execute('create table orchestration_v2_projection_threads(payload_json text)')
c.execute('create table orchestration_v2_projection_runs(thread_id text,status text)')
for t in [{'id':'parent','worktreePath':'/fixture','settledOverride':None},{'id':'child','worktreePath':'/fixture','settledOverride':'settled'}]:c.execute('insert into orchestration_v2_projection_threads values (?)',(json.dumps(t),))
c.commit()
`;
	execFileSync("python", ["-c", setup, db]);
	const helper = fileURLToPath(new URL("./boat-owners.py", import.meta.url));
	const result = JSON.parse(
		execFileSync("python", [helper, "/fixture", db]).toString(),
	);
	assert.equal(result.stop, false);
	assert.deepEqual(result.activeOwners, ["parent"]);
	execFileSync("python", [
		"-c",
		`import sqlite3,sys; c=sqlite3.connect(sys.argv[1]);c.execute('update orchestration_v2_projection_threads set payload_json=json_set(payload_json,?,?)',('$.settledOverride','settled'));c.commit()`,
		db,
	]);
	assert.equal(
		JSON.parse(execFileSync("python", [helper, "/fixture", db]).toString())
			.stop,
		true,
	);
});

test("experimental workers admit concurrent Docker work without creating the host queue", async (t) => {
	const old = process.env.WALLPAPERDB_BOAT_WORKER;
	process.env.WALLPAPERDB_BOAT_WORKER = "1";
	t.after(() => {
		if (old === undefined) delete process.env.WALLPAPERDB_BOAT_WORKER;
		else process.env.WALLPAPERDB_BOAT_WORKER = old;
	});
	const file = path.join(os.tmpdir(), `boat-no-queue-${process.pid}`);
	const a = await acquireDockerLease({ file }),
		b = await acquireDockerLease({ file });
	try {
		assert.equal(a.waitedMs, 0);
		assert.equal(b.waitedMs, 0);
		assert.equal(fs.existsSync(file), false);
	} finally {
		a.release();
		b.release();
	}
});

test("unenrolled worktrees and explicit local overrides stay local", () => {
	assert.equal(
		route({ mode: "validation" }, "run", undefined, "test:unit"),
		true,
	);
	assert.equal(route({ mode: "validation" }, "run", undefined, "dev"), false);
	assert.equal(
		route({ mode: "development" }, "run", undefined, "format:files"),
		false,
	);
	assert.equal(route(null, "ci"), false);
	assert.equal(route({ mode: "development" }, "ci", "local"), false);
	assert.equal(route({ mode: "validation" }, "dev"), false);
	assert.equal(route({ mode: "development" }, "dev"), true);
	assert.equal(route({ mode: "validation" }, "lint"), true);
	assert.equal(route({ mode: "development" }, "format"), false);
	assert.equal(route({ mode: "validation" }, "test-focused"), true);
	assert.equal(route({ mode: "validation" }, "build", "remote"), true);
});
test("sync sends changed files and deletions without deleting generated dependencies", () => {
	assert.deepEqual(delta({ a: "1", b: "2" }, { b: "3", c: "4" }), {
		changed: ["b", "c"],
		deleted: ["a"],
	});
});
test("shell arguments preserve quotes and metacharacters literally", () => {
	assert.equal(quote("a'b$(echo x)"), "'a'\\''b$(echo x)'");
});
test("budget includes idle time at the configured size", () => {
	assert.equal(estimate("large", 3600000), 0.072);
	assert.throws(() => estimate("unknown", 1));
});

test("authenticated cache isolates cohort writes and shares only frozen seed", async (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boat-cache-test-"));
	const a = cacheServer({
		directory,
		cohort: "a",
		token: "private-test-token",
	});
	const b = cacheServer({
		directory,
		cohort: "b",
		token: "private-test-token",
	});
	await Promise.all(
		[a, b].map(
			(server) =>
				new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)),
		),
	);
	t.after(async () => {
		await Promise.all(
			[a, b].map((server) => new Promise((resolve) => server.close(resolve))),
		);
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const key = "0123456789abcdef";
	const url = (server) =>
		`http://127.0.0.1:${server.address().port}/v8/artifacts/${key}`;
	const headers = { Authorization: "Bearer private-test-token" };
	assert.equal((await fetch(url(a))).status, 401);
	assert.equal(
		(await fetch(url(a), { method: "PUT", headers, body: "cohort A" })).status,
		200,
	);
	assert.equal(await (await fetch(url(a), { headers })).text(), "cohort A");
	assert.equal((await fetch(url(b), { headers })).status, 404);
	fs.mkdirSync(path.join(directory, "seed"));
	fs.writeFileSync(path.join(directory, "seed", key), "baseline");
	assert.equal(await (await fetch(url(b), { headers })).text(), "baseline");
	assert.equal(await (await fetch(url(a), { headers })).text(), "cohort A");
	assert.equal(
		(await fetch(url(b), { method: "HEAD", headers })).headers.get(
			"content-length",
		),
		"8",
	);
});

test("real Turbo restores an eligible build through authenticated HTTP into a fresh checkout", async (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boat-turbo-test-"));
	const records = [];
	const server = cacheServer({
		directory: path.join(directory, "artifacts"),
		cohort: "smoke",
		token: "fixture-token",
		record: (r) => records.push(r),
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const turbo = fileURLToPath(
		new URL("../node_modules/.bin/turbo", import.meta.url),
	);
	async function build(name) {
		const cwd = path.join(directory, name);
		fs.mkdirSync(cwd);
		fs.writeFileSync(
			path.join(cwd, "package.json"),
			JSON.stringify({
				name: "boat-cache-proof",
				private: true,
				packageManager: "pnpm@10.18.3",
				scripts: {
					build:
						"node -e \"require('fs').writeFileSync('result.txt','eligible output')\"",
				},
			}),
		);
		fs.writeFileSync(path.join(cwd, "pnpm-workspace.yaml"), "packages: []\n");
		fs.writeFileSync(
			path.join(cwd, "pnpm-lock.yaml"),
			"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
		);
		fs.writeFileSync(
			path.join(cwd, "turbo.json"),
			JSON.stringify({
				futureFlags: { experimentalObservability: true },
				tasks: { build: { outputs: ["result.txt"] } },
			}),
		);
		let log = "";
		await new Promise((resolve, reject) => {
			const child = spawn(
				turbo,
				["run", "build", "--cache=remote:rw", "--summarize"],
				{
					cwd,
					env: {
						...process.env,
						TURBO_API: `http://127.0.0.1:${server.address().port}`,
						TURBO_TEAM: "team_boat557",
						TURBO_TOKEN: "fixture-token",
						TURBO_TELEMETRY_DISABLED: "1",
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			child.stdout.on("data", (b) => (log += b));
			child.stderr.on("data", (b) => (log += b));
			child.on("error", reject);
			child.on("close", (code) =>
				code === 0 ? resolve() : reject(new Error(log)),
			);
		});
		assert.equal(
			fs.readFileSync(path.join(cwd, "result.txt"), "utf8"),
			"eligible output",
		);
		return log;
	}
	const cold = await build("cold");
	const warm = await build("fresh");
	assert.match(cold, /0 cached/);
	assert.match(warm, /1 cached/);
	const put = records.find((r) => r.method === "PUT");
	assert.ok(put?.bytes > 0);
	assert.ok(
		records.some(
			(r) =>
				r.method === "GET" &&
				r.key === put.key &&
				r.hit &&
				r.bytes === put.bytes,
		),
	);
});
