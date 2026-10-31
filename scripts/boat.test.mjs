import { createHash } from "node:crypto";
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
	developmentWantedAfterCommand,
} from "./lib/boat.mjs";
import http from "node:http";
import { once } from "node:events";

test("successful full app cleanup clears restoration intent while partial and failed cleanup preserve it", () => {
	assert.equal(developmentWantedAfterCommand(true, ["apps-stop"], 0), false);
	assert.equal(developmentWantedAfterCommand(true, ["stop"], 0), false);
	assert.equal(
		developmentWantedAfterCommand(true, ["stop", "SERVICE=web"], 0),
		true,
	);
	assert.equal(
		developmentWantedAfterCommand(true, ["apps-stop", "SERVICE="], 0),
		false,
	);
	assert.equal(
		developmentWantedAfterCommand(true, ["apps-stop", "SERVICE=web"], 0),
		true,
	);
	assert.equal(developmentWantedAfterCommand(true, ["apps-stop"], 2), true);
	assert.equal(
		developmentWantedAfterCommand(true, ["check", "PACKAGE=web"], 0),
		true,
	);
	assert.equal(developmentWantedAfterCommand(false, ["check"], 0), false);
});

test("preview forwards downstream cancellation after the request body completes", {
	timeout: 3000,
}, async (t) => {
	let disconnected;
	const closed = new Promise((resolve) => {
		disconnected = resolve;
	});
	const upstream = http.createServer((req, res) => {
		req.resume();
		res.on("close", disconnected);
	});
	t.after(() => {
		upstream.closeAllConnections();
		upstream.close();
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
	t.after(() => {
		proxy.closeAllConnections();
		proxy.close();
	});
	proxy.listen(0, "127.0.0.1");
	await once(proxy, "listening");
	const arrived = once(upstream, "request");
	const client = http.get({
		hostname: "127.0.0.1",
		port: proxy.address().port,
	});
	client.on("error", () => {});
	t.after(() => client.destroy());
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

test("preview retains a normally completed response", {
	timeout: 3000,
}, async (t) => {
	const upstream = http.createServer((req, res) => res.end("healthy control"));
	t.after(() => {
		upstream.closeAllConnections();
		upstream.close();
	});
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
	t.after(() => {
		proxy.closeAllConnections();
		proxy.close();
	});
	proxy.listen(0, "127.0.0.1");
	await once(proxy, "listening");
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
		"patches/nats-2.29.3.patch",
	]);
	assert.ok(files.includes("patches/nats-2.29.3.patch"));
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), "initial");
	}
	let previous = fingerprint(root, files);
	for (const file of [
		"patches/nats-2.29.3.patch",
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

// Exercise real Make routing, controller, archives and the maintained package script.
// Only Boat, mise and pnpm are controlled external processes. No worker is contacted.
function processGroupRunning(group) {
	if (!group) return false;
	return fs.readdirSync("/proc").some((pid) => {
		if (!/^\d+$/.test(pid)) return false;
		try {
			const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			return Number(fields[2]) === group && fields[0] !== "Z";
		} catch (error) {
			if (["ENOENT", "ESRCH"].includes(error.code)) return false;
			throw error;
		}
	});
}

async function stopLockFixtureChildren(children, drain = false) {
	const exited = async () => {
		const deadline = Date.now() + 1000;
		while (
			children.some((p) => !p.closed || processGroupRunning(p.child.pid))
		) {
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await Promise.all(children.map((p) => p.done));
		return true;
	};
	if (drain && (await exited())) return;
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		for (const { child } of children) {
			if (!processGroupRunning(child.pid)) continue;
			try {
				process.kill(-child.pid, signal);
			} catch (error) {
				if (error.code !== "ESRCH") throw error;
			}
		}
		if (await exited()) return;
	}
	assert.fail("Owned lock fixture process groups did not exit");
}

async function lockGenerationCheckout(t) {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-lock-command-"),
	);
	const root = path.join(directory, "source");
	const worker = path.join(directory, "worker");
	const home = path.join(directory, "home");
	const bin = path.join(home, ".local/bin");
	const control = path.join(directory, "control");
	const commands = [];
	const background = [];
	t.after(async () => {
		if (fs.existsSync(control))
			for (const name of [
				"release",
				"release-sync",
				"release-collect",
				"release-stop-completion",
			])
				fs.writeFileSync(path.join(control, name), "yes");
		try {
			await stopLockFixtureChildren(commands, true);
		} finally {
			await stopLockFixtureChildren(background);
		}
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const repository = path.resolve(import.meta.dirname, "..");
	const put = (name, bytes, mode) => {
		fs.mkdirSync(path.dirname(name), { recursive: true });
		fs.writeFileSync(name, bytes, { mode });
	};
	const local = (name, bytes) => put(path.join(root, name), bytes);
	const json = (name) => JSON.parse(fs.readFileSync(path.join(root, name)));
	for (const name of [
		"Makefile",
		"scripts/boat-route.mk",
		"scripts/boat.mjs",
		"scripts/boat-stop-watch.mjs",
		"scripts/lib/boat.mjs",
		"scripts/lib/boat-cache.mjs",
		"scripts/lib/boat-preparation.mjs",
		"scripts/lib/boat-snapshot.mjs",
		"scripts/package.json",
	]) {
		local(name, fs.readFileSync(path.join(repository, name)));
	}
	local("scripts/mise-shell.sh", '#!/bin/sh\nexec sh "$@"\n');
	fs.chmodSync(path.join(root, "scripts/mise-shell.sh"), 0o755);
	for (const name of [
		"scripts/setup-worktree.mjs",
		"scripts/toolchain.mjs",
		"scripts/lib/env-pipeline.mjs",
		"scripts/lib/worktree-project.mjs",
	])
		local(name, "// fixture setup has no side effects\n");
	for (const name of ["mise.lock", "mise.toml", ".npmrc"])
		local(name, "# fixture\n");
	local("pnpm-workspace.yaml", "packages: []\n");
	local("package.json", '{"private":true}\n');
	local("apps/user/package.json", '{"scripts":{}}\n');
	local("apps/user/.env.example", "CLERK_DOMAIN=example.clerk.accounts.dev\n");
	local("apps/asset/package.json", '{"scripts":{"dev:configure":"true"}}\n');
	local("patches/dependency.patch", "original patch\n");
	local("notes.txt", "original unrelated source\n");
	local(
		".gitignore",
		".boat/\n.mise/\n.worktree\n.env\n.authority.json\n.generated.conf\n.operator-inbox.json\n.workflow.json\n",
	);
	local(".worktree", "INGRESS_PORT=9120\n");
	local("infra/.env", "# private\n");
	local("apps/user/.env", "CLERK_DOMAIN=example.clerk.accounts.dev\n");
	for (const name of generatedAuthority) local(name, "{}\n");
	local(
		generatedAuthority[0],
		JSON.stringify({
			identityProviders: {
				clerk: {
					issuer: "https://example.clerk.accounts.dev",
					jwksUrl: "https://example.clerk.accounts.dev/.well-known/jwks.json",
					authorizedParties: ["http://localhost:9120", "http://127.0.0.1:9120"],
				},
			},
		}),
	);
	local("infra/postgres/init/fixture.sql", "-- fixture\n");
	// This fake models a stale lock, deterministic generation and frozen validation.
	put(
		path.join(bin, "pnpm"),
		`#!${process.execPath}
const fs=require('fs'),path=require('path'),cp=require('child_process');
const argv=process.argv.slice(2), root=process.env.FAKE_WORKER, control=process.env.FAKE_CONTROL;
function expected(){const inputs={};function visit(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=path.posix.join(dir,entry.name);if(entry.isDirectory()&&!['.git','.boat','.mise'].includes(entry.name))visit(name);else if(entry.isFile()&&(/(^|\\/)(package.json|\\.npmrc)$/.test(name)||name==='pnpm-workspace.yaml'||name.startsWith('patches/')))inputs[name]=fs.readFileSync(path.join(root,name),'utf8');}}visit('');return JSON.stringify({resolutions:{unrelated:'preserved@1.0.0'},inputs},null,2)+'\\n';}
if(argv[0]==='--filter') {const pkg=argv[1].split('/')[1],script=argv[3];const cwd=path.join(process.cwd(),pkg==='scripts'?'scripts':'apps/'+pkg);const command=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'))).scripts[script];if(!command)throw Error('missing maintained script '+script);process.exit(cp.spawnSync(command,{cwd,shell:true,stdio:'inherit',env:process.env}).status??1);}
if(argv[0]!=='install')throw Error('unexpected pnpm '+argv);
if(argv.includes('--lockfile-only')){
 if(JSON.stringify(argv)!==JSON.stringify(['install','--lockfile-only','--no-frozen-lockfile','--ignore-scripts']))throw Error('generator flags changed');
 fs.appendFileSync(path.join(control,'old-locks'),JSON.stringify(fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8'))+'\\n');
 fs.appendFileSync(path.join(control,'calls'),'generate\\n');
 fs.writeFileSync(path.join(control,'entered'),'yes');
 (async()=>{while(fs.existsSync(path.join(control,'pause'))&&!fs.existsSync(path.join(control,'release')))await new Promise(r=>setTimeout(r,10));
 fs.writeFileSync(path.join(root,'pnpm-lock.yaml'),expected());
 if(fs.existsSync(path.join(control,'missing')))fs.unlinkSync(path.join(root,'pnpm-lock.yaml'));
 if(fs.existsSync(path.join(control,'directory'))){fs.unlinkSync(path.join(root,'pnpm-lock.yaml'));fs.mkdirSync(path.join(root,'pnpm-lock.yaml'));}
 if(fs.existsSync(path.join(control,'symlink'))){fs.unlinkSync(path.join(root,'pnpm-lock.yaml'));fs.symlinkSync(path.join(control,'outside'),path.join(root,'pnpm-lock.yaml'));}
 process.exit(fs.existsSync(path.join(control,'fail'))?23:0);})();
}else{if(!argv.includes('--frozen-lockfile'))throw Error('normal install is not frozen');fs.appendFileSync(path.join(control,'calls'),'frozen\\n');if(fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8')!==expected()){console.error('ERR_PNPM_LOCKFILE_CONFIG_MISMATCH');process.exit(17);}fs.writeFileSync(path.join(control,'installed-dependencies'),fs.readFileSync(path.join(root,'pnpm-lock.yaml')));}
`,
		0o755,
	);
	put(
		path.join(bin, "mise"),
		`#!/bin/sh\nif [ "$1" = exec ]; then shift; [ "$1" != -- ] || shift; exec "$@"; fi\nexit 0\n`,
		0o755,
	);
	fs.mkdirSync(control);
	local("pnpm-lock.yaml", "stale lock\n");
	execFileSync("git", ["init", "-q", root]);
	const git = (...args) =>
		execFileSync("git", ["-C", root, ...args])
			.toString()
			.trim();
	git("add", ".");
	git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"-qm",
		"fixture",
	);
	fs.cpSync(root, worker, { recursive: true });
	const env = {
		...process.env,
		HOME: home,
		PATH: `${bin}:${process.env.PATH}`,
		FAKE_WORKER: worker,
		FAKE_CONTROL: control,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKEOVERRIDES: "",
		BOAT_EXEC: "",
	};
	// Fixture callers choose their own Make selectors, independent of the
	// outer `make run PACKAGE=scripts SCRIPT=test:boat` invocation.
	for (const name of [
		"MAKEOVERRIDES",
		"PACKAGE",
		"SERVICE",
		"SCRIPT",
		"ARGS",
		"APPS_COMPOSE",
	])
		delete env[name];
	put(
		path.join(root, ".mise/boat/boat"),
		`#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),path=require('path');
const argv=process.argv.slice(2),control=process.env.FAKE_CONTROL;
fs.appendFileSync(path.join(control,'transport'),JSON.stringify(argv)+'\\n');
if(argv.includes('info')&&!argv.includes('fake-new-worker')){
 if(fs.existsSync(path.join(control,'info-error'))){console.log(JSON.stringify({code:fs.readFileSync(path.join(control,'info-error'),'utf8')}));process.exit(41);}
 if(fs.existsSync(path.join(control,'stopping'))){
  if(!fs.existsSync(path.join(control,'stop-observed'))){fs.writeFileSync(path.join(control,'stop-observed'),'yes');console.log(JSON.stringify({state:'stopping'}));process.exit(0);}
  fs.writeFileSync(path.join(control,'stop-completing'),'yes');
  while(fs.existsSync(path.join(control,'pause-stop-completion'))&&!fs.existsSync(path.join(control,'release-stop-completion')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  if(fs.existsSync(path.join(control,'failed-stop-inspection'))){console.log(JSON.stringify({code:'inspection_failed'}));process.exit(42);}
  if(fs.existsSync(path.join(control,'incomplete-stop'))){console.log(JSON.stringify({state:'ready',stop:{id:'stop-current',status:'failing'}}));process.exit(0);}
  fs.writeFileSync(path.join(control,'sleep'),'yes');fs.unlinkSync(path.join(control,'stopping'));
 }
 console.log(fs.existsSync(path.join(control,'provider-info'))?fs.readFileSync(path.join(control,'provider-info'),'utf8'):JSON.stringify({state:fs.existsSync(path.join(control,'sleep'))?'stopped':'ready'}));process.exit(0);
}
if(argv.includes('stop')){fs.writeFileSync(path.join(control,'stopping'),'yes');if(fs.existsSync(path.join(control,'fail-stop')))process.exit(32);console.log(JSON.stringify({stop:{id:'stop-current',status:'pending'}}));process.exit(0);}
if(argv.includes('info')&&argv.includes('fake-new-worker')){console.log(JSON.stringify({sandbox:{id:'fake-new-worker',state:'ready'}}));process.exit(0);}
if(argv.includes('list')){console.log(fs.existsSync(path.join(control,'worker-list'))?fs.readFileSync(path.join(control,'worker-list'),'utf8'):JSON.stringify({sandboxes:[]}));process.exit(0);}
if(argv.includes('limits')){if(fs.existsSync(path.join(control,'fail-limits'))){console.log(JSON.stringify({code:'limits_failed'}));process.exit(43);}console.log(JSON.stringify({canStart:true,nextStartDollars:0}));process.exit(0);}
if(argv.includes('new')){fs.writeFileSync(path.join(control,'creation-state'),fs.readFileSync('.boat/state.json'));console.log(JSON.stringify({sandbox:{id:'fake-new-worker'}}));process.exit(0);}
if(argv.includes('usage')){console.log('{}');process.exit(0);}
if(argv.includes('snapshot')&&argv.includes('latest')){console.log(JSON.stringify({snapshot:{id:'snapshot-current',sandboxId:'fake-worker',chainId:'chain-current',generation:3,status:'completed',kind:'incremental',origin:'captured',createdAt:'2026-10-31T01:00:00Z',completedAt:'2026-10-31T01:00:01Z',fileCount:42}}));process.exit(0);}
if((argv.includes('ssh')||argv.includes('exec'))&&fs.existsSync(path.join(control,'audit-startup')))fs.appendFileSync(path.join(control,'startup-state'),JSON.stringify(JSON.parse(fs.readFileSync('.boat/state.json','utf8')))+'\\n');
if(argv.includes('ssh')&&argv.at(-1).includes('sudo -n')&&fs.existsSync(path.join(control,'fail-retire')))process.exit(31);
if(argv.includes('extend')){console.log('{}');process.exit(0);}
if(argv.includes('resume')){fs.unlinkSync(path.join(control,'sleep'));console.log('{}');process.exit(0);}
const command=argv.at(-1).replaceAll('/home/user/wallpaperdb',process.env.FAKE_WORKER);
if(argv.includes('ssh')&&(command.startsWith('mkdir -p '+process.env.FAKE_WORKER+';')||command.includes('sudo -n')||command.includes('--input-type=module -')))process.exit(0);
if(!argv.includes('ssh')&&!argv.includes('exec'))throw Error('unexpected Boat '+argv);
if(command.includes('base64 -w0')){
 fs.writeFileSync(path.join(control,'collecting'),'yes');
 if(fs.existsSync(path.join(control,'transfer-fail')))process.exit(31);
 if(fs.existsSync(path.join(control,'framed'))){console.log(JSON.stringify({type:'stdout',data:'invalid framed payload'}));process.exit(0);}
}
const pause=command.includes('tar -xzf -')?'sync':command.includes('base64 -w0')?'collect':null;
if(pause&&fs.existsSync(path.join(control,'pause-'+pause))){fs.writeFileSync(path.join(control,'entered-'+pause),'yes');while(!fs.existsSync(path.join(control,'release-'+pause))||fs.existsSync(path.join(control,'ignore-release')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
const stream=argv.includes('--stream'),child=cp.spawn('bash',['-c',command],{env:process.env,stdio:['pipe',stream?'pipe':'inherit',stream?'pipe':'inherit']});
process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});
if(stream)for(const type of ['stdout','stderr'])child[type].on('data',b=>console.log(JSON.stringify({type,data:b.toString()})));
child.on('close',code=>process.exit(code??1));
`,
		0o755,
	);
	const start = (owned, command, args) => {
		const child = spawn(command, args, {
			cwd: root,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (b) => (output += b));
		child.stderr.on("data", (b) => (output += b));
		child.on("error", (error) => (output += error.message));
		const record = { child, closed: false };
		record.done = new Promise((resolve) => {
			child.on("close", (status) => {
				record.closed = true;
				resolve({ status, output });
			});
		});
		owned.push(record);
		return record;
	};
	const { child: keeper } = start(background, process.execPath, [
		"-e",
		"console.log('ready');setInterval(()=>{},1000)",
	]);
	await once(keeper.stdout, "data");
	const processRecord = worktreeProcesses(root).find(
		(p) => p.pid === keeper.pid,
	);
	const save = (name, value) => local(name, JSON.stringify(value));
	save(".boat/enrollment.json", {
		root,
		base: git("rev-parse", "HEAD"),
		key: "fixture",
		cohort: "smoke",
		mode: "development",
		size: "large",
	});
	save(".boat/state.json", {
		id: "fake-worker",
		size: "large",
		cost: 0,
		runningSince: Date.now(),
		lastActivity: Date.now(),
		daemon: processRecord,
	});
	save(".boat/cache-server.json", processRecord);
	save(".boat/cache.json", { api: "http://127.0.0.1:12345", token: "fixture" });
	save(".boat/cache-tunnel.json", {
		...processRecord,
		id: "fake-worker",
		api: "http://127.0.0.1:12345",
	});
	const run = (...targets) => start(commands, "make", targets);
	return {
		directory,
		root,
		worker,
		control,
		env,
		local,
		json,
		run,
		daemon: () =>
			start(background, process.execPath, ["scripts/boat.mjs", "daemon"]),
		generate: () =>
			run("run", "PACKAGE=scripts", "SCRIPT=dependencies:lock").done,
	};
}

test("public lock generation repairs stale dependency inputs before frozen preparation and returns only the lock", async (t) => {
	const f = await lockGenerationCheckout(t);
	f.local("patches/dependency.patch", "changed tracked patch\n");
	f.local("patches/new.patch", "new untracked patch\n");
	const first = await f.generate();
	assert.equal(first.status, 0, first.output);
	const accepted = fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8");
	const lock = JSON.parse(accepted);
	assert.equal(
		lock.inputs["patches/dependency.patch"],
		"changed tracked patch\n",
	);
	assert.equal(lock.inputs["patches/new.patch"], "new untracked patch\n");
	assert.deepEqual(lock.resolutions, { unrelated: "preserved@1.0.0" });
	assert.equal(
		fs.readFileSync(path.join(f.worker, "pnpm-lock.yaml"), "utf8"),
		accepted,
	);
	assert.equal(fs.existsSync(path.join(f.root, ".boat/prepared.json")), false);
	const normal = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=dev:configure",
		"BOAT_EXEC=remote",
	).done;
	assert.equal(normal.status, 0, normal.output);
	assert.match(
		fs.readFileSync(path.join(f.control, "calls"), "utf8"),
		/generate\nfrozen\n/,
	);
	const prepared = fs.readFileSync(path.join(f.root, ".boat/prepared.json"));
	const second = await f.generate();
	assert.equal(second.status, 0, second.output);
	assert.equal(
		fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8"),
		accepted,
	);
	assert.deepEqual(
		fs.readFileSync(path.join(f.root, ".boat/prepared.json")),
		prepared,
	);
});

async function observed(predicate, description) {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() >= deadline)
			assert.fail(`Timed out observing ${description}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
function flag(f, name) {
	fs.writeFileSync(path.join(f.control, name), "yes");
}
async function pausedGeneration(t, phase = "") {
	const f = await lockGenerationCheckout(t);
	flag(f, phase ? `pause-${phase}` : "pause");
	const pending = f.generate();
	await observed(
		() =>
			fs.existsSync(
				path.join(f.control, phase ? `entered-${phase}` : "entered"),
			),
		`paused ${phase || "generator"}`,
	);
	return {
		...f,
		pending,
		release: () => flag(f, phase ? `release-${phase}` : "release"),
	};
}

// Run an actual failing test in a child so its after hooks and open handles are
// exercised without failing (or hanging) the surrounding regression suite.
if (process.env.BOAT_LOCK_CLEANUP_PHASE) {
	test("lock fixture intentional failure", async (t) => {
		const phase = process.env.BOAT_LOCK_CLEANUP_PHASE;
		const pause =
			phase === "generate" ? "" : phase === "unresponsive" ? "sync" : phase;
		const f = await pausedGeneration(t, pause);
		if (phase === "unresponsive") flag(f, "ignore-release");
		f.pending.then((result) => {
			fs.writeFileSync(
				`${process.env.BOAT_LOCK_CLEANUP_REPORT}.result`,
				JSON.stringify(result),
			);
		});
		const { child: daemon } = f.daemon();
		await observed(
			() => worktreeProcesses(f.root).some((p) => p.pid === daemon.pid),
			"owned daemon started",
		);
		const processes = [
			...worktreeProcesses(f.root),
			...worktreeProcesses(f.worker),
		].flatMap((record) => {
			try {
				const stat = fs.readFileSync(`/proc/${record.pid}/stat`, "utf8");
				const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
				return [{ ...record, group: Number(fields[2]) }];
			} catch (error) {
				if (["ENOENT", "ESRCH"].includes(error.code)) return [];
				throw error;
			}
		});
		fs.writeFileSync(
			process.env.BOAT_LOCK_CLEANUP_REPORT,
			JSON.stringify({ directory: f.directory, processes }),
		);
		assert.fail("intentional failure before normal barrier release");
	});
}

for (const phase of ["sync", "generate", "collect", "unresponsive"])
	test(`lock fixture cleans up after failure during ${phase} without stopping unrelated processes`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-lock-cleanup-"),
		);
		const report = path.join(directory, "report.json");
		const unrelated = spawn(process.execPath, [
			"-e",
			"console.log('ready');setInterval(()=>{},1000)",
		]);
		const unrelatedClosed = once(unrelated, "close");
		let unrelatedReady = false;
		unrelated.stdout.once("data", () => {
			unrelatedReady = true;
		});
		const runner = spawn(
			process.execPath,
			[
				"--test",
				"--test-name-pattern=^lock fixture intentional failure$",
				fileURLToPath(import.meta.url),
			],
			{
				detached: true,
				env: {
					...process.env,
					NODE_TEST_CONTEXT: undefined,
					NODE_OPTIONS: "",
					BOAT_LOCK_CLEANUP_PHASE: phase,
					BOAT_LOCK_CLEANUP_REPORT: report,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "";
		runner.stdout.on("data", (b) => (output += b));
		runner.stderr.on("data", (b) => (output += b));
		let closed = false;
		const done = once(runner, "close").then(([status]) => {
			closed = true;
			return status;
		});
		t.after(async () => {
			const snapshot = fs.existsSync(report)
				? JSON.parse(fs.readFileSync(report, "utf8"))
				: null;
			// Emergency cleanup bounds the regression even against the broken fixture.
			const groups = new Set([
				runner.pid,
				...(snapshot?.processes.map((p) => p.group) ?? []),
			]);
			try {
				for (const group of groups) {
					try {
						process.kill(-group, "SIGKILL");
					} catch (error) {
						if (error.code !== "ESRCH") throw error;
					}
				}
				await observed(() => closed, "regression runner emergency shutdown");
				await done;
			} finally {
				unrelated.kill("SIGKILL");
				await observed(
					() => unrelated.exitCode !== null || unrelated.signalCode !== null,
					"unrelated process shutdown",
				);
				await unrelatedClosed;
			}
			if (snapshot)
				fs.rmSync(snapshot.directory, { recursive: true, force: true });
			fs.rmSync(directory, { recursive: true, force: true });
		});
		await observed(() => unrelatedReady, "unrelated process ready");
		await observed(
			() => fs.existsSync(report) || closed,
			"failure scenario ready",
		);
		assert.equal(fs.existsSync(report), true, output);
		await observed(() => closed, `failed ${phase} test exits after cleanup`);
		assert.equal(await done, 1, output);
		assert.match(output, /intentional failure before normal barrier release/);
		const snapshot = JSON.parse(fs.readFileSync(report, "utf8"));
		const result = JSON.parse(fs.readFileSync(`${report}.result`, "utf8"));
		if (phase === "unresponsive")
			assert.notEqual(result.status, 0, result.output);
		else assert.equal(result.status, 0, result.output);
		assert.equal(fs.existsSync(snapshot.directory), false);
		for (const record of snapshot.processes) {
			const statPath = `/proc/${record.pid}/stat`;
			if (!fs.existsSync(statPath)) continue;
			const stat = fs.readFileSync(statPath, "utf8");
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			assert.ok(
				fields[19] !== record.startTicks || fields[0] === "Z",
				`owned process ${record.pid} survived fixture cleanup`,
			);
		}
		assert.equal(unrelated.exitCode, null);
		assert.equal(unrelated.signalCode, null);
		assert.equal(unrelated.kill(0), true);
	});

for (const [name, edit] of [
	["old output", (f) => f.local("pnpm-lock.yaml", "concurrent local lock\n")],
	[
		"manifest",
		(f) => f.local("package.json", '{"private":true,"concurrent":true}\n'),
	],
	[
		"tracked patch",
		(f) => f.local("patches/dependency.patch", "concurrent tracked patch\n"),
	],
	[
		"untracked input addition",
		(f) => f.local("patches/concurrent.patch", "concurrent new patch\n"),
	],
	[
		"input deletion",
		(f) => fs.unlinkSync(path.join(f.root, "patches/dependency.patch")),
	],
])
	test(`public lock generation rejects concurrent ${name} edits and retains the proposal`, async (t) => {
		const f = await pausedGeneration(t);
		edit(f);
		const before = execFileSync("git", ["diff", "--binary"], { cwd: f.root });
		const lock = fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"));
		f.release();
		const result = await f.pending;
		assert.notEqual(result.status, 0);
		assert.match(result.output, /Local dependency inputs or old lock changed/);
		assert.deepEqual(
			fs.readFileSync(path.join(f.root, "pnpm-lock.yaml")),
			lock,
		);
		assert.deepEqual(
			execFileSync("git", ["diff", "--binary"], { cwd: f.root }),
			before,
		);
		if (name === "untracked input addition")
			assert.equal(
				fs.readFileSync(path.join(f.root, "patches/concurrent.patch"), "utf8"),
				"concurrent new patch\n",
			);
		const proposal = result.output.match(
			/proposal retained at (.+\/pnpm-lock.yaml)/,
		)?.[1];
		assert.ok(proposal, result.output);
		assert.equal(path.relative(f.root, proposal).startsWith(".."), true);
		assert.equal(fs.statSync(proposal).mode & 0o777, 0o600);
		assert.equal(
			JSON.parse(fs.readFileSync(proposal)).inputs["patches/dependency.patch"],
			"original patch\n",
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/prepared.json")),
			false,
		);
		assert.equal(f.json(".boat/manifest.json")["pnpm-lock.yaml"], null);
	});

test("captured dependency bytes reach the worker even when local inputs change during upload", async (t) => {
	const f = await pausedGeneration(t, "sync");
	f.local("patches/dependency.patch", "edited while transporting\n");
	f.release();
	const result = await f.pending;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Local dependency inputs or old lock changed/);
	const proposal = result.output.match(
		/proposal retained at (.+\/pnpm-lock.yaml)/,
	)[1];
	assert.equal(
		JSON.parse(fs.readFileSync(proposal)).inputs["patches/dependency.patch"],
		"original patch\n",
	);
	assert.equal(
		fs.readFileSync(path.join(f.root, "patches/dependency.patch"), "utf8"),
		"edited while transporting\n",
	);
});

test("failed generation preserves local authority and a later transaction restores its old output", async (t) => {
	const f = await lockGenerationCheckout(t);
	flag(f, "fail");
	const result = await f.generate();
	assert.notEqual(result.status, 0);
	assert.match(result.output, /Lock generator failed/);
	assert.equal(
		fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8"),
		"stale lock\n",
	);
	const proposal = result.output.match(
		/proposal retained at (.+\/pnpm-lock.yaml)/,
	)[1];
	assert.equal(
		JSON.parse(fs.readFileSync(proposal)).resolutions.unrelated,
		"preserved@1.0.0",
	);
	assert.equal(fs.existsSync(path.join(f.root, ".boat/prepared.json")), false);
	fs.unlinkSync(path.join(f.control, "fail"));
	flag(f, "pause");
	const next = f.generate();
	await observed(
		() =>
			fs.readFileSync(path.join(f.control, "calls"), "utf8").split("generate\n")
				.length === 3,
		"second generation",
	);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "pnpm-lock.yaml"), "utf8"),
		"stale lock\n",
	);
	flag(f, "release");
	const accepted = await next;
	assert.equal(accepted.status, 0, accepted.output);
});

for (const mode of [
	"missing",
	"directory",
	"symlink",
	"transfer-fail",
	"framed",
])
	test(`public lock generation rejects ${mode} output without importing source`, async (t) => {
		const f = await lockGenerationCheckout(t);
		fs.writeFileSync(path.join(f.control, "outside"), "outside bytes\n");
		flag(f, mode);
		const result = await f.generate();
		assert.notEqual(result.status, 0);
		assert.match(result.output, /output collection failed/);
		assert.equal(
			fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8"),
			"stale lock\n",
		);
		assert.equal(
			fs.readFileSync(path.join(f.control, "outside"), "utf8"),
			"outside bytes\n",
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/prepared.json")),
			false,
		);
	});

test("acceptance leaves unrelated concurrent edits pending for the next source sync", async (t) => {
	const f = await pausedGeneration(t);
	const before = f.json(".boat/manifest.json")["notes.txt"];
	f.local("notes.txt", "pending unrelated source\n");
	f.release();
	const result = await f.pending;
	assert.equal(result.status, 0, result.output);
	assert.equal(f.json(".boat/manifest.json")["notes.txt"], before);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "notes.txt"), "utf8"),
		"original unrelated source\n",
	);
	const next = await f.generate();
	assert.equal(next.status, 0, next.output);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "notes.txt"), "utf8"),
		"pending unrelated source\n",
	);
});

test("tracked and previously synchronized untracked patch deletions reach generation and frozen preparation", async (t) => {
	const f = await lockGenerationCheckout(t);
	f.local("patches/new.patch", "disposable untracked patch\n");
	assert.equal((await f.generate()).status, 0);
	fs.unlinkSync(path.join(f.root, "patches/dependency.patch"));
	fs.unlinkSync(path.join(f.root, "patches/new.patch"));
	const result = await f.generate();
	assert.equal(result.status, 0, result.output);
	const inputs = JSON.parse(
		fs.readFileSync(path.join(f.root, "pnpm-lock.yaml")),
	).inputs;
	assert.equal(inputs["patches/dependency.patch"], undefined);
	assert.equal(inputs["patches/new.patch"], undefined);
	assert.equal(
		fs.existsSync(path.join(f.worker, "patches/dependency.patch")),
		false,
	);
	assert.equal(fs.existsSync(path.join(f.worker, "patches/new.patch")), false);
	const frozen = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=dev:configure",
		"BOAT_EXEC=remote",
	).done;
	assert.equal(frozen.status, 0, frozen.output);
});

async function developmentCheckout(t) {
	const f = await lockGenerationCheckout(t);
	// Keep the real Make/controller path; control only remote process responses
	// and Docker so restoration cannot touch a worker or the host's containers.
	const transport = path.join(f.root, ".mise/boat/boat");
	fs.writeFileSync(
		transport,
		fs.readFileSync(transport, "utf8").replace(
			"const command=argv.at(-1)",
			`if(argv.includes('--status')){console.log(JSON.stringify({running:!fs.existsSync(path.join(control,'fail-watch')),stdout:'Watch enabled'}));process.exit(0);}
if(argv.includes('--detach')){console.log(JSON.stringify({processId:557}));process.exit(0);}
if(argv.includes('ssh')&&argv.at(-1).includes('SCRIPT=boat:ready')){
 if(argv.at(-1).includes('ARGS=--once'))process.exit(fs.existsSync(path.join(control,'not-ready'))?1:0);
 if(argv.at(-1).includes('make apps-start')){
  const startup=argv.at(-1).split('make run PACKAGE=scripts SCRIPT=boat:ready')[0].replaceAll('/home/user/wallpaperdb',process.env.FAKE_WORKER);
  const result=cp.spawnSync('bash',['-c',startup+'true'],{env:process.env,stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
 }
 console.error('fixture ends preview at readiness');process.exit(37);
}
const command=argv.at(-1)`,
		),
	);
	fs.writeFileSync(
		path.join(f.directory, "home/.local/bin/docker"),
		`#!/bin/bash
exec -a docker-compose '${process.execPath}' - "$@" <<'NODE'
const fs=require('fs'),path=require('path'),control=process.env.FAKE_CONTROL,argv=process.argv.slice(2);
const apps=argv.includes('infra/docker-compose.apps.yml')||argv.includes('.boat/development-compose.json');
fs.appendFileSync(path.join(control,'docker'),JSON.stringify(argv)+'\\n');
if(argv.includes('up')&&apps&&fs.existsSync(path.join(control,'fail-apps')))process.exit(29);
if(argv.includes('down')&&fs.existsSync(path.join(control,'fail-cleanup')))process.exit(30);
if(apps){
 const image=path.join(control,'image-dependencies');
 if(argv.includes('build')||argv.includes('--build')){
  if(fs.existsSync(path.join(control,'fail-build')))process.exit(32);
  fs.writeFileSync(image,fs.readFileSync(path.join(process.env.FAKE_WORKER,'pnpm-lock.yaml')));
 }
 if(argv.includes('up')){
  if(!fs.existsSync(image))throw Error('No application image');
  fs.writeFileSync(path.join(control,'running-dependencies'),fs.readFileSync(image));
 }
 if(argv.includes('watch')){
  fs.writeFileSync(path.join(control,'watch-pid'),String(process.pid));
  console.log('Watch enabled');
  setInterval(()=>fs.writeFileSync(path.join(control,'watched-source'),fs.readFileSync(path.join(process.env.FAKE_WORKER,'notes.txt'))),10);
 }
}
NODE
`,
		{ mode: 0o755 },
	);
	f.local("scripts/check-infra.sh", "#!/bin/sh\nexit 0\n");
	fs.chmodSync(path.join(f.root, "scripts/check-infra.sh"), 0o755);
	f.local(
		"node_modules/.bin/turbo",
		`#!${process.execPath}
require('fs').appendFileSync(require('path').join(process.env.FAKE_CONTROL,'validation'),JSON.stringify(process.argv.slice(2))+'\\n');
`,
	);
	fs.chmodSync(path.join(f.root, "node_modules/.bin/turbo"), 0o755);
	const normal = () =>
		f.run("run", "PACKAGE=asset", "SCRIPT=dev:configure", "BOAT_EXEC=remote")
			.done;
	const generated = await f.generate();
	assert.equal(generated.status, 0, generated.output);
	const prepared = await normal();
	assert.equal(prepared.status, 0, prepared.output);
	return {
		...f,
		normal,
		dependencies: (name) =>
			JSON.parse(fs.readFileSync(path.join(f.control, `${name}-dependencies`))),
		transport: () =>
			fs
				.readFileSync(path.join(f.control, "transport"), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
	};
}

async function pendingDevelopmentCheckout(t) {
	const f = await developmentCheckout(t);
	const built = await f.run("apps-start").done;
	assert.equal(built.status, 0, built.output);
	for (const name of ["calls", "transport", "docker"])
		fs.rmSync(path.join(f.control, name), { force: true });
	// Exercise deferred reconciliation while awake. The available contract
	// cannot produce a legitimately qualified stopped snapshot.
	f.local(
		".boat/state.json",
		JSON.stringify({
			...f.json(".boat/state.json"),
			reconciliationPending: true,
		}),
	);
	return f;
}

for (const targets of [
	["dev"],
	["dev", "ARGS=--no-up"],
	[
		"dev",
		"ARGS=--no-up",
		"APPS_COMPOSE=docker compose -p wallpaperdb -f .boat/development-compose.json",
	],
])
	for (const entry of ["validation", "preview"])
		test(`awake ${targets.join(" ")} keeps its foreground watcher through ${entry}`, async (t) => {
			const f = await developmentCheckout(t);
			// An existing image lets --no-up watch without proving its freshness.
			fs.copyFileSync(
				path.join(f.worker, "pnpm-lock.yaml"),
				path.join(f.control, "image-dependencies"),
			);
			const foreground = f.run(...targets);
			await observed(
				() =>
					fs.existsSync(path.join(f.control, "watch-pid")) &&
					fs
						.readFileSync(path.join(f.root, ".boat/events.jsonl"), "utf8")
						.includes('"kind":"foreground-watching"'),
				"foreground Make development watcher",
			);
			const watcher = Number(
				fs.readFileSync(path.join(f.control, "watch-pid")),
			);
			const before = fs.readFileSync(path.join(f.control, "docker"), "utf8");
			const result = await (entry === "validation"
				? f.run("check", "PACKAGE=user").done
				: f.run("boat-preview").done);
			if (entry === "validation") {
				assert.equal(result.status, 0, result.output);
				assert.match(
					fs.readFileSync(path.join(f.control, "validation"), "utf8"),
					/check-types/,
				);
			} else assert.match(result.output, /fixture ends preview at readiness/);
			assert.equal(
				foreground.closed,
				false,
				"foreground make must keep running",
			);
			process.kill(watcher, 0);
			assert.equal(
				fs.readFileSync(path.join(f.control, "docker"), "utf8"),
				before,
			);
			assert.equal(
				f.json(".boat/state.json").developmentDependencies,
				undefined,
			);
			assert.equal(
				f.transport().some((argv) => argv.includes("--detach")),
				false,
			);
			f.local("notes.txt", "source changed while development stays awake\n");
			const synced = await f.normal();
			assert.equal(synced.status, 0, synced.output);
			await observed(
				() =>
					fs.existsSync(path.join(f.control, "watched-source")) &&
					fs.readFileSync(path.join(f.control, "watched-source"), "utf8") ===
						"source changed while development stays awake\n",
				"surviving watcher receives synchronized source",
			);
			assert.equal(foreground.closed, false);
			assert.equal(
				fs.readFileSync(path.join(f.control, "docker"), "utf8"),
				before,
			);
		});

for (const targets of [
	["apps-start"],
	["apps-start", "SERVICE=web"],
	["apps-start", "ARGS=--build"],
])
	for (const entry of ["validation", "preview"])
		test(`awake ${targets.join(" ")} avoids unrelated app mutations during ${entry}`, async (t) => {
			const f = await developmentCheckout(t);
			const started = await f.run(...targets).done;
			assert.equal(started.status, 0, started.output);
			const before = fs.readFileSync(path.join(f.control, "docker"), "utf8");
			const result = await (entry === "validation"
				? f.run("check", "PACKAGE=user").done
				: f.run("boat-preview").done);
			if (entry === "validation") assert.equal(result.status, 0, result.output);
			else assert.match(result.output, /fixture ends preview at readiness/);
			assert.equal(
				fs.readFileSync(path.join(f.control, "docker"), "utf8"),
				before,
			);
			assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
		});

test("awake healthy preview leaves unknown images alone without saved development intent", async (t) => {
	const f = await developmentCheckout(t);
	const preview = await f.run("boat-preview").done;
	assert.match(preview.output, /fixture ends preview at readiness/);
	assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
	assert.equal(f.json(".boat/state.json").developmentDependencies, undefined);
});

test("initial preview uses ordinary startup when readiness fails without a recovery obligation", async (t) => {
	const f = await developmentCheckout(t);
	flag(f, "not-ready");
	const preview = await f.run("boat-preview").done;
	assert.match(preview.output, /fixture ends preview at readiness/);
	const docker = fs
		.readFileSync(path.join(f.control, "docker"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.deepEqual(
		docker.map((argv) => argv.slice(4)),
		[
			["infra/docker-compose.yml", "up", "-d"],
			["infra/docker-compose.apps.yml", "up", "-d", "--build"],
		],
	);
	assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
});

test("awake pending reconciliation follows generation and frozen preparation", async (t) => {
	const f = await pendingDevelopmentCheckout(t);
	const result = await f.generate();
	assert.equal(result.status, 0, result.output);
	assert.doesNotMatch(result.output, /Remote environment resumed from sleep/);
	assert.equal(f.json(".boat/state.json").developmentWanted, true);
	assert.equal(f.json(".boat/state.json").reconciliationPending, true);
	assert.doesNotMatch(
		fs.readFileSync(path.join(f.control, "transport"), "utf8"),
		/make infra-start|make apps-start/,
	);
	const restored = await f.normal();
	assert.equal(restored.status, 0, restored.output);
	assert.equal(f.json(".boat/state.json").developmentWanted, true);
	assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
	assert.equal(f.json(".boat/state.json").watcher, 557);
	const calls = f.transport();
	const restoration = calls.findIndex((argv) =>
		argv.at(-1).includes("make apps-start ARGS=--no-build"),
	);
	assert.ok(restoration > 0);
	assert.equal(
		calls.some((argv) => argv.at(-1).includes("make install BOAT_EXEC=worker")),
		false,
	);
	assert.equal(
		f.dependencies("running").inputs["patches/dependency.patch"],
		"original patch\n",
	);
	assert.deepEqual(
		fs.readFileSync(path.join(f.control, "calls"), "utf8").trim().split("\n"),
		["generate"],
	);
	const docker = fs.readFileSync(path.join(f.control, "docker"), "utf8");
	assert.match(docker, /"up","-d","--no-build"/);
	const repeated = await f.normal();
	assert.equal(repeated.status, 0, repeated.output);
	assert.equal(fs.readFileSync(path.join(f.control, "docker"), "utf8"), docker);
});

for (const entry of ["normal", "preview"])
	for (const [name, changed] of [
		["patches/dependency.patch", "changed dependency B\n"],
		[
			"apps/user/package.json",
			'{"scripts":{},"dependencies":{"example":"2.0.0"}}\n',
		],
	])
		test(`awake pending reconciliation through ${entry} runs newly prepared images after changing ${name}`, async (t) => {
			const f = await pendingDevelopmentCheckout(t);
			const original = f.dependencies("running").inputs[name];
			assert.notEqual(original, changed);
			f.local(name, changed);
			const generated = await f.generate();
			assert.equal(generated.status, 0, generated.output);
			// Generators never prepare or restore runtime, even after waking it.
			assert.equal(f.dependencies("installed").inputs[name], original);
			assert.equal(f.dependencies("running").inputs[name], original);
			const restored = await (entry === "normal"
				? f.normal()
				: f.run("boat-preview").done);
			if (entry === "normal") assert.equal(restored.status, 0, restored.output);
			else assert.match(restored.output, /fixture ends preview at readiness/);
			assert.equal(f.dependencies("installed").inputs[name], changed);
			assert.equal(f.dependencies("running").inputs[name], changed);
			assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
			const docker = fs.readFileSync(path.join(f.control, "docker"), "utf8");
			const repeated = await f.normal();
			assert.equal(repeated.status, 0, repeated.output);
			assert.equal(
				fs.readFileSync(path.join(f.control, "docker"), "utf8"),
				docker,
			);
		});

for (const identity of ["missing", "other-worker"])
	test(`awake pending reconciliation rebuilds images when their dependency identity is ${identity}`, async (t) => {
		const f = await pendingDevelopmentCheckout(t);
		const state = f.json(".boat/state.json");
		if (identity === "missing") delete state.developmentDependencies;
		else state.developmentDependencies.id = "a-different-worker";
		f.local(".boat/state.json", JSON.stringify(state));
		fs.writeFileSync(
			path.join(f.control, "image-dependencies"),
			'{"inputs":{"patches/dependency.patch":"unknown stale image"}}',
		);
		const restored = await f.normal();
		assert.equal(restored.status, 0, restored.output);
		assert.equal(
			f.dependencies("running").inputs["patches/dependency.patch"],
			"original patch\n",
		);
		assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
	});

test("awake pending preview with no saved development intent rebuilds unknown images", async (t) => {
	const f = await pendingDevelopmentCheckout(t);
	const state = f.json(".boat/state.json");
	state.developmentWanted = false;
	delete state.developmentDependencies;
	f.local(".boat/state.json", JSON.stringify(state));
	fs.writeFileSync(
		path.join(f.control, "image-dependencies"),
		'{"inputs":{"patches/dependency.patch":"unknown stale image"}}',
	);
	const preview = await f.run("boat-preview").done;
	assert.match(preview.output, /fixture ends preview at readiness/);
	assert.equal(
		f.dependencies("running").inputs["patches/dependency.patch"],
		"original patch\n",
	);
});

test("awake pending preview without saved intent survives preparation and rebuild failures", async (t) => {
	const f = await pendingDevelopmentCheckout(t);
	const state = f.json(".boat/state.json");
	state.developmentWanted = false;
	delete state.developmentDependencies;
	f.local(".boat/state.json", JSON.stringify(state));
	f.local("patches/dependency.patch", "changed dependency B\n");
	const invalid = await f.run("boat-preview").done;
	assert.match(invalid.output, /ERR_PNPM_LOCKFILE_CONFIG_MISMATCH/);
	assert.equal(f.json(".boat/state.json").reconciliationPending, true);
	assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
	const generated = await f.generate();
	assert.equal(generated.status, 0, generated.output);
	flag(f, "fail-build");
	const incomplete = await f.run("boat-preview").done;
	assert.notEqual(incomplete.status, 0);
	assert.equal(f.json(".boat/state.json").reconciliationPending, true);
	assert.equal(f.json(".boat/state.json").developmentDependencies, undefined);
	fs.unlinkSync(path.join(f.control, "fail-build"));
	const retried = await f.run("boat-preview").done;
	assert.match(retried.output, /fixture ends preview at readiness/);
	assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
	assert.equal(
		f.dependencies("running").inputs["patches/dependency.patch"],
		"changed dependency B\n",
	);
});

for (const failure of ["fail-build", "fail-apps", "fail-watch"])
	test(`awake pending reconciliation survives failed generation, frozen preparation and ${failure}`, async (t) => {
		const f = await pendingDevelopmentCheckout(t);
		f.local("patches/dependency.patch", "changed dependency B\n");
		flag(f, "fail");
		const failed = await f.generate();
		assert.notEqual(failed.status, 0);
		assert.match(failed.output, /Lock generator failed/);
		assert.doesNotMatch(failed.output, /Remote environment resumed from sleep/);
		assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		const invalid = await f.normal();
		assert.notEqual(invalid.status, 0);
		assert.match(invalid.output, /ERR_PNPM_LOCKFILE_CONFIG_MISMATCH/);
		assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		fs.unlinkSync(path.join(f.control, "fail"));
		for (let i = 0; i < 2; i++) {
			const generated = await f.generate();
			assert.equal(generated.status, 0, generated.output);
			assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		}
		assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
		flag(f, failure);
		const incomplete = await f.normal();
		assert.notEqual(incomplete.status, 0);
		assert.equal(f.json(".boat/state.json").developmentWanted, true);
		assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		assert.notEqual(
			f.json(".boat/state.json").developmentDependencies.dependencies,
			f.json(".boat/prepared.json").dependencies,
		);
		fs.unlinkSync(path.join(f.control, failure));
		const retried = await f.normal();
		assert.equal(retried.status, 0, retried.output);
		assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
		assert.equal(f.json(".boat/state.json").watcher, 557);
		assert.equal(
			f.dependencies("running").inputs["patches/dependency.patch"],
			"changed dependency B\n",
		);
		assert.equal(
			f
				.transport()
				.filter((argv) => argv.at(-1).includes("make apps-start ARGS=--build"))
				.length,
			2,
		);
		assert.equal(
			f.transport().filter((argv) => argv.includes("--detach")).length,
			failure === "fail-watch" ? 2 : 1,
		);
	});

test("awake pending preview reconciles development despite a healthy readiness probe", async (t) => {
	const f = await pendingDevelopmentCheckout(t);
	const generated = await f.generate();
	assert.equal(generated.status, 0, generated.output);
	flag(f, "fail-apps");
	const incomplete = await f.run("boat-preview").done;
	assert.notEqual(incomplete.status, 0);
	assert.equal(f.json(".boat/state.json").reconciliationPending, true);
	fs.unlinkSync(path.join(f.control, "fail-apps"));
	const preview = await f.run("boat-preview").done;
	assert.notEqual(preview.status, 0);
	assert.match(preview.output, /fixture ends preview at readiness/);
	assert.equal(f.json(".boat/state.json").reconciliationPending, undefined);
	assert.equal(f.json(".boat/state.json").watcher, 557);
	const calls = f.transport();
	assert.ok(calls.some((argv) => argv.includes("--detach")));
	assert.ok(calls.some((argv) => argv.at(-1).includes("ARGS=--once")));
	assert.equal(
		calls.filter((argv) =>
			argv.at(-1).includes("make apps-start ARGS=--no-build"),
		).length,
		2,
	);
});

for (const [targets, failure, pending] of [
	[["apps-stop"], false, undefined],
	[["apps-stop", "SERVICE=web"], false, true],
	[["apps-stop"], true, true],
])
	test(`awake pending unwanted development follows cleanup semantics for ${targets.join(" ")} with failure=${failure}`, async (t) => {
		const f = await pendingDevelopmentCheckout(t);
		const generated = await f.generate();
		assert.equal(generated.status, 0, generated.output);
		f.local(
			".boat/state.json",
			JSON.stringify({
				...f.json(".boat/state.json"),
				developmentWanted: false,
			}),
		);
		if (failure) flag(f, "fail-cleanup");
		const result = await f.run(...targets).done;
		assert.equal(result.status === 0, !failure, result.output);
		assert.equal(f.json(".boat/state.json").developmentWanted, false);
		assert.equal(f.json(".boat/state.json").reconciliationPending, pending);
		assert.equal(
			f
				.transport()
				.some((argv) =>
					argv.at(-1).includes("make apps-start ARGS=--no-build"),
				),
			false,
		);
	});

for (const phase of ["sync", "", "collect"])
	test(`source synchronization and a second generator wait through ${phase || "generation"} and acceptance`, async (t) => {
		const f = await pausedGeneration(t, phase);
		f.local("notes.txt", "concurrent unrelated edit\n");
		f.daemon();
		const second = f.generate();
		await observed(
			() =>
				fs
					.readdirSync(path.join(f.root, ".boat"))
					.filter((name) => /^command-\d+\.json$/.test(name)).length === 2,
			"overlapping command leases",
		);
		f.release();
		const firstResult = await f.pending;
		const secondResult = await second;
		assert.equal(firstResult.status, 0, firstResult.output);
		assert.equal(secondResult.status, 0, secondResult.output);
		const starts = fs
			.readFileSync(path.join(f.control, "old-locks"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(starts.length, 2);
		assert.equal(starts[0], "stale lock\n");
		assert.equal(
			starts[1],
			fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8"),
		);
		await observed(
			() =>
				fs.readFileSync(path.join(f.worker, "notes.txt"), "utf8") ===
				"concurrent unrelated edit\n",
			"pending source delivered",
		);
	});

for (const entry of ["generator", "validation", "preview"])
	test(`DIRTY snapshot blocks ${entry} before paid resume or remote effects`, async (t) => {
		const f = await developmentCheckout(t);
		flag(f, "sleep");
		const state = f.json(".boat/state.json");
		state.runningSince = null;
		state.developmentWanted = true;
		state.reconciliationPending = true;
		// A local claim, even with convincing identities, is not provider qualification.
		state.cleanReceipt = {
			worker: state.id,
			project: "wallpaperdb",
			stopId: "stop-old",
			snapshotId: "snapshot-old",
			clean: true,
		};
		f.local(".boat/state.json", JSON.stringify(state));
		fs.rmSync(path.join(f.control, "transport"), { force: true });
		const before = fs.existsSync(path.join(f.control, "docker"))
			? fs.readFileSync(path.join(f.control, "docker"), "utf8")
			: "";
		const result = await (entry === "generator"
			? f.generate()
			: entry === "preview"
				? f.run("boat-preview").done
				: f.run("check", "PACKAGE=user").done);
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /DIRTY.*snapshot/i);
		assert.equal(
			f
				.transport()
				.some(
					(argv) =>
						argv.includes("resume") ||
						argv.includes("new") ||
						argv.includes("ssh") ||
						argv.includes("exec"),
				),
			false,
		);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
		assert.equal(f.json(".boat/state.json").developmentWanted, true);
		assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		assert.equal(
			fs.existsSync(path.join(f.control, "docker"))
				? fs.readFileSync(path.join(f.control, "docker"), "utf8")
				: "",
			before,
		);
	});

for (const evidence of [
	"none",
	"latest",
	"forced",
	"old-snapshot",
	"missing-stop",
	"hook-timeout",
	"changed-worker",
])
	test(`DIRTY snapshot rejects ${evidence} evidence without startup`, async (t) => {
		const f = await lockGenerationCheckout(t);
		const state = f.json(".boat/state.json");
		state.runningSince = null;
		state.cleanReceipt = {
			worker: evidence === "changed-worker" ? "other-worker" : state.id,
			stopId: "stop-old",
			snapshotId: "snapshot-old",
			generation: 2,
			clean: true,
		};
		if (evidence === "none") delete state.cleanReceipt;
		if (evidence === "latest")
			state.cleanReceipt = {
				worker: state.id,
				stopId: "stop-current",
				clean: true,
				snapshot: {
					id: "snapshot-current",
					sandboxId: state.id,
					chainId: "chain-current",
					generation: 3,
					status: "completed",
					kind: "incremental",
					origin: "captured",
					createdAt: "2026-10-31T01:00:00Z",
					completedAt: "2026-10-31T01:00:01Z",
					fileCount: 42,
				},
			};
		if (evidence === "hook-timeout")
			state.cleanReceipt.hook = { status: "timed-out" };
		f.local(".boat/state.json", JSON.stringify(state));
		fs.writeFileSync(
			path.join(f.control, "provider-info"),
			JSON.stringify({
				sandbox: {
					id: state.id,
					state: "archived",
					hydrated: true,
					snapshotAvailable: true,
					snapshotCompletedAt: "2026-10-31T01:00:01Z",
					stop:
						evidence === "missing-stop"
							? null
							: {
									id: "stop-current",
									status: "completed",
									forced: evidence === "forced",
									error: null,
									endedAt: "2026-10-31T01:00:01Z",
								},
				},
			}),
		);
		const result = await f.generate();
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /DIRTY.*snapshot/i);
		const calls = fs.readFileSync(path.join(f.control, "transport"), "utf8");
		assert.doesNotMatch(calls, /"resume"|"new"|"ssh"|"exec"/);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
	});

test("awake startup invalidates a stale receipt before any remote effects and keeps deferred intent on failure", async (t) => {
	const f = await lockGenerationCheckout(t);
	const state = f.json(".boat/state.json");
	state.cleanReceipt = { clean: true, worker: state.id };
	state.snapshotRecovery = {
		status: "CLEAN",
		receipt: { stopId: "old", generation: 1 },
	};
	state.developmentWanted = true;
	state.reconciliationPending = true;
	f.local(".boat/state.json", JSON.stringify(state));
	flag(f, "audit-startup");
	flag(f, "fail");
	const result = await f.generate();
	assert.match(result.output, /Lock generator failed/);
	const snapshots = fs
		.readFileSync(path.join(f.control, "startup-state"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.ok(snapshots.length > 0);
	for (const observed of snapshots) {
		assert.equal(observed.cleanReceipt, undefined);
		assert.equal(observed.snapshotRecovery.receipt, undefined);
		assert.equal(observed.snapshotRecovery.status, "ACTIVE");
	}
	assert.equal(f.json(".boat/state.json").developmentWanted, true);
	assert.equal(f.json(".boat/state.json").reconciliationPending, true);
});

for (const failure of ["fail-retire", "fail-stop", "none"])
	test(`DIRTY stop still stops compute despite ${failure} and blocks subsequent commands`, async (t) => {
		const f = await lockGenerationCheckout(t);
		if (failure !== "none") flag(f, failure);
		const state = f.json(".boat/state.json");
		state.cleanReceipt = { clean: true };
		state.developmentWanted = true;
		state.reconciliationPending = true;
		f.local(".boat/state.json", JSON.stringify(state));
		const result = await f.run("boat-stop").done;
		assert.equal(result.status === 0, failure === "none", result.output);
		assert.equal(
			fs.existsSync(path.join(f.control, "sleep")),
			true,
			"compute stop must still be requested",
		);
		assert.equal(f.json(".boat/state.json").runningSince, null);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
		assert.equal(f.json(".boat/state.json").cleanReceipt, undefined);
		assert.equal(f.json(".boat/state.json").developmentWanted, true);
		assert.equal(f.json(".boat/state.json").reconciliationPending, true);
		const failed = await f.generate();
		assert.match(failed.output, /DIRTY.*snapshot/i);
		const calls = fs
			.readFileSync(path.join(f.control, "transport"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.equal(calls.filter((argv) => argv.includes("stop")).length, 1);
		assert.equal(
			calls.some((argv) => argv.includes("resume") || argv.includes("new")),
			false,
		);
	});

test("already stopped inspection records DIRTY without resuming or remote cleanup", async (t) => {
	const f = await lockGenerationCheckout(t);
	f.local(
		".boat/state.json",
		JSON.stringify({ ...f.json(".boat/state.json"), runningSince: null }),
	);
	flag(f, "sleep");
	const result = await f.run("boat-stop").done;
	assert.equal(result.status, 0, result.output);
	assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
	assert.doesNotMatch(
		fs.readFileSync(path.join(f.control, "transport"), "utf8"),
		/"resume"|"new"|"ssh"|"exec"|"stop"/,
	);
});

for (const failure of [false, true])
	test(`explicit Make cleanup always stops compute and preserves wanted distinction with failure=${failure}`, async (t) => {
		const f = await developmentCheckout(t);
		const started = await f.run("apps-start").done;
		assert.equal(started.status, 0, started.output);
		if (failure) flag(f, "fail-cleanup");
		fs.rmSync(path.join(f.control, "transport"), { force: true });
		const result = await f.run("stop").done;
		assert.equal(result.status === 0, !failure, result.output);
		assert.equal(fs.existsSync(path.join(f.control, "sleep")), true);
		assert.equal(f.json(".boat/state.json").runningSince, null);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
		assert.equal(f.json(".boat/state.json").developmentWanted, failure);
		const calls = f.transport();
		assert.equal(calls.filter((argv) => argv.includes("stop")).length, 1);
		assert.equal(
			calls.filter((argv) =>
				argv.at(-1).includes("make BOAT_EXEC=worker 'stop'"),
			).length,
			1,
		);
	});

for (const caller of ["boat-stop", "stop"])
	for (const provider of ["ready", "stopped"])
		test(`missing timestamp ${caller} inspects ${provider} before deciding cleanup`, async (t) => {
			const f = await developmentCheckout(t);
			f.local(
				".boat/state.json",
				JSON.stringify({
					...f.json(".boat/state.json"),
					runningSince: null,
					developmentWanted: true,
					reconciliationPending: true,
				}),
			);
			if (provider === "stopped") flag(f, "sleep");
			fs.rmSync(path.join(f.control, "transport"), { force: true });
			const result = await f.run(caller).done;
			assert.equal(result.status, 0, result.output);
			const calls = f.transport();
			assert.ok(
				calls.some((argv) => argv.includes("info")),
				"provider inspection must precede success",
			);
			assert.equal(
				calls.filter((argv) => argv.includes("stop")).length,
				provider === "ready" ? 1 : 0,
			);
			assert.equal(
				calls.some((argv) => argv.includes("resume") || argv.includes("new")),
				false,
			);
			assert.equal(fs.existsSync(path.join(f.control, "sleep")), true);
			assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
			assert.equal(
				f.json(".boat/state.json").developmentWanted,
				caller !== "stop",
			);
			assert.equal(
				f.json(".boat/state.json").reconciliationPending,
				caller === "stop" ? undefined : true,
			);
			assert.equal(f.json(".boat/state.json").cleanReceipt, undefined);
			if (caller === "stop" && provider === "stopped")
				assert.match(
					result.output,
					/already stopped.*intent.*physical cleanup.*DIRTY/,
				);
			if (provider === "stopped")
				assert.equal(
					calls.some((argv) => argv.includes("ssh") || argv.includes("exec")),
					false,
				);
			if (caller === "stop" && provider === "ready")
				assert.equal(
					calls.filter((argv) =>
						argv.at(-1).includes("make BOAT_EXEC=worker 'stop'"),
					).length,
					1,
				);
		});

for (const response of ["accepted", "ambiguous"])
	test(`stop accounting waits for observed completion after ${response} request`, async (t) => {
		const f = await lockGenerationCheckout(t);
		const before = f.json(".boat/state.json");
		flag(f, "pause-stop-completion");
		if (response === "ambiguous") flag(f, "fail-stop");
		const pending = f.run("boat-stop");
		await observed(
			() => fs.existsSync(path.join(f.control, "stop-observed")),
			"provider stopping observation",
		);
		assert.equal(f.json(".boat/state.json").runningSince, before.runningSince);
		assert.equal(f.json(".boat/state.json").cost, before.cost);
		assert.equal(fs.existsSync(path.join(f.control, "sleep")), false);
		assert.equal(pending.closed, false);
		flag(f, "release-stop-completion");
		const result = await pending.done;
		assert.equal(result.status === 0, response === "accepted", result.output);
		assert.equal(fs.existsSync(path.join(f.control, "sleep")), true);
		assert.equal(f.json(".boat/state.json").runningSince, null);
		assert.ok(f.json(".boat/state.json").cost > before.cost);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
	});

for (const transition of ["failed-stop-inspection", "incomplete-stop"])
	test(`stop accounting retains obligation after ${transition} and DIRTY blocks a ready worker`, async (t) => {
		const f = await lockGenerationCheckout(t);
		flag(f, transition);
		const before = f.json(".boat/state.json");
		const result = await f.run("boat-stop").done;
		assert.notEqual(result.status, 0, result.output);
		assert.match(
			result.output,
			transition === "incomplete-stop"
				? /Unexpected worker state/
				: /inspection_failed/,
		);
		assert.equal(f.json(".boat/state.json").runningSince, before.runningSince);
		assert.equal(f.json(".boat/state.json").cost, before.cost);
		assert.equal(f.json(".boat/state.json").snapshotRecovery.status, "DIRTY");
		assert.equal(fs.existsSync(path.join(f.control, "sleep")), false);
		fs.rmSync(path.join(f.control, "stopping"));
		fs.rmSync(path.join(f.control, "transport"));
		const denied = await f.generate();
		assert.match(denied.output, /DIRTY.*snapshot/i);
		const calls = fs.existsSync(path.join(f.control, "transport"))
			? fs.readFileSync(path.join(f.control, "transport"), "utf8")
			: "";
		assert.doesNotMatch(calls, /"resume"|"new"|"ssh"|"exec"/);
		assert.equal(f.json(".boat/state.json").runningSince, before.runningSince);
	});

for (const evidence of [
	"not_found",
	"expired",
	"available",
	"invalid-expiry",
	"future-expiry",
	"unknown-info-error",
	"error-state",
	"wrong-worker",
	"contradictory-availability",
	"missing-expiry",
])
	test(`identity inspection reconstructs only proven loss for ${evidence}`, async (t) => {
		const f = await lockGenerationCheckout(t);
		const before = {
			...f.json(".boat/state.json"),
			cost: 0.25,
			runningSince: evidence === "not_found" ? Date.now() - 60000 : null,
			developmentWanted: true,
			reconciliationPending: true,
			cleanReceipt: { clean: true },
			snapshotRecovery: {
				status: "DIRTY",
				workerId: "fake-worker",
				reason: "prior-stop-failed",
			},
		};
		f.local(".boat/state.json", JSON.stringify(before));
		f.local(".boat/prepared.json", JSON.stringify({ dependencies: "stale" }));
		if (evidence === "not_found" || evidence === "unknown-info-error")
			fs.writeFileSync(
				path.join(f.control, "info-error"),
				evidence === "not_found" ? "not_found" : "provider_unavailable",
			);
		else
			fs.writeFileSync(
				path.join(f.control, "provider-info"),
				JSON.stringify({
					sandbox: {
						id: evidence === "wrong-worker" ? "other-worker" : before.id,
						state: evidence === "error-state" ? "error" : "archived",
						dataExpiredAt: ["available", "missing-expiry"].includes(evidence)
							? null
							: evidence === "invalid-expiry"
								? "invalid"
								: evidence === "future-expiry"
									? new Date(Date.now() + 86400000).toISOString()
									: new Date(Date.now() - 60000).toISOString(),
						snapshotAvailable: [
							"available",
							"contradictory-availability",
						].includes(evidence),
					},
				}),
			);
		const result = await f.generate();
		const allowed = ["not_found", "expired"].includes(evidence);
		assert.equal(result.status === 0, allowed, result.output);
		const calls = fs.existsSync(path.join(f.control, "transport"))
			? fs
					.readFileSync(path.join(f.control, "transport"), "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line))
			: [];
		if (allowed)
			assert.equal(
				calls[0].includes("info"),
				true,
				"read-only identity evidence must be consulted",
			);
		assert.equal(
			calls.some((argv) => argv.includes("resume")),
			false,
		);
		const after = f.json(".boat/state.json");
		if (allowed) {
			assert.equal(calls.filter((argv) => argv.includes("new")).length, 1);
			assert.equal(after.id, "fake-new-worker");
			assert.equal(after.developmentWanted, true);
			assert.equal(after.reconciliationPending, true);
			assert.ok(after.cost >= before.cost);
			if (evidence === "not_found") assert.ok(after.cost > before.cost);
			const prior = after.retiredWorkers.at(-1);
			assert.equal(prior.id, before.id);
			assert.equal(prior.runningSince, before.runningSince);
			assert.equal(prior.snapshotRecovery.status, "DIRTY");
			assert.equal(prior.reason, evidence);
			assert.equal(
				fs.existsSync(path.join(f.root, ".boat/prepared.json")),
				false,
			);
			const creation = JSON.parse(
				fs.readFileSync(path.join(f.control, "creation-state")),
			);
			assert.equal(creation.cleanReceipt, undefined);
			assert.notEqual(creation.snapshotRecovery.status, "DIRTY");
			assert.equal(creation.retiredWorkers.at(-1).id, before.id);
		} else {
			assert.equal(after.id, before.id);
			assert.equal(after.cost, before.cost);
			assert.equal(after.runningSince, before.runningSince);
			assert.equal(after.snapshotRecovery.status, "DIRTY");
			assert.equal(
				calls.some(
					(argv) =>
						argv.includes("new") ||
						argv.includes("ssh") ||
						argv.includes("exec") ||
						argv.includes("list"),
				),
				false,
			);
		}
	});

test("known-lost reconstruction preserves identity evidence and cost across failed admission", async (t) => {
	const f = await lockGenerationCheckout(t);
	const before = {
		...f.json(".boat/state.json"),
		cost: 0.25,
		runningSince: Date.now() - 60000,
		snapshotRecovery: { status: "DIRTY", workerId: "fake-worker" },
	};
	f.local(".boat/state.json", JSON.stringify(before));
	fs.writeFileSync(path.join(f.control, "info-error"), "not_found");
	flag(f, "fail-limits");
	const failed = await f.generate();
	assert.match(failed.output, /limits_failed/);
	const pending = f.json(".boat/state.json");
	assert.equal(pending.id, undefined);
	assert.ok(pending.cost > before.cost);
	assert.equal(pending.retiredWorkers.length, 1);
	assert.equal(pending.retiredWorkers[0].id, before.id);
	assert.equal(pending.retiredWorkers[0].snapshotRecovery.status, "DIRTY");
	assert.equal(fs.existsSync(path.join(f.control, "creation-state")), false);
	fs.rmSync(path.join(f.control, "fail-limits"));
	const retried = await f.generate();
	assert.equal(retried.status, 0, retried.output);
	const after = f.json(".boat/state.json");
	assert.equal(after.cost, pending.cost);
	assert.deepEqual(after.retiredWorkers, pending.retiredWorkers);
	assert.equal(after.id, "fake-new-worker");
	const calls = fs
		.readFileSync(path.join(f.control, "transport"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(calls.filter((argv) => argv.includes("new")).length, 1);
	assert.equal(
		calls.some((argv) => argv.includes("resume")),
		false,
	);
});

// Native Drizzle runs without a database, using the descriptor's pinned old
// migrations and a test-only append. Only transport and installation are controlled.
async function migrationGenerationCheckout(t) {
	const f = await lockGenerationCheckout(t);
	const repository = path.resolve(import.meta.dirname, "..");
	const descriptor = JSON.parse(
		fs.readFileSync(path.join(repository, "scripts/boat-workloads/548.json")),
	);
	const names = descriptor.before.migrationSet.map((entry) => entry.path);
	for (const name of [
		...names,
		"apps/asset/package.json",
		"apps/asset/drizzle.config.ts",
		"apps/asset/src/db/schema.ts",
	])
		f.local(name, fs.readFileSync(path.join(repository, name)));
	// Use checked-in inputs so the regression works in shallow checkouts. A
	// test-only native append exercises source return without including a Source
	// capability implementation in the infrastructure change.
	for (const entry of [
		...descriptor.before.migrationSet,
		descriptor.before.schema,
	])
		assert.equal(
			createHash("sha256")
				.update(fs.readFileSync(path.join(f.root, entry.path)))
				.digest("hex"),
			entry.sha256,
		);
	const pkg = f.json("apps/asset/package.json");
	pkg.scripts["dev:configure"] = "true";
	f.local("apps/asset/package.json", JSON.stringify(pkg));
	const schema = fs.readFileSync(
		path.join(f.root, "apps/asset/src/db/schema.ts"),
		"utf8",
	);
	const anchor =
		"export const assetSourceState = pgTable('asset_source_state', {";
	assert.equal(schema.split(anchor).length, 2);
	f.local(
		"apps/asset/src/db/schema.ts",
		schema.replace(
			anchor,
			`${anchor}\n  nextCandidateOrdinal: bigint('next_candidate_ordinal', {mode:'number'}).notNull().default(0),`,
		) +
			"\nexport const sourceCandidates = pgTable('source_candidates', {id: text('id').primaryKey()});\n",
	);
	f.local(
		".gitignore",
		fs.readFileSync(path.join(f.root, ".gitignore"), "utf8") +
			"node_modules/\n",
	);
	const prepared = await f.generate();
	assert.equal(prepared.status, 0, prepared.output);
	fs.symlinkSync(
		path.join(repository, "apps/asset/node_modules"),
		path.join(f.worker, "apps/asset/node_modules"),
	);
	const wrapper = path.join(f.directory, "home/.local/bin/drizzle-kit");
	fs.writeFileSync(
		wrapper,
		`#!${process.execPath}
const fs=require('fs'),path=require('path'),cp=require('child_process');
const control=process.env.FAKE_CONTROL,worker=process.env.FAKE_WORKER;
if(!fs.existsSync(path.join(control,'installed-dependencies')))throw Error('Drizzle requires installed dependencies');
fs.appendFileSync(path.join(control,'migration-starts'),JSON.stringify(JSON.parse(fs.readFileSync('drizzle/meta/_journal.json')))+'\\n');
fs.writeFileSync(path.join(control,'migration-entered'),'yes');
(async()=>{while(fs.existsSync(path.join(control,'migration-pause'))&&!fs.existsSync(path.join(control,'migration-release')))await new Promise(r=>setTimeout(r,10));
const result=cp.spawnSync(process.execPath,[${JSON.stringify(path.join(repository, "apps/asset/node_modules/drizzle-kit/bin.cjs"))},...process.argv.slice(2)],{env:{...process.env,DATABASE_URL:'postgres://unused:unused@127.0.0.1/unused'},stdio:'inherit'});
process.exit(result.status??1);
})();
`,
		{ mode: 0o755 },
	);
	fs.mkdirSync(path.join(f.worker, "node_modules/.bin"), { recursive: true });
	fs.writeFileSync(
		path.join(f.worker, "node_modules/.bin/turbo"),
		"#!/bin/sh\nexit 0\n",
		{ mode: 0o755 },
	);
	return {
		...f,
		migrations: () => f.run("run", "PACKAGE=asset", "SCRIPT=db:generate").done,
	};
}

function migrationBytes(root) {
	const result = {};
	function visit(dir) {
		for (const entry of fs.readdirSync(path.join(root, dir), {
			withFileTypes: true,
		})) {
			const name = path.posix.join(dir, entry.name);
			if (entry.isDirectory()) visit(name);
			else
				result[name] = entry.isSymbolicLink()
					? `link:${fs.readlinkSync(path.join(root, name))}`
					: fs.readFileSync(path.join(root, name), "utf8");
		}
	}
	visit("apps/asset/drizzle");
	return result;
}

test("public migration generation returns native SQL, snapshot and journal as a complete local source set", async (t) => {
	const f = await migrationGenerationCheckout(t);
	const before = migrationBytes(f.root);
	const result = await f.migrations();
	assert.equal(result.status, 0, result.output);
	const remote = migrationBytes(f.worker);
	const journal = JSON.parse(remote["apps/asset/drizzle/meta/_journal.json"]);
	assert.equal(journal.entries.length, 19, result.output);
	const tag = journal.entries.at(-1).tag;
	assert.match(
		remote[`apps/asset/drizzle/${tag}.sql`],
		/CREATE TABLE "source_candidates"/,
	);
	assert.match(
		remote[`apps/asset/drizzle/${tag}.sql`],
		/next_candidate_ordinal/,
	);
	assert.equal(
		f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
		19,
		"public Make completed but generation remained remote-only",
	);
	assert.deepEqual(migrationBytes(f.root), remote);
	for (const [name, bytes] of Object.entries(before))
		if (!name.endsWith("/_journal.json")) assert.equal(remote[name], bytes);
	const again = await f.migrations();
	assert.equal(again.status, 0, again.output);
	assert.match(again.output, /No schema changes/);
	assert.deepEqual(migrationBytes(f.root), remote);
	const next = await f.run("build", "PACKAGE=asset").done;
	assert.equal(next.status, 0, next.output);
	assert.deepEqual(migrationBytes(f.worker), remote);
});

