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
import { stripVTControlCharacters } from "node:util";

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

async function stopLockFixtureChildren(children, drain = false, ownership) {
	const records = new Map();
	const census = () => {
		if (!ownership) return;
		for (const member of fixtureCensus(ownership.directory))
			if (!ownership.excludedGroups.has(member.group))
				records.set(`${member.pid}:${member.startTicks}`, member);
	};
	const stopped = () => {
		census();
		return (
			children.every((p) => p.closed && !processGroupRunning(p.child.pid)) &&
			[...records.values()].every((p) => !processGroupRunning(p.group))
		);
	};
	const exited = async (allowance = 1000) => {
		const deadline = fixtureNow() + allowance;
		while (!stopped()) {
			if (fixtureNow() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		await Promise.all(children.map((p) => p.done));
		return true;
	};
	census();
	// A still-running detached package cannot drain after an early failed test.
	// Retire it immediately so cleanup does not consume the completion watchdog.
	const detached = [...records.values()].some(
		(p) => !children.some((command) => command.child.pid === p.group),
	);
	if (drain && !detached && (await exited()))
		return { drained: true, signal: null };
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		census();
		const groups = new Set();
		for (const member of records.values())
			if (
				!groups.has(member.group) &&
				signalFixtureGroup(member, signal, ownership.directory)
			)
				groups.add(member.group);
		for (const record of children) {
			if (!processGroupRunning(record.child.pid)) continue;
			// Detached fixture groups can outlive their leader. Verify an actual
			// surviving member's cwd/start/group rather than trusting the old PGID.
			for (const member of fixtureCensus(record.directory)) {
				if (
					member.group === record.child.pid &&
					signalFixtureGroup(member, signal, record.directory)
				)
					break;
			}
		}
		// Keep the cleanup second inside the existing five-second fixture bound:
		// give TERM a quarter, reserving the rest for forced retirement and pipes.
		if (await exited(ownership ? (signal === "SIGTERM" ? 250 : 750) : 1000))
			return { drained: false, signal };
	}
	assert.fail("Owned lock fixture process groups did not exit");
}

// Keep raw chunks until observation so split terminal sequences remain contiguous.
function lockFixtureOutput() {
	let tail = "";
	return {
		capture(bytes) {
			tail = (tail + String(bytes)).slice(-16384);
		},
		read() {
			return stripVTControlCharacters(tail).replaceAll("\u001b", "");
		},
	};
}

// hrtime uses the same monotonic clock in the parent and its local child.
const fixtureNow = () => Number(process.hrtime.bigint() / 1_000_000n);
function lockFixtureReadiness({
	deadline = fixtureNow() + 5000,
	report,
	now = fixtureNow,
} = {}) {
	assert.ok(
		Number.isFinite(deadline) && deadline > 0,
		"invalid fixture deadline",
	);
	let phase = "runner startup";
	const check = () => {
		if (now() >= deadline)
			assert.fail(`Readiness deadline exhausted during ${phase}`);
	};
	return {
		deadline,
		enter(name) {
			phase = name;
			if (report)
				fs.appendFileSync(
					`${report}.phases`,
					`${JSON.stringify({ phase, at: now(), deadline })}\n`,
				);
			check();
		},
		async wait(predicate, name) {
			this.enter(name);
			for (;;) {
				check();
				const ready = predicate();
				check();
				if (ready) return;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
	};
}

async function lockGenerationCheckout(
	t,
	{
		readiness = lockFixtureReadiness(),
		directory: ownedDirectory,
		cleanupReport,
		ownPackageGroups = false,
	} = {},
) {
	readiness.enter("checkout setup");
	const directory =
		ownedDirectory ??
		fs.mkdtempSync(path.join(os.tmpdir(), "boat-lock-command-"));
	fs.mkdirSync(directory, { recursive: true });
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
		let commandCleanup;
		let backgroundCleanup;
		const errors = [];
		try {
			commandCleanup = await stopLockFixtureChildren(
				commands,
				true,
				ownPackageGroups
					? {
							directory,
							excludedGroups: new Set(background.map((p) => p.child.pid)),
						}
					: undefined,
			);
		} catch (error) {
			errors.push(error);
		} finally {
			try {
				backgroundCleanup = await stopLockFixtureChildren(background);
			} catch (error) {
				errors.push(error);
			}
		}
		if (cleanupReport)
			fs.writeFileSync(
				`${cleanupReport}.cleanup`,
				JSON.stringify({
					commands: commandCleanup,
					background: backgroundCleanup,
					...(errors.length
						? { errors: errors.map((error) => error.message) }
						: {}),
				}),
			);
		if (errors.length)
			throw new AggregateError(
				errors,
				"Owned lock fixture cleanup failed; preserving fixture files",
			);
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
		"scripts/boat-owners.py",
		"scripts/docker-validation.mjs",
		"scripts/lib/docker-queue.mjs",
		"scripts/lib/boat.mjs",
		"scripts/lib/boat-cache.mjs",
		"scripts/lib/boat-preparation.mjs",
		"scripts/lib/boat-snapshot.mjs",
		"scripts/lib/boat-shutdown.mjs",
		"scripts/lib/boat-source-generation.mjs",
		"scripts/lib/boat-asset-migration.mjs",
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
		FAKE_SOURCE: root,
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
function shutdownHold(phase){
 if(!fs.existsSync(path.join(control,'shutdown-hang-'+phase)))return;
 const text=fs.readFileSync('/proc/'+process.pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');
 fs.writeFileSync(path.join(control,'shutdown-entered-'+phase),JSON.stringify({pid:process.pid,startTicks:fields[19],group:Number(fields[2]),session:Number(fields[3]),state:JSON.parse(fs.readFileSync('.boat/state.json'))}));
 process.on('SIGTERM',()=>{});
 while(!fs.existsSync(path.join(control,'shutdown-release-'+phase)))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
if(fs.existsSync(path.join(control,'shutdown-strict'))&&argv.some(a=>['new','resume','delete','--force'].includes(a)))throw Error('forbidden shutdown effect');
if(argv.includes('info')&&fs.existsSync(path.join(control,'shutdown-pipe-holder'))){
 fs.unlinkSync(path.join(control,'shutdown-pipe-holder'));
 const code="const fs=require('fs'),path=require('path');const text=fs.readFileSync('/proc/'+process.pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');fs.writeFileSync(path.join(process.env.FAKE_CONTROL,'shutdown-entered-pipe'),JSON.stringify({pid:process.pid,startTicks:fields[19],group:Number(fields[2]),session:Number(fields[3]),state:JSON.parse(fs.readFileSync('.boat/state.json'))}));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
 cp.spawn(process.execPath,['-e',code],{stdio:['ignore',1,2]});
 console.log(JSON.stringify({state:'ready'}));process.exit(0);
}
if(argv.includes('info'))shutdownHold(fs.existsSync(path.join(control,'stopping'))?'observation':'initial');
if(argv.includes('ssh')&&argv.at(-1).includes('sudo -n')){shutdownHold('retirement');if(fs.existsSync(path.join(control,'shutdown-output'))){shutdownHold('output');console.log('controlled retirement output');}}
if(argv.includes('usage'))shutdownHold('usage');

if(argv.includes('info')&&!argv.includes('fake-new-worker')){
 if(fs.existsSync(path.join(control,'info-error'))){console.log(JSON.stringify({code:fs.readFileSync(path.join(control,'info-error'),'utf8')}));process.exit(41);}
 if(fs.existsSync(path.join(control,'stopping'))){
  if(fs.existsSync(path.join(control,'shutdown-persistent-stopping'))){console.log(JSON.stringify({sandbox:{id:'fake-worker',state:'stopping'}}));process.exit(0);}
  if(fs.existsSync(path.join(control,'stop-observed'))&&fs.existsSync(path.join(control,'shutdown-observe-stopping'))){fs.unlinkSync(path.join(control,'shutdown-observe-stopping'));console.log(JSON.stringify({state:'stopping'}));process.exit(0);}
  if(!fs.existsSync(path.join(control,'stop-observed'))){fs.writeFileSync(path.join(control,'stop-observed'),'yes');console.log(JSON.stringify({state:'stopping'}));process.exit(0);}
  fs.writeFileSync(path.join(control,'stop-completing'),'yes');
  while(fs.existsSync(path.join(control,'pause-stop-completion'))&&!fs.existsSync(path.join(control,'release-stop-completion')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  if(fs.existsSync(path.join(control,'failed-stop-inspection'))){console.log(JSON.stringify({code:'inspection_failed'}));process.exit(42);}
  if(fs.existsSync(path.join(control,'incomplete-stop'))){console.log(JSON.stringify({state:'ready',stop:{id:'stop-current',status:'failing'}}));process.exit(0);}
  fs.writeFileSync(path.join(control,'sleep'),'yes');fs.unlinkSync(path.join(control,'stopping'));
 }
 console.log(fs.existsSync(path.join(control,'provider-info'))?fs.readFileSync(path.join(control,'provider-info'),'utf8'):JSON.stringify({state:fs.existsSync(path.join(control,'sleep'))?'stopped':'ready'}));process.exit(0);
}
if(argv.includes('stop')){fs.writeFileSync(path.join(control,'shutdown-request-state'),fs.readFileSync('.boat/state.json'));fs.writeFileSync(path.join(control,'stopping'),'yes');shutdownHold('submission');if(fs.existsSync(path.join(control,'fail-stop')))process.exit(32);console.log(JSON.stringify({stop:{id:'stop-current',status:'pending'}}));process.exit(0);}
if(argv.includes('info')&&argv.includes('fake-new-worker')){console.log(JSON.stringify({sandbox:{id:'fake-new-worker',state:'ready'}}));process.exit(0);}
if(argv.includes('list')){console.log(fs.existsSync(path.join(control,'worker-list'))?fs.readFileSync(path.join(control,'worker-list'),'utf8'):JSON.stringify({sandboxes:[]}));process.exit(0);}
if(argv.includes('limits')){if(fs.existsSync(path.join(control,'fail-limits'))){console.log(JSON.stringify({code:'limits_failed'}));process.exit(43);}console.log(JSON.stringify({canStart:true,nextStartDollars:0}));process.exit(0);}
if(argv.includes('new')){fs.writeFileSync(path.join(control,'creation-state'),fs.readFileSync('.boat/state.json'));console.log(JSON.stringify({sandbox:{id:'fake-new-worker'}}));process.exit(0);}
if(argv.includes('usage')){if(fs.existsSync(path.join(control,'fail-usage')))process.exit(43);console.log('{}');process.exit(0);}
if(argv.includes('snapshot')&&argv.includes('latest')){console.log(JSON.stringify({snapshot:{id:'snapshot-current',sandboxId:'fake-worker',chainId:'chain-current',generation:3,status:'completed',kind:'incremental',origin:'captured',createdAt:'2026-10-31T01:00:00Z',completedAt:'2026-10-31T01:00:01Z',fileCount:42}}));process.exit(0);}
if((argv.includes('ssh')||argv.includes('exec'))&&fs.existsSync(path.join(control,'audit-startup')))fs.appendFileSync(path.join(control,'startup-state'),JSON.stringify(JSON.parse(fs.readFileSync('.boat/state.json','utf8')))+'\\n');
if(argv.includes('ssh')&&argv.at(-1).includes('sudo -n')&&fs.existsSync(path.join(control,'fail-retire')))process.exit(31);
if(argv.includes('extend')){console.log('{}');process.exit(0);}
if(argv.includes('resume')){fs.unlinkSync(path.join(control,'sleep'));console.log('{}');process.exit(0);}
const command=argv.at(-1).replaceAll('/home/user/wallpaperdb',process.env.FAKE_WORKER);
if(argv.includes('ssh')&&(command.startsWith('mkdir -p '+process.env.FAKE_WORKER+';')||command.includes('sudo -n')||command.includes('--input-type=module -')))process.exit(0);
if(!argv.includes('ssh')&&!argv.includes('exec'))throw Error('unexpected Boat '+argv);
if(command.includes('base64 -w0')||command.includes('collect-migrations')){
 fs.writeFileSync(path.join(control,'collecting'),'yes');
 if(fs.existsSync(path.join(control,'transfer-fail')))process.exit(31);
 if(fs.existsSync(path.join(control,'framed'))){console.log(JSON.stringify({type:'stdout',data:'invalid framed payload'}));process.exit(0);}
}
const pause=command.includes('tar -xzf -')?'sync':(command.includes('base64 -w0')||command.includes('collect-migrations'))?'collect':null;
if(pause&&fs.existsSync(path.join(control,'pause-'+pause))){fs.writeFileSync(path.join(control,'entered-'+pause),'yes');while(!fs.existsSync(path.join(control,'release-'+pause))||fs.existsSync(path.join(control,'ignore-release')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
const stream=argv.includes('--stream');
if(stream&&!fs.existsSync(path.join(control,'missing-started')))console.log(JSON.stringify({type:'started',commandId:'cmd_fixture'+process.pid}));
if(stream&&fs.existsSync(path.join(control,'stream-loss'))){fs.writeFileSync(path.join(control,'writer-active'),'yes');process.exit(71);}
const child=cp.spawn('bash',['-c',command],{env:process.env,stdio:['pipe',stream?'pipe':'inherit',stream?'pipe':'inherit']});
process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});
if(stream)for(const type of ['stdout','stderr'])child[type].on('data',b=>console.log(JSON.stringify({type,data:b.toString()})));
child.on('close',code=>{
 if(stream&&!fs.existsSync(path.join(control,'missing-terminal')))console.log(JSON.stringify({type:'exit',exitCode:code??1,finishedAt:new Date().toISOString(),launcherFailed:fs.existsSync(path.join(control,'launcher-failed')),timedOut:false,oomKilled:false,signal:null,success:code===0}));
 process.exit(code??1);
});
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
		const output = lockFixtureOutput();
		const capture = output.capture;
		child.stdout.on("data", capture);
		child.stderr.on("data", capture);
		child.on("error", (error) => capture(error.message));
		const record = {
			directory,
			child,
			closed: false,
			terminal: null,
			output: output.read,
		};
		child.on("exit", (status, signal) => {
			record.terminal = { status, signal };
		});
		child.on("error", () => {
			record.terminal = { status: null, signal: null };
		});
		record.done = new Promise((resolve) => {
			child.on("close", (status, signal) => {
				record.closed = true;
				resolve({ status, signal, output: output.read() });
			});
		});
		owned.push(record);
		return record;
	};
	readiness.enter("keeper startup");
	const keeperRecord = start(background, process.execPath, [
		"-e",
		"console.log('ready');setInterval(()=>{},1000)",
	]);
	const keeper = keeperRecord.child;
	await readiness.wait(() => {
		if (keeperRecord.terminal)
			assert.fail(`Keeper exited before readiness: ${keeperRecord.output()}`);
		return keeperRecord.output().includes("ready");
	}, "keeper readiness");
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
	const tunnelRecord = start(background, process.execPath, [
		"-e",
		"console.log('tunnel ready');setInterval(()=>{},1000)",
	]);
	await readiness.wait(
		() => tunnelRecord.output().includes("tunnel ready"),
		"fixture tunnel readiness",
	);
	save(".boat/cache-tunnel.json", {
		...worktreeProcesses(root).find((p) => p.pid === tunnelRecord.child.pid),
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
		commands,
		readiness,
		run,
		shutdownTunnel: () =>
			start(background, "python", ["scripts/shutdown-tunnel.py"]),
		writer: () =>
			start(background, process.execPath, [
				"-e",
				`const fs=require('fs'),path=require('path'),control=process.env.FAKE_CONTROL;fs.writeFileSync(path.join(control,'writer-entered'),'yes');const tick=()=>{if(fs.existsSync(path.join(control,'writer-active'))){fs.writeFileSync(path.join(process.env.FAKE_WORKER,'apps/asset/drizzle/9999_live_writer.sql'),'remote writer still owns outputs');fs.writeFileSync(path.join(control,'writer-mutated'),'yes');}if(fs.existsSync(path.join(control,'writer-release')))process.exit(0);};tick();setInterval(tick,10);`,
			]),
		daemon: () =>
			start(background, process.execPath, ["scripts/boat.mjs", "daemon"]),
		generate: () =>
			run("run", "PACKAGE=scripts", "SCRIPT=dependencies:lock").done,
	};
}

async function assetExecutionCheckout(t, options) {
	const f = await lockGenerationCheckout(t, {
		...options,
		ownPackageGroups: true,
	});
	f.env.COMPOSE_PROJECT_NAME = "wallpaperdb";
	f.env.FAKE_CONTAINER_PROJECT = "wallpaperdb";
	f.env.FAKE_CONTAINER_SERVICE = "asset";
	f.env.FAKE_NATIVE_COMPOSE = execFileSync(
		"mise",
		["which", "docker-compose"],
		{ encoding: "utf8" },
	).trim();
	f.env.DOCKER_HOST = `unix://${f.directory}/no-daemon.sock`;
	f.env.DOCKER_CONFIG = path.join(f.directory, "empty-docker-config");
	fs.mkdirSync(f.env.DOCKER_CONFIG);
	f.local(
		"infra/docker-compose.apps.yml",
		fs.readFileSync(
			path.resolve(import.meta.dirname, "../infra/docker-compose.apps.yml"),
		),
	);
	f.local(
		".gitignore",
		fs.readFileSync(path.join(f.root, ".gitignore"), "utf8") +
			"node_modules/\n",
	);
	fs.mkdirSync(path.join(f.root, "scripts/node_modules"), { recursive: true });
	fs.symlinkSync(
		path.resolve(import.meta.dirname, "node_modules/typescript"),
		path.join(f.root, "scripts/node_modules/typescript"),
	);
	f.local(
		"apps/asset/package.json",
		JSON.stringify({
			scripts: {
				"dev:configure": "true",
				"db:migrate": "fixture-sql && tsx scripts/backfill.ts",
			},
		}),
	);
	f.local(
		"apps/asset/drizzle.config.ts",
		"export default { dialect: 'postgresql' };\n",
	);
	f.local(
		"apps/asset/scripts/backfill.ts",
		"import { value } from '../src/backfill-input.ts';\n// intended backfill\n",
	);
	f.local(
		"apps/asset/src/backfill-input.ts",
		"export const value = 'current';\n",
	);
	f.local(
		"apps/asset/drizzle/0000_first.sql",
		"CREATE TABLE fixture(id int);\n",
	);
	f.local("apps/asset/drizzle/meta/0000_snapshot.json", '{"id":"first"}\n');
	f.local(
		"apps/asset/drizzle/meta/_journal.json",
		JSON.stringify({ entries: [{ idx: 0, tag: "0000_first" }] }),
	);
	const prepared = await f.generate();
	assert.equal(prepared.status, 0, prepared.output);
	const runtime = path.join(f.directory, "runtime");
	fs.cpSync(f.worker, runtime, { recursive: true });
	fs.writeFileSync(
		path.join(runtime, ".pnpm-lockfile-hash"),
		createHash("sha256")
			.update(fs.readFileSync(path.join(f.root, "pnpm-lock.yaml")))
			.digest("hex") + "\n",
	);
	const bin = path.join(f.directory, "home/.local/bin");
	const put = (name, code) => {
		fs.mkdirSync(path.dirname(name), { recursive: true });
		fs.writeFileSync(name, code, { mode: 0o755 });
	};
	const clock = path.join(f.directory, "clock.mjs");
	put(
		clock,
		`import fs from 'node:fs';import path from 'node:path';const now=Date.now;Date.now=()=>now()+(fs.existsSync(path.join(process.env.FAKE_CONTROL,'expire'))?20001:0);`,
	);
	const pnpm = path.join(bin, "pnpm");
	put(path.join(bin, "tsx"), '#!/bin/sh\nexec fixture-backfill "$@"\n');
	fs.renameSync(pnpm, pnpm + "-install");
	put(
		pnpm,
		`#!${process.execPath}
const cp=require('child_process'),fs=require('fs');
if(process.argv[2]!=='run')process.exit(cp.spawnSync(${JSON.stringify(pnpm + "-install")},process.argv.slice(2),{stdio:'inherit',env:process.env}).status??1);
const script=JSON.parse(fs.readFileSync('package.json')).scripts[process.argv[3]];
process.exit(cp.spawnSync(script,{shell:true,stdio:'inherit',env:process.env}).status??1);
`,
	);
	for (const phase of ["sql", "backfill"])
		put(
			path.join(bin, "fixture-" + phase),
			`#!${process.execPath}
const fs=require('fs'),path=require('path'),c=process.env.FAKE_CONTROL;
fs.appendFileSync(path.join(c,'effects'),JSON.stringify({phase:${JSON.stringify(phase)},cwd:process.cwd(),url:process.env.DATABASE_URL})+'\\n');
if(${JSON.stringify(phase)}==='sql'&&fs.existsSync(path.join(c,'hold-sql'))){fs.writeFileSync(path.join(c,'sql-pid'),String(process.pid));while(true)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
if(process.env.DATABASE_URL==='docker-only'&&process.cwd()!==${JSON.stringify(path.join(runtime, "apps/asset"))}){console.error('getaddrinfo ENOTFOUND postgres');process.exit(19);}
process.exit(fs.existsSync(path.join(c,${JSON.stringify("fail-" + phase)}))?23:0);
`,
		);
	const turbo = `#!${process.execPath}
const cp=require('child_process'),path=require('path'),fs=require('fs');
fs.appendFileSync(path.join(process.env.FAKE_CONTROL,'host-invocations'),JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n');
process.exit(cp.spawnSync('pnpm',['run','db:migrate'],{cwd:path.join(process.cwd(),'apps/asset'),env:process.env,stdio:'inherit'}).status??1);
`;
	for (const root of [f.root, f.worker])
		put(path.join(root, "node_modules/.bin/turbo"), turbo);
	put(
		path.join(bin, "docker"),
		`#!${process.execPath}
const fs=require('fs'),path=require('path'),cp=require('child_process'),a=process.argv.slice(2),c=process.env.FAKE_CONTROL;
fs.appendFileSync(path.join(c,'docker'),JSON.stringify(a)+'\\n');
const context=a[0]==='--context'?a.splice(0,2)[1]:undefined;
if(process.env.FAKE_DOCKER_CONTEXT&&context!==process.env.FAKE_DOCKER_CONTEXT)throw Error('Docker context lost');
if(a[0]==='compose'&&a.includes('config')){const r=cp.spawnSync(process.env.FAKE_NATIVE_COMPOSE,a.slice(1),{encoding:'utf8',env:process.env});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1);}
if(a[0]==='compose'&&a.includes('ps')){if(!fs.existsSync(path.join(c,'missing')))console.log('asset-instance-one');process.exit(0);}
if(a[0]==='inspect'){console.log(JSON.stringify([{Id:'asset-instance-one',State:{Running:!fs.existsSync(path.join(c,'exited'))},Config:{Labels:{'com.docker.compose.project': process.env.FAKE_CONTAINER_PROJECT,'com.docker.compose.service':process.env.FAKE_CONTAINER_SERVICE}}}]));process.exit(0);}
if(a[0]!=='exec'||!a.includes('asset-instance-one'))throw Error('unexpected docker '+a);
if(fs.existsSync(path.join(c,'replaced'))){console.error('container asset-instance-one no longer running');process.exit(1);}
const runtimeEnv={...process.env,DATABASE_URL:'runtime-inherited'},containerAt=a.indexOf('asset-instance-one');
for(let i=1;i<containerAt;i++){let value;if(a[i]==='-e'||a[i]==='--env')value=a[++i];else if(a[i].startsWith('--env='))value=a[i].slice(6);else if(a[i].startsWith('-e'))value=a[i].slice(2);else continue;const equal=value.indexOf('='),key=equal<0?value:value.slice(0,equal);if(equal<0){if(Object.hasOwn(process.env,key))runtimeEnv[key]=process.env[key];else delete runtimeEnv[key];}else runtimeEnv[key]=value.slice(equal+1);}
const n=a.indexOf('node');const child=cp.spawn(process.execPath,['--import',${JSON.stringify(clock)},...a.slice(n+1)],{cwd:${JSON.stringify(path.join(runtime, "apps/asset"))},env:runtimeEnv,stdio:['pipe','pipe','inherit']});process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});child.stdout.on('data',b=>{fs.appendFileSync(path.join(c,'runtime-output'),b);if(b.toString().includes('asset-migration ready')&&fs.existsSync(path.join(c,'replace-on-ready'))){fs.writeFileSync(path.join(c,'replaced'),'yes');child.kill('SIGTERM');}process.stdout.write(b);});child.on('close',code=>process.exit(code??1));
`,
	);
	f.env.DATABASE_URL = "docker-only";
	return {
		...f,
		runtime,
		effects: () =>
			fs.existsSync(path.join(f.control, "effects"))
				? fs
						.readFileSync(path.join(f.control, "effects"), "utf8")
						.trim()
						.split("\n")
						.map(JSON.parse)
				: [],
	};
}

test("canonical Asset migration uses its running container while the original valid host caller still works", async (t) => {
	const f = await assetExecutionCheckout(t);
	f.env.DATABASE_URL = "valid-host";
	const host = await f.run("migrate", "PACKAGE=asset", "BOAT_EXEC=local").done;
	assert.equal(host.status, 0, host.output);
	assert.equal(f.effects()[0].cwd, path.join(f.root, "apps/asset"));
	f.env.DATABASE_URL = "docker-only";
	const remote = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(remote.status, 0, remote.output);
	assert.deepEqual(
		f
			.effects()
			.slice(2)
			.map((e) => [e.phase, e.cwd, e.url]),
		["sql", "backfill"].map((phase) => [
			phase,
			path.join(f.runtime, "apps/asset"),
			"runtime-inherited",
		]),
	);
});

async function migrationObserved(f, text) {
	const file = path.join(f.control, "runtime-output");
	const deadline = Date.now() + 4000;
	while (Date.now() < deadline) {
		if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text))
			return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.fail(`Runtime did not report ${text}`);
}

test("Asset migration awaits complete runtime delivery without database effects, then runs once and can repeat unchanged", async (t) => {
	const f = await assetExecutionCheckout(t);
	const names = [
		"drizzle/0000_first.sql",
		"drizzle/meta/0000_snapshot.json",
		"drizzle/meta/_journal.json",
		"scripts/backfill.ts",
		"package.json",
	];
	for (const name of names)
		fs.writeFileSync(path.join(f.runtime, "apps/asset", name), "old delivery");
	const running = f.run("migrate", "PACKAGE=asset");
	await migrationObserved(f, "asset-migration waiting");
	assert.deepEqual(f.effects(), []);
	for (const name of names)
		fs.copyFileSync(
			path.join(f.root, "apps/asset", name),
			path.join(f.runtime, "apps/asset", name),
		);
	const result = await running.done;
	assert.equal(result.status, 0, result.output);
	assert.equal(f.effects().length, 2);
	const repeat = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(repeat.status, 0, repeat.output);
	assert.deepEqual(
		f.effects().map((e) => e.phase),
		["sql", "backfill", "sql", "backfill"],
	);
	const docker = fs
		.readFileSync(path.join(f.control, "docker"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(docker.filter((a) => a[0] === "exec").length, 2);
	assert(
		docker.every(
			(a) => !a.some((v) => ["up", "restart", "start", "cp"].includes(v)),
		),
	);
});

for (const [name, relative, value, guard] of [
	[
		"journal",
		"apps/asset/drizzle/meta/_journal.json",
		"old journal",
		"hash:apps/asset/drizzle/meta/_journal.json",
	],
	[
		"SQL",
		"apps/asset/drizzle/0000_first.sql",
		"old SQL",
		"hash:apps/asset/drizzle/0000_first.sql",
	],
	[
		"snapshot",
		"apps/asset/drizzle/meta/0000_snapshot.json",
		"old snapshot",
		"hash:apps/asset/drizzle/meta/0000_snapshot.json",
	],
	[
		"backfill",
		"apps/asset/scripts/backfill.ts",
		"old backfill",
		"hash:apps/asset/scripts/backfill.ts",
	],
	[
		"backfill dependency",
		"apps/asset/src/backfill-input.ts",
		"old dependency",
		"hash:apps/asset/src/backfill-input.ts",
	],
	[
		"package command",
		"apps/asset/package.json",
		'{"scripts":{"db:migrate":"fixture-sql"}}',
		"hash:apps/asset/package.json",
	],
	[
		"config",
		"apps/asset/drizzle.config.ts",
		"old config",
		"hash:apps/asset/drizzle.config.ts",
	],
	["lock bytes", "pnpm-lock.yaml", "old lock", "hash:pnpm-lock.yaml"],
	[
		"installed lock",
		".pnpm-lockfile-hash",
		"old installed lock",
		"installed-lock",
	],
	[
		"extra migration member",
		"apps/asset/drizzle/9999_extra.sql",
		"extra",
		"membership:apps/asset/drizzle",
	],
	[
		"missing SQL",
		"apps/asset/drizzle/0000_first.sql",
		null,
		"membership:apps/asset/drizzle",
	],
	[
		"missing snapshot",
		"apps/asset/drizzle/meta/0000_snapshot.json",
		null,
		"membership:apps/asset/drizzle",
	],
	[
		"missing backfill",
		"apps/asset/scripts/backfill.ts",
		null,
		"membership:apps/asset/scripts",
	],
])
	test(`Asset migration independently rejects stale ${name} and accepts its matching neighbor`, async (t) => {
		const f = await assetExecutionCheckout(t);
		const file = path.join(f.runtime, relative),
			original = fs.existsSync(file) ? fs.readFileSync(file) : null;
		if (value === null) fs.unlinkSync(file);
		else fs.writeFileSync(file, value);
		const running = f.run("migrate", "PACKAGE=asset");
		await migrationObserved(f, guard);
		assert.deepEqual(f.effects(), []);
		fs.writeFileSync(path.join(f.control, "expire"), "yes");
		const rejected = await running.done;
		assert.notEqual(rejected.status, 0, rejected.output);
		assert.match(rejected.output, /deadline exhausted/);
		assert.deepEqual(f.effects(), []);
		fs.unlinkSync(path.join(f.control, "expire"));
		if (original) fs.writeFileSync(file, original);
		else fs.unlinkSync(file);
		const valid = await f.run("migrate", "PACKAGE=asset").done;
		assert.equal(valid.status, 0, valid.output);
		assert.equal(f.effects().length, 2);
	});

for (const state of ["missing", "exited", "replaced"])
	test(`Asset migration rejects ${state} instance without fallback`, async (t) => {
		const f = await assetExecutionCheckout(t);
		fs.writeFileSync(path.join(f.control, state), "yes");
		const result = await f.run("migrate", "PACKAGE=asset").done;
		assert.notEqual(result.status, 0, result.output);
		assert.deepEqual(f.effects(), []);
		const calls = fs
			.readFileSync(path.join(f.control, "docker"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert(calls.every((a) => ["compose", "inspect", "exec"].includes(a[0])));
		assert.equal(
			calls.filter((a) => a[0] === "exec").length,
			state === "replaced" ? 1 : 0,
		);
	});

for (const phase of ["sql", "backfill"])
	test(`Asset migration retains ${phase} failure and does not rerun`, async (t) => {
		const f = await assetExecutionCheckout(t);
		fs.writeFileSync(path.join(f.control, "fail-" + phase), "yes");
		const result = await f.run("migrate", "PACKAGE=asset").done;
		assert.notEqual(result.status, 0, result.output);
		assert.deepEqual(
			f.effects().map((e) => e.phase),
			phase === "sql" ? ["sql"] : ["sql", "backfill"],
		);
		assert.match(result.output, /exit 23/);
		assert(
			fs
				.readdirSync(path.join(f.root, ".boat"))
				.some((name) => /^command-.*\.log$/.test(name)),
		);
	});

test("Asset migration unknown terminal status blocks another side-effecting submission", async (t) => {
	const f = await assetExecutionCheckout(t);
	fs.writeFileSync(path.join(f.control, "missing-terminal"), "yes");
	const first = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(first.status, 0, first.output);
	assert.match(first.output, /terminal status uncertain/);
	assert.equal(f.effects().length, 2);
	fs.unlinkSync(path.join(f.control, "missing-terminal"));
	const second = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(second.status, 0, second.output);
	assert.match(
		second.output,
		/Previous Asset migration terminal status uncertain/,
	);
	assert.equal(f.effects().length, 2);
});

test("Asset migration preserves a superseding source edit and a new coherent invocation succeeds", async (t) => {
	const f = await assetExecutionCheckout(t);
	const name = "apps/asset/scripts/backfill.ts";
	fs.writeFileSync(path.join(f.runtime, name), "old delivery");
	const running = f.run("migrate", "PACKAGE=asset");
	await migrationObserved(f, "hash:" + name);
	const accepted = fs.readFileSync(path.join(f.root, name));
	f.local(name, "// newer edit retained\n");
	fs.writeFileSync(path.join(f.runtime, name), accepted);
	await migrationObserved(f, "asset-migration ready");
	fs.writeFileSync(path.join(f.control, "expire"), "yes");
	const result = await running.done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /source superseded/);
	assert.deepEqual(f.effects(), []);
	assert.equal(
		fs.readFileSync(path.join(f.root, name), "utf8"),
		"// newer edit retained\n",
	);
	fs.unlinkSync(path.join(f.control, "expire"));
	fs.copyFileSync(path.join(f.root, name), path.join(f.runtime, name));
	const next = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(next.status, 0, next.output);
});

test("Asset migration cannot use a verified receipt after that running instance is replaced", async (t) => {
	const f = await assetExecutionCheckout(t);
	fs.writeFileSync(path.join(f.control, "replace-on-ready"), "yes");
	const result = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /asset-migration verified/);
	assert.deepEqual(f.effects(), []);
	const calls = fs
		.readFileSync(path.join(f.control, "docker"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(calls.filter((a) => a[0] === "exec").length, 1);
	assert.equal(
		calls.filter((a) => a[0] === "compose" && a.includes("ps")).length,
		1,
	);
});

for (const [name, selectors, mode, unenrolled] of [
	["local", ["migrate", "PACKAGE=asset", "BOAT_EXEC=local"]],
	["worker", ["migrate", "PACKAGE=asset", "BOAT_EXEC=worker"]],
	["unenrolled", ["migrate", "PACKAGE=asset"], "development", true],
	[
		"validation forced remote",
		["migrate", "PACKAGE=asset", "BOAT_EXEC=remote"],
		"validation",
	],
	["validation default", ["migrate", "PACKAGE=asset"], "validation"],
	["direct run", ["run", "PACKAGE=asset", "SCRIPT=db:migrate"]],
	["other package", ["migrate", "PACKAGE=user"]],
	["all packages", ["migrate"]],
	["duplicate selects other", ["migrate", "PACKAGE=asset", "PACKAGE=user"]],
])
	test(`Asset migration retains the original ${name} caller`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.DATABASE_URL = "valid-host";
		if (mode)
			f.local(
				".boat/enrollment.json",
				JSON.stringify({ ...f.json(".boat/enrollment.json"), mode }),
			);
		if (unenrolled) fs.unlinkSync(path.join(f.root, ".boat/enrollment.json"));
		const result = await f.run(...selectors).done;
		assert.equal(result.status, 0, result.output);
		assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
		assert.equal(f.effects().length, 2);
		assert(
			f
				.effects()
				.every(
					(e) =>
						e.url === "valid-host" &&
						e.cwd !== path.join(f.runtime, "apps/asset"),
				),
		);
		if (selectors.includes("PACKAGE=user")) {
			const host = fs.readFileSync(
				path.join(f.control, "host-invocations"),
				"utf8",
			);
			assert.match(host, /--filter=@wallpaperdb\/user/);
		}
	});

for (const [selectors, ownedProject] of [
	[["PACKAGE=user", "PACKAGE=asset"], "wallpaperdb"],
	[["PACKAGE=asset", "BOAT_EXEC=remote"], "wallpaperdb"],
	[
		[
			"PACKAGE=asset",
			"COMPOSE_PROJECT_NAME=owned-control",
			"APPS_COMPOSE=docker compose -p owned-control -f infra/docker-compose.apps.yml --ansi never",
		],
		"owned-control",
	],
	[
		[
			"PACKAGE=asset",
			"APPS_COMPOSE=docker compose -f infra/docker-compose.apps.yml",
		],
		"wallpaperdb",
	],
	[
		[
			"PACKAGE=asset",
			"APPS_COMPOSE=docker compose --project-name wallpaperdb -f infra/docker-compose.apps.yml",
		],
		"wallpaperdb",
	],
	[
		[
			"PACKAGE=asset",
			"APPS_COMPOSE=docker --context controlled compose -p wallpaperdb -f infra/docker-compose.apps.yml",
		],
		"wallpaperdb",
	],
])
	test(`Asset migration preserves Make expansion for ${selectors.join(" ")}`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.FAKE_CONTAINER_PROJECT = ownedProject;
		if (selectors.some((value) => value.includes("--context controlled")))
			f.env.FAKE_DOCKER_CONTEXT = "controlled";
		const result = await f.run("migrate", ...selectors).done;
		assert.equal(result.status, 0, result.output);
		assert.equal(f.effects().length, 2);
		assert(
			f.effects().every((e) => e.cwd === path.join(f.runtime, "apps/asset")),
		);
	});

test("Asset migration honors a Make override assignment and original invalid-selector rejection", async (t) => {
	const f = await assetExecutionCheckout(t);
	f.env.DATABASE_URL = "valid-host";
	f.local(".worktree", "INGRESS_PORT=9120\noverride PACKAGE := asset\n");
	const original = await f.run("migrate", "PACKAGE=user").done;
	assert.equal(original.status, 0, original.output);
	assert.equal(f.effects()[0].cwd, path.join(f.runtime, "apps/asset"));
	f.local(".worktree", "INGRESS_PORT=9120\n");
	const invalid = await f.run("migrate", "PACKAGE=unknown").done;
	assert.notEqual(invalid.status, 0, invalid.output);
	assert.match(invalid.output, /Unknown PACKAGE/);
	assert.equal(f.effects().length, 2);
});

for (const shape of ["file symlink", "directory symlink", "nonregular file"])
	test(`Asset migration rejects runtime ${shape} even when target bytes match`, async (t) => {
		const f = await assetExecutionCheckout(t);
		const file = path.join(f.runtime, "apps/asset/drizzle/0000_first.sql");
		if (shape === "file symlink") {
			const outside = path.join(f.directory, "outside.sql");
			fs.copyFileSync(file, outside);
			fs.unlinkSync(file);
			fs.symlinkSync(outside, file);
		} else if (shape === "directory symlink") {
			const directory = path.join(f.runtime, "apps/asset/drizzle/meta"),
				outside = path.join(f.directory, "outside-meta");
			fs.renameSync(directory, outside);
			fs.symlinkSync(outside, directory);
		} else {
			fs.unlinkSync(file);
			fs.mkdirSync(file);
		}
		const running = f.run("migrate", "PACKAGE=asset");
		await migrationObserved(f, "asset-migration waiting");
		assert.deepEqual(f.effects(), []);
		fs.writeFileSync(path.join(f.control, "expire"), "yes");
		const rejected = await running.done;
		assert.notEqual(rejected.status, 0, rejected.output);
		assert.deepEqual(f.effects(), []);
	});

for (const [artifact, stale, expectedPhases] of [
	[
		"apps/asset/package.json",
		'{"scripts":{"db:migrate":"fixture-sql"}}',
		["sql"],
	],
	[
		"apps/asset/scripts/backfill.ts",
		"// stale backfill\n",
		["sql", "backfill"],
	],
])
	test(`Asset migration guard sensitivity for ${artifact} excludes an earlier rejection`, async (t) => {
		const f = await assetExecutionCheckout(t);
		const helper = "scripts/lib/boat-asset-migration.mjs";
		const source = fs.readFileSync(path.join(f.root, helper), "utf8");
		const guard = "if (hash(regular(root, name)) !== digest)";
		assert.equal(source.split(guard).length, 2);
		f.local(
			helper,
			source.replace(
				guard,
				`if (name !== ${JSON.stringify(artifact)} && hash(regular(root, name)) !== digest)`,
			),
		);
		fs.writeFileSync(path.join(f.runtime, artifact), stale);
		const mutant = await f.run("migrate", "PACKAGE=asset").done;
		assert.equal(mutant.status, 0, mutant.output);
		assert.deepEqual(
			f.effects().map((e) => e.phase),
			expectedPhases,
		);
		assert.doesNotMatch(mutant.output, /asset-migration waiting/);
	});

test("Asset migration failure-propagation sensitivity exposes a false success", async (t) => {
	const f = await assetExecutionCheckout(t);
	const helper = "scripts/lib/boat-asset-migration.mjs";
	const source = fs.readFileSync(path.join(f.root, helper), "utf8");
	const verdict = "resolve(expired ? 1 : (exitCode ?? 1));";
	assert.equal(source.split(verdict).length, 2);
	f.local(helper, source.replace(verdict, "resolve(0);"));
	fs.writeFileSync(path.join(f.control, "fail-sql"), "yes");
	const mutant = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(mutant.status, 0, mutant.output);
	assert.deepEqual(
		f.effects().map((e) => e.phase),
		["sql"],
	);
});

test("Asset migration detects source drift during authoritative flush without changing the edit", async (t) => {
	const f = await assetExecutionCheckout(t);
	f.local("notes.txt", "force a source flush\n");
	fs.writeFileSync(path.join(f.control, "pause-sync"), "yes");
	const running = f.run("migrate", "PACKAGE=asset");
	await observed(() => fs.existsSync(path.join(f.control, "entered-sync")));
	f.local("apps/asset/scripts/backfill.ts", "// edit made during flush\n");
	fs.writeFileSync(path.join(f.control, "release-sync"), "yes");
	const rejected = await running.done;
	assert.notEqual(rejected.status, 0, rejected.output);
	assert.match(rejected.output, /source changed during authoritative flush/);
	assert.equal(
		fs.readFileSync(
			path.join(f.root, "apps/asset/scripts/backfill.ts"),
			"utf8",
		),
		"// edit made during flush\n",
	);
	assert.deepEqual(f.effects(), []);
	assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
});

for (const state of ["ready", "stopped"])
	test(`Asset migration retains available DIRTY ${state} refusal before work`, async (t) => {
		const f = await assetExecutionCheckout(t);
		const prior = f.json(".boat/state.json");
		f.local(
			".boat/state.json",
			JSON.stringify({
				...prior,
				snapshotRecovery: { status: "DIRTY", workerId: "fake-worker" },
			}),
		);
		if (state === "stopped")
			fs.writeFileSync(path.join(f.control, "sleep"), "yes");
		const result = await f.run("migrate", "PACKAGE=asset").done;
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /DIRTY.*snapshot/i);
		assert.deepEqual(f.effects(), []);
		assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
		const calls = fs
			.readFileSync(path.join(f.control, "transport"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert(
			calls.every(
				(a) => !a.some((value) => ["new", "resume", "delete"].includes(value)),
			),
		);
	});

for (const [mode, effects] of [
	["missing-started", 2],
	["launcher-failed", 2],
	["stream-loss", 0],
])
	test(`Asset migration preserves uncertainty on ${mode} without retry`, async (t) => {
		const f = await assetExecutionCheckout(t);
		fs.writeFileSync(path.join(f.control, mode), "yes");
		const first = await f.run("migrate", "PACKAGE=asset").done;
		assert.notEqual(first.status, 0, first.output);
		assert.match(first.output, /terminal status uncertain/);
		assert.equal(f.effects().length, effects);
		fs.unlinkSync(path.join(f.control, mode));
		const second = await f.run("migrate", "PACKAGE=asset").done;
		assert.notEqual(second.status, 0, second.output);
		assert.match(
			second.output,
			/Previous Asset migration terminal status uncertain/,
		);
		assert.equal(f.effects().length, effects);
	});

async function migrationResultWithin(running) {
	let timer;
	try {
		return await Promise.race([
			running.done,
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							Error(
								"remaining command allowance did not complete within 4000 ms",
							),
						),
					4000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test("Asset migration delivery consumes the remaining enclosing command allowance", async (t) => {
	const f = await assetExecutionCheckout(t);
	const controller = "scripts/boat.mjs";
	const source = fs.readFileSync(path.join(f.root, controller), "utf8");
	assert.equal(source.split("const entered = Date.now();").length, 2);
	f.local(
		controller,
		source.replace(
			"const entered = Date.now();",
			"const entered = Date.now() - 178_000;",
		),
	);
	fs.writeFileSync(
		path.join(f.runtime, "apps/asset/drizzle/0000_first.sql"),
		"old SQL",
	);
	const running = f.run("migrate", "PACKAGE=asset");
	await migrationObserved(f, "hash:apps/asset/drizzle/0000_first.sql");
	assert.deepEqual(f.effects(), []);
	const observedAt = performance.now();
	const result = await migrationResultWithin(running);
	assert(
		performance.now() - observedAt < 5000,
		"command completion must fit the existing fixture observation bound",
	);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /deadline exhausted/);
	assert.deepEqual(f.effects(), []);
});

test("Asset migration remaining-budget sensitivity detects a fresh full delivery allowance", async (t) => {
	const f = await assetExecutionCheckout(t);
	const controller = "scripts/boat.mjs",
		helper = "scripts/lib/boat-asset-migration.mjs";
	f.local(
		controller,
		fs
			.readFileSync(path.join(f.root, controller), "utf8")
			.replace(
				"const entered = Date.now();",
				"const entered = Date.now() - 178_000;",
			),
	);
	const source = fs.readFileSync(path.join(f.root, helper), "utf8");
	assert.equal(
		source.split("Math.min(request.deadline, Date.now() + 20_000)").length,
		2,
	);
	f.local(
		helper,
		source.replace(
			"Math.min(request.deadline, Date.now() + 20_000)",
			"Date.now() + 20_000",
		),
	);
	fs.writeFileSync(
		path.join(f.runtime, "apps/asset/drizzle/0000_first.sql"),
		"old SQL",
	);
	const running = f.run("migrate", "PACKAGE=asset");
	await migrationObserved(f, "hash:apps/asset/drizzle/0000_first.sql");
	let bailout, caught;
	const started = performance.now();
	try {
		await Promise.race([
			migrationResultWithin(running),
			new Promise((_, reject) => {
				bailout = setTimeout(
					() => reject(Error("existing five-second fixture bailout")),
					5000,
				);
			}),
		]);
	} catch (error) {
		caught = error;
	} finally {
		clearTimeout(bailout);
	}
	const elapsedMs = performance.now() - started;
	t.diagnostic(
		JSON.stringify({
			elapsedMs,
			boundedResult: caught?.message,
			beforeSafetyRelease: f.effects(),
		}),
	);
	// Release the deliberately invalid probe only after recording its bound failure.
	fs.writeFileSync(path.join(f.control, "expire"), "yes");
	const cleanup = await running.done;
	t.diagnostic(
		JSON.stringify({
			probeCleanupStatus: cleanup.status,
			output: cleanup.output,
		}),
	);
	assert.match(
		caught?.message ?? "",
		/remaining command allowance did not complete within 4000 ms/,
	);
	assert(
		elapsedMs < 5000,
		"the independent four-second bound must beat the existing five-second fixture bailout",
	);
	assert.deepEqual(f.effects(), []);
});

test("Asset migration refuses launch after preparation consumes its command allowance", async (t) => {
	const f = await assetExecutionCheckout(t);
	const controller = "scripts/boat.mjs";
	const source = fs.readFileSync(path.join(f.root, controller), "utf8");
	f.local(
		controller,
		source.replace(
			"const entered = Date.now();",
			"const entered = Date.now() - 180_001;",
		),
	);
	const result = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /command allowance exhausted/);
	assert.deepEqual(f.effects(), []);
	assert.equal(fs.existsSync(path.join(f.control, "docker")), false);
});

test("Asset migration await sensitivity cannot substitute immediate rejection for delivery", async (t) => {
	const f = await assetExecutionCheckout(t);
	const helper = "scripts/lib/boat-asset-migration.mjs";
	const source = fs.readFileSync(path.join(f.root, helper), "utf8");
	assert.equal(source.split("if (!last) break;").length, 2);
	f.local(helper, source.replace("if (!last) break;", "break;"));
	fs.writeFileSync(
		path.join(f.runtime, "apps/asset/drizzle/0000_first.sql"),
		"old SQL",
	);
	const mutant = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(mutant.status, 0, mutant.output);
	assert.match(mutant.output, /changed before launch/);
	assert.doesNotMatch(mutant.output, /asset-migration waiting/);
	assert.deepEqual(f.effects(), []);
});

test("Asset migration blocks a new submission when worker termination lacks runtime completion", async (t) => {
	const f = await assetExecutionCheckout(t);
	const docker = path.join(f.directory, "home/.local/bin/docker");
	const source = fs.readFileSync(docker, "utf8");
	assert.equal(source.split("process.stdout.write(b);").length, 2);
	fs.writeFileSync(
		docker,
		source.replace(
			"process.stdout.write(b);",
			"if(!b.toString().includes('asset-migration completed'))process.stdout.write(b);",
		),
	);
	const result = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /terminal status uncertain/);
	assert.equal(f.effects().length, 2);
	const active = f.json(".boat/asset-migration-active.json");
	assert.equal(active.terminal.exitCode, 0);
	assert.equal(active.authorizationSent, true);
	assert.equal(active.runtimeExit, undefined);
	const retry = await f.run("migrate", "PACKAGE=asset").done;
	assert.notEqual(retry.status, 0, retry.output);
	assert.equal(f.effects().length, 2);
});

test("Asset migration preserves awake foreground and partial development identities", async (t) => {
	const f = await assetExecutionCheckout(t);
	const state = f.json(".boat/state.json");
	const watcher = { pid: 557, commandId: "foreground-watch" };
	f.local(
		".boat/state.json",
		JSON.stringify({ ...state, developmentWanted: true, watcher }),
	);
	const result = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(result.status, 0, result.output);
	assert.equal(f.json(".boat/state.json").id, "fake-worker");
	assert.deepEqual(f.json(".boat/state.json").watcher, watcher);
	const transport = fs.readFileSync(path.join(f.control, "transport"), "utf8");
	assert.doesNotMatch(transport, /make apps-start|make stop|boat:stop-watch/);
});

async function startHeldAssetMigration(f) {
	const controller = "scripts/boat.mjs";
	const source = fs.readFileSync(path.join(f.root, controller), "utf8");
	f.local(
		controller,
		source.replace(
			"const entered = Date.now();",
			"const entered = Date.now() - 176_000;",
		),
	);
	fs.writeFileSync(path.join(f.control, "hold-sql"), "yes");
	const running = f.run("migrate", "PACKAGE=asset");
	await migrationObserved(f, "asset-migration launch");
	await observed(
		() => fs.existsSync(path.join(f.control, "sql-pid")),
		"held SQL startup",
	);
	return running;
}

async function assertAssetPackageExpiry(f, running) {
	const result = await migrationResultWithin(running);
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /command deadline exhausted/);
	assert.deepEqual(
		f.effects().map((e) => e.phase),
		["sql"],
	);
	const pid = Number(fs.readFileSync(path.join(f.control, "sql-pid"), "utf8"));
	await observed(() => {
		try {
			process.kill(pid, 0);
			return false;
		} catch (error) {
			return error.code === "ESRCH";
		}
	});
	assert.match(result.output, /asset-migration completed [a-f0-9]+ 1/);
}

test("Asset migration command expiry terminates its owned package process and skips backfill", async (t) => {
	const f = await assetExecutionCheckout(t);
	await assertAssetPackageExpiry(f, await startHeldAssetMigration(f));
});

// These children exercise the actual test after hooks. The parent watchdog is
// independent of both production expiry and the completion assertion under test.
if (process.env.BOAT_PACKAGE_CLEANUP_SCENARIO) {
	test("Asset migration intentional held-package failure", async (t) => {
		const scenario = process.env.BOAT_PACKAGE_CLEANUP_SCENARIO;
		const report = process.env.BOAT_PACKAGE_CLEANUP_REPORT;
		const f = await assetExecutionCheckout(t, {
			directory: process.env.BOAT_PACKAGE_CLEANUP_DIRECTORY,
			cleanupReport: report,
		});
		const helper = "scripts/lib/boat-asset-migration.mjs";
		const source = fs.readFileSync(path.join(f.root, helper), "utf8");
		const anchor = /\$\{deadline\},\$\{request\.deadline\},\{fs/g;
		assert.equal([...source.matchAll(anchor)].length, 1);
		f.local(
			helper,
			source.replace(anchor, (match) =>
				match.replace("request.deadline", "Infinity"),
			),
		);
		if (scenario === "retention")
			fs.writeFileSync(
				path.join(f.directory, "home/.local/bin/fixture-sql"),
				`#!${process.execPath}
const fs=require('fs'),path=require('path'),c=process.env.FAKE_CONTROL;
fs.writeFileSync(path.join(c,'sql-pid'),String(process.pid));
process.on('SIGTERM',()=>{process.chdir(process.env.BOAT_PACKAGE_ESCAPE_DIRECTORY);fs.writeFileSync(path.join(c,'moved'),'yes');});
process.on('SIGHUP',()=>{});
setInterval(()=>{},1000);
`,
			);

		const running = await startHeldAssetMigration(f);
		if (scenario === "expiry") {
			const packageProcess = fixtureCensus(f.directory).find(
				(p) =>
					p.cwd === path.join(f.runtime, "apps/asset") &&
					p.pid !== p.group &&
					p.group === p.session,
			);
			assert.ok(
				packageProcess,
				"held package descendant is independently inspectable",
			);
			for (const mismatch of [
				{ startTicks: "0" },
				{ session: 0 },
				{ cwd: f.root },
			])
				assert.equal(
					signalFixtureGroup(
						{ ...packageProcess, ...mismatch },
						"SIGTERM",
						f.directory,
					),
					false,
					"stale package identity cannot authorize group termination",
				);
			assert.deepEqual(fixtureProcess(packageProcess.pid), packageProcess);
		}
		fs.writeFileSync(
			report,
			JSON.stringify({
				processes: fixtureCensus(f.directory),
				command: fixtureProcess(running.child.pid),
				startedAt: fixtureNow(),
				receipt: fs.readFileSync(
					path.join(f.root, ".boat/asset-migration-active.json"),
					"utf8",
				),
			}),
		);
		try {
			if (scenario !== "expiry")
				assert.fail("intentional assertion before held-package completion");
			await assertAssetPackageExpiry(f, running);
		} catch (error) {
			// Capture the failing assertion before any after hook can retire SQL.
			fs.writeFileSync(
				`${report}.failure`,
				JSON.stringify({
					message: error.message,
					at: fixtureNow(),
					processes: fixtureCensus(f.directory),
				}),
			);
			throw error;
		}
	});
}

for (const scenario of ["expiry", "early", "retention"])
	test(`Asset migration held-package cleanup after ${scenario} failure`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-package-cleanup-"),
		);
		const owned = path.join(directory, "fixture");
		const sibling = `${owned}-sibling`;
		const escaped = path.join(directory, "escaped");
		fs.mkdirSync(sibling);
		fs.mkdirSync(escaped);
		const report = path.join(directory, "report.json");
		const readiness = lockFixtureReadiness();
		let runner,
			runnerIdentity,
			closed = false,
			done,
			canary,
			canaryDone,
			canaryClosed = false,
			before;
		const output = lockFixtureOutput();
		// Safety cleanup runs only after the assertions below have fixed the verdict.
		t.after(async () => {
			t.diagnostic(
				JSON.stringify({
					safetyBefore: fixtureCensus(owned),
					closed,
					output: output.read(),
				}),
			);
			for (const record of before?.processes ?? []) {
				const current = fixtureProcess(record.pid);
				if (
					current?.startTicks === record.startTicks &&
					current.cwd === escaped
				) {
					assert.equal(current.group, record.group);
					assert.equal(current.session, record.session);
					process.kill(current.pid, "SIGKILL");
					assert.ok(
						await fixtureStopped(() => !fixtureProcess(record.pid)),
						"escaped owned identity safety shutdown",
					);
				}
			}
			for (const record of fixtureCensus(owned))
				signalFixtureGroup(record, "SIGKILL", owned);
			if (runnerIdentity) signalFixtureGroup(runnerIdentity, "SIGKILL");
			assert.ok(
				await fixtureStopped(
					() =>
						fixtureCensus(owned).length === 0 &&
						(!runner || (closed && !processGroupRunning(runner.pid))),
				),
				"independent safety cleanup and pipe closure",
			);
			if (done) await done;
			t.diagnostic(
				JSON.stringify({ safetyAfter: fixtureCensus(owned), closed }),
			);
			if (canary) {
				canary.kill("SIGTERM");
				assert.ok(
					await fixtureStopped(() => canaryClosed),
					"sibling safety shutdown",
				);
				await canaryDone;
			}
			fs.rmSync(directory, { recursive: true, force: true });
		});
		canary = spawn(
			process.execPath,
			["-e", "console.log('ready');setInterval(()=>{},1000)"],
			{ cwd: sibling, detached: true },
		);
		canaryDone = once(canary, "close").then((result) => {
			canaryClosed = true;
			return result;
		});
		await lockCanaryReady(canary, readiness);
		const siblingIdentity = fixtureProcess(canary.pid);
		assert.equal(
			signalFixtureGroup(siblingIdentity, "SIGTERM", owned),
			false,
			"sibling prefix is outside owned directory",
		);
		runner = spawn(
			process.execPath,
			[
				"--test",
				"--test-name-pattern=^Asset migration intentional held-package failure$",
				fileURLToPath(import.meta.url),
			],
			{
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					NODE_OPTIONS: "",
					NODE_TEST_CONTEXT: undefined,
					BOAT_PACKAGE_CLEANUP_SCENARIO: scenario,
					BOAT_PACKAGE_CLEANUP_DIRECTORY: owned,
					BOAT_PACKAGE_CLEANUP_REPORT: report,
					BOAT_PACKAGE_ESCAPE_DIRECTORY: escaped,
				},
			},
		);
		runnerIdentity = fixtureProcess(runner.pid);
		runner.stdout.on("data", output.capture);
		runner.stderr.on("data", output.capture);
		done = once(runner, "close").then((result) => {
			closed = true;
			return result;
		});
		await readiness.wait(
			() => fs.existsSync(report),
			"held-package ownership report",
		);
		before = JSON.parse(fs.readFileSync(report, "utf8"));
		t.diagnostic(
			JSON.stringify({ scenario, before, runnerIdentity, siblingIdentity }),
		);
		const packages = before.processes.filter(
			(p) => p.cwd === path.join(owned, "runtime/apps/asset"),
		);
		assert.ok(
			packages.some((p) => p.group !== before.command.group),
			"actual detached package group is live",
		);
		if (scenario === "retention") {
			const completion = lockFixtureReadiness({
				deadline: before.startedAt + 5000,
			});
			await completion.wait(
				() => fs.existsSync(`${report}.cleanup`),
				"cleanup rejection report",
			);
			const cleanup = JSON.parse(fs.readFileSync(`${report}.cleanup`, "utf8"));
			assert.equal(cleanup.errors.length, 1);
			assert.match(
				cleanup.errors[0],
				/Owned lock fixture process groups did not exit|Refusing mixed-ownership fixture group/,
			);
			assert.deepEqual(cleanup.background, {
				drained: false,
				signal: "SIGTERM",
			});

			assert.equal(
				fs.readFileSync(
					path.join(owned, "source/.boat/asset-migration-active.json"),
					"utf8",
				),
				before.receipt,
				"cleanup rejection retains exact migration ownership receipt",
			);
			const survivor = before.processes
				.map((p) => fixtureProcess(p.pid))
				.find((p) => p?.cwd === escaped);
			assert.ok(
				survivor,
				"cleanup refuses escaped package identity before safety retirement",
			);
			assert.equal(
				fixtureCensus(owned).some(
					(p) =>
						p.group !== before.command.group &&
						p.cwd === path.join(owned, "source"),
				),
				false,
				"keeper retires despite package cleanup rejection",
			);
			assert.deepEqual(
				fixtureProcess(canary.pid),
				siblingIdentity,
				"cleanup rejection protects unrelated sibling",
			);
			t.diagnostic(
				JSON.stringify({
					scenario,
					survivor,
					retainedReceipt: before.receipt,
					output: output.read(),
				}),
			);
			return;
		}
		// Five seconds from held-package startup bounds completion and cleanup
		// independently of production timers.
		const completion = lockFixtureReadiness({
			deadline: before.startedAt + 5000,
		});
		await completion.wait(
			() => closed,
			"held-package test completion and pipe drainage",
		);
		const [status, signal] = await done;
		assert.equal(status, 1, output.read());
		assert.equal(signal, null, output.read());
		assert.equal(
			processGroupRunning(runner.pid),
			false,
			"failing test runner group retired before safety cleanup",
		);
		assert.match(
			output.read(),
			scenario === "expiry"
				? /remaining command allowance did not complete within 4000 ms/
				: /intentional assertion before held-package completion/,
		);
		const failure = JSON.parse(fs.readFileSync(`${report}.failure`, "utf8"));
		assert.equal(
			failure.message,
			scenario === "expiry"
				? "remaining command allowance did not complete within 4000 ms"
				: "intentional assertion before held-package completion",
		);
		assert.ok(
			failure.processes.some(
				(p) =>
					p.name === "fixture-sql" &&
					before.processes.some(
						(owned) =>
							owned.pid === p.pid &&
							owned.startTicks === p.startTicks &&
							owned.group === p.group &&
							owned.session === p.session &&
							owned.cwd === p.cwd,
					),
			),
			"held SQL is still live at the primary assertion failure, before cleanup",
		);
		if (scenario === "expiry")
			assert.ok(
				failure.at - before.startedAt >= 4000 &&
					failure.at - before.startedAt < 5000,
				"primary assertion independently fails within the existing bound",
			);
		t.diagnostic(JSON.stringify({ scenario, failure }));
		assert.doesNotMatch(
			output.read(),
			/hookFailed|Owned lock fixture process groups did not exit/,
		);
		assert.deepEqual(
			fixtureCensus(owned),
			[],
			"after hooks retire package, command and keeper before safety cleanup",
		);
		assert.equal(
			fs.existsSync(owned),
			false,
			"successful cleanup removes owned fixture",
		);
		for (const record of before.processes)
			assert.notEqual(
				fixtureProcess(record.pid)?.startTicks,
				record.startTicks,
				"original owned identity retired",
			);
		assert.deepEqual(
			fixtureProcess(canary.pid),
			siblingIdentity,
			"unrelated sibling survives unchanged",
		);
		t.diagnostic(
			JSON.stringify({
				scenario,
				before,
				elapsedMs: fixtureNow() - before.startedAt,
				status,
				signal,
				cleanup: JSON.parse(fs.readFileSync(`${report}.cleanup`, "utf8")),
				output: output.read(),
			}),
		);
	});

for (const flags of [
	"--project-name=owned",
	"-powned",
	"--project-name owned",
	"-p owned",
])
	test(`Asset migration independent ownership accepts explicit project ${flags} over ambient`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.COMPOSE_PROJECT_NAME = "ambient";
		f.env.FAKE_CONTAINER_PROJECT = "owned";
		const result = await f.run(
			"migrate",
			"PACKAGE=asset",
			`APPS_COMPOSE=docker compose ${flags} -f infra/docker-compose.apps.yml`,
		).done;
		assert.equal(result.status, 0, result.output);
		assert.match(result.output, /"project":"owned"/);
		assert.equal(f.effects().length, 2);
		assert.equal(f.env.COMPOSE_PROJECT_NAME, "ambient");
	});

for (const [project, service, guard] of [
	["foreign", "asset", /container project mismatch/],
	["owned", "foreign", /running owned Asset instance/],
])
	test(`Asset migration independent ownership rejects project=${project}, service=${service}`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.COMPOSE_PROJECT_NAME = "ambient";
		f.env.FAKE_CONTAINER_PROJECT = project;
		f.env.FAKE_CONTAINER_SERVICE = service;
		const result = await f.run(
			"migrate",
			"PACKAGE=asset",
			"APPS_COMPOSE=docker compose -p owned -f infra/docker-compose.apps.yml",
		).done;
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, guard);
		assert.deepEqual(f.effects(), []);
	});

test("Asset migration independent ownership sensitivity detects ignoring the explicit project", async (t) => {
	const f = await assetExecutionCheckout(t);
	f.env.COMPOSE_PROJECT_NAME = "ambient";
	f.env.FAKE_CONTAINER_PROJECT = "owned";
	const helper = "scripts/lib/boat-asset-migration.mjs";
	const source = fs.readFileSync(path.join(f.root, helper), "utf8");
	assert.equal(source.split("const project = JSON.parse(").length, 2);
	f.local(
		helper,
		source.replace(
			"const project = JSON.parse(",
			"const project = process.env.COMPOSE_PROJECT_NAME; const ignored = JSON.parse(",
		),
	);
	const result = await f.run(
		"migrate",
		"PACKAGE=asset",
		"APPS_COMPOSE=docker compose --project-name=owned -f infra/docker-compose.apps.yml",
	).done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /container project mismatch/);
	assert.deepEqual(f.effects(), []);
});

for (const field of ["project", "service"])
	test(`Asset migration independent ownership ${field} guard sensitivity has no earlier rejection`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.FAKE_CONTAINER_PROJECT = field === "project" ? "foreign" : "owned";
		f.env.FAKE_CONTAINER_SERVICE = field === "service" ? "foreign" : "asset";
		const helper = "scripts/lib/boat-asset-migration.mjs";
		const source = fs.readFileSync(path.join(f.root, helper), "utf8");
		const guard =
			field === "project"
				? 'info.Config.Labels["com.docker.compose.project"] !== project'
				: 'info.Config?.Labels?.["com.docker.compose.service"] !== "asset"';
		assert.equal(source.split(guard).length, 2);
		f.local(helper, source.replace(guard, "false"));
		const mutant = await f.run(
			"migrate",
			"PACKAGE=asset",
			"APPS_COMPOSE=docker compose --project-name=owned -f infra/docker-compose.apps.yml",
		).done;
		assert.equal(mutant.status, 0, mutant.output);
		assert.equal(f.effects().length, 2);
	});

for (const options of [
	["-e", "DATABASE_URL=host-controlled"],
	["--env=DATABASE_URL=host-controlled"],
	["-eDATABASE_URL=host-controlled"],
	["--env", "DATABASE_URL"],
])
	test(`Asset migration environment-forwarding sensitivity detects ${options[0]}`, async (t) => {
		const f = await assetExecutionCheckout(t);
		f.env.DATABASE_URL = "host-controlled";
		const helper = "scripts/lib/boat-asset-migration.mjs";
		const source = fs.readFileSync(path.join(f.root, helper), "utf8");
		const anchor = '"exec",\n';
		assert.equal(source.split(anchor).length, 2);
		f.local(
			helper,
			source.replace(
				anchor,
				`${anchor}${options.map((value) => JSON.stringify(value)).join(",")},\n`,
			),
		);
		const mutant = await f.run("migrate", "PACKAGE=asset").done;
		assert.equal(mutant.status, 0, mutant.output);
		assert.deepEqual(
			f.effects().map((e) => e.url),
			["host-controlled", "host-controlled"],
			"double must expose forwarded host environment instead of always supplying runtime values",
		);
		assert(
			f.effects().every((e) => e.cwd === path.join(f.runtime, "apps/asset")),
		);
	});

test("Asset migration environment control inherits runtime URL instead of the controlled host URL", async (t) => {
	const f = await assetExecutionCheckout(t);
	f.env.DATABASE_URL = "host-controlled";
	const result = await f.run("migrate", "PACKAGE=asset").done;
	assert.equal(result.status, 0, result.output);
	assert.deepEqual(
		f.effects().map((e) => e.url),
		["runtime-inherited", "runtime-inherited"],
	);
});

function finalInspectionClock(f, mode) {
	fs.appendFileSync(
		path.join(f.directory, "clock.mjs"),
		`
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
const originalNow=Date.now,originalRead=fs.readFileSync,originalSpawn=cp.spawn;
let inspected=0,armed=false,timeReads=0;
Date.now=()=>{const value=originalNow();if(!armed)return value;timeReads++;return value+(${JSON.stringify(mode)}==='delivery'?20001:${JSON.stringify(mode)}==='enclosing'&&timeReads>=2?180001:0);};
fs.readFileSync=function(file,...args){const bytes=originalRead.call(this,file,...args);if(String(file).endsWith('/.pnpm-lockfile-hash')&&++inspected===2){armed=true;fs.writeFileSync(path.join(process.env.FAKE_CONTROL,'final-inspection'),JSON.stringify({inspected,mode:${JSON.stringify(mode)}}));}return bytes;};
cp.spawn=function(command,args,options){if(command==='pnpm')fs.appendFileSync(path.join(process.env.FAKE_CONTROL,'actual-script-launches'),JSON.stringify({at:Date.now(),inspected,args})+'\\n');return originalSpawn.call(this,command,args,options);};syncBuiltinESMExports();
`,
	);
}

for (const mode of ["delivery", "enclosing", "unexpired"])
	test(`Asset migration final inspection rechecks ${mode} launch budget`, async (t) => {
		const f = await assetExecutionCheckout(t);
		finalInspectionClock(f, mode);
		const result = await f.run("migrate", "PACKAGE=asset").done;
		assert.deepEqual(
			JSON.parse(
				fs.readFileSync(path.join(f.control, "final-inspection"), "utf8"),
			),
			{ inspected: 2, mode },
		);
		const launches = fs.existsSync(
			path.join(f.control, "actual-script-launches"),
		)
			? fs
					.readFileSync(path.join(f.control, "actual-script-launches"), "utf8")
					.trim()
					.split("\n")
					.map(JSON.parse)
			: [];
		t.diagnostic(JSON.stringify({ mode, launches, output: result.output }));
		if (mode === "unexpired") {
			assert.equal(result.status, 0, result.output);
			assert.equal(launches.length, 1);
			assert.equal(f.effects().length, 2);
		} else {
			assert.notEqual(result.status, 0, result.output);
			assert.equal(
				launches.length,
				0,
				"no package spawn may follow the expiring final inspection",
			);
			assert.deepEqual(f.effects(), []);
		}
	});

for (const mode of ["delivery", "enclosing"])
	test(`Asset migration final inspection ${mode} guard sensitivity observes actual spawn`, async (t) => {
		const f = await assetExecutionCheckout(t);
		finalInspectionClock(f, mode);
		const helper = "scripts/lib/boat-asset-migration.mjs";
		const source = fs.readFileSync(path.join(f.root, helper), "utf8");
		const condition = "Date.now() >= deadline || Date.now() >= commandDeadline";
		assert.equal(source.split(condition).length, 2);
		f.local(
			helper,
			source.replace(
				condition,
				mode === "delivery"
					? "Date.now() >= commandDeadline"
					: "Date.now() >= deadline",
			),
		);
		const result = await f.run("migrate", "PACKAGE=asset").done;
		const launches = fs
			.readFileSync(path.join(f.control, "actual-script-launches"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert.equal(launches.length, 1, result.output);
		assert.equal(launches[0].inspected, 2);
		assert.doesNotMatch(
			result.output,
			/source superseded|changed before launch/,
		);
	});

function migrationProcess(pid) {
	try {
		const fields = fs
			.readFileSync(`/proc/${pid}/stat`, "utf8")
			.split(") ")
			.at(-1)
			.split(" ");
		return {
			pid,
			state: fields[0],
			group: Number(fields[2]),
			session: Number(fields[3]),
			startTicks: fields[19],
		};
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function migrationDescendantDeadline(owned, commandDeadline) {
	const startedAt = Date.now();
	assert(
		commandDeadline > startedAt && commandDeadline - startedAt < 5000,
		"descendant deadline observation must start within the existing fixture bound",
	);
	let terminatedAt;
	while (Date.now() < commandDeadline) {
		const current = migrationProcess(owned.pid);
		if (
			terminatedAt === undefined &&
			(!current ||
				current.startTicks !== owned.startTicks ||
				["Z", "X"].includes(current.state))
		)
			terminatedAt = Date.now();
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				Math.max(0, Math.min(10, commandDeadline - Date.now())),
			),
		);
	}
	const current = migrationProcess(owned.pid);
	const atDeadline = current?.startTicks === owned.startTicks ? current : null;
	return {
		commandDeadline,
		startedAt,
		sampledAt: Date.now(),
		atDeadline,
		terminatedAt,
	};
}

function assertMigrationDescendantDeadline(evidence) {
	assert(
		!evidence.atDeadline || ["Z", "X"].includes(evidence.atDeadline.state),
		"owned descendant must terminate by its command deadline",
	);
	assert(
		evidence.terminatedAt !== undefined &&
			evidence.terminatedAt <= evidence.commandDeadline,
		"owned descendant termination must be independently observed before its command deadline",
	);
}

for (const [leaderExit, release, lateCleanup] of [
	[7, false, false],
	[0, false, false],
	[7, true, false],
	[0, true, false],
	[0, false, true],
])
	test(`Asset migration group ownership survives leader exit ${leaderExit}, released=${release}, lateCleanup=${lateCleanup}`, async (t) => {
		const f = await assetExecutionCheckout(t);
		const controller = "scripts/boat.mjs";
		f.local(
			controller,
			fs
				.readFileSync(path.join(f.root, controller), "utf8")
				.replace(
					"const entered = Date.now();",
					"const entered = Date.now() - 176_000;",
				),
		);
		if (lateCleanup) {
			// Fault injection in the private fixture only. Advertised deadline stays
			// unchanged; the held descendant is released just beyond that deadline.
			const helper = "scripts/lib/boat-asset-migration.mjs";
			const source = fs.readFileSync(path.join(f.root, helper), "utf8");
			const anchor = /\$\{deadline\},\$\{request\.deadline\},\{fs/g;
			assert.equal([...source.matchAll(anchor)].length, 1);
			f.local(
				helper,
				source.replace(anchor, (match) =>
					match.replace("request.deadline", "request.deadline + 2000"),
				),
			);
		}
		const pnpm = path.join(f.directory, "home/.local/bin/pnpm");
		fs.writeFileSync(
			pnpm,
			`#!${process.execPath}
const cp=require('child_process'),fs=require('fs'),path=require('path');
if(process.argv[2]!=='run')process.exit(cp.spawnSync(${JSON.stringify(`${pnpm}-install`)},process.argv.slice(2),{stdio:'inherit',env:process.env}).status??1);
const control=process.env.FAKE_CONTROL;
const child=cp.spawn(process.execPath,['-e',"const fs=require('fs'),path=require('path'),c=process.env.FAKE_CONTROL;process.on('SIGTERM',()=>{});fs.writeFileSync(path.join(c,'descendant-pid'),String(process.pid));setInterval(()=>{if(fs.existsSync(path.join(c,'release-descendant')))process.exit(0);},10);"],{stdio:'ignore',env:process.env});child.unref();
console.log('package leader exited ${leaderExit}');process.exit(${leaderExit});
`,
		);
		let owned;
		t.after(() => {
			const current = owned && migrationProcess(owned.pid);
			const needed = current && !["Z", "X"].includes(current.state);
			t.diagnostic(
				JSON.stringify({
					safetyTeardown: { owned, current, needed: !!needed },
				}),
			);
			if (needed && current.startTicks === owned.startTicks)
				process.kill(owned.pid, "SIGKILL");
		});
		const running = f.run("migrate", "PACKAGE=asset");
		await migrationObserved(f, `package leader exited ${leaderExit}`);
		await observed(
			() => fs.existsSync(path.join(f.control, "descendant-pid")),
			"owned descendant startup",
		);
		owned = migrationProcess(
			Number(fs.readFileSync(path.join(f.control, "descendant-pid"), "utf8")),
		);
		assert(owned && owned.group === owned.session && owned.group !== owned.pid);
		const instance = JSON.parse(
			running.output().match(/asset-migration instance (\{[^\n]+\})/)[1],
		);
		assert(
			instance.commandDeadline > Date.now(),
			"deadline observation must start while the descendant is still owned and live",
		);
		let atCompletion, completedAt;
		const completed = running.done.then((result) => {
			atCompletion = migrationProcess(owned.pid);
			completedAt = Date.now();
			return result;
		});
		const deadlineObservation = migrationDescendantDeadline(
			owned,
			instance.commandDeadline,
		);
		if (release) {
			assert.doesNotMatch(
				fs.readFileSync(path.join(f.control, "runtime-output"), "utf8"),
				/asset-migration completed/,
			);
			fs.writeFileSync(path.join(f.control, "release-descendant"), "yes");
		}
		const deadlineEvidence = await deadlineObservation;
		t.diagnostic(
			JSON.stringify({ leaderExit, release, lateCleanup, deadlineEvidence }),
		);
		// This assertion precedes awaiting command completion or safety teardown.
		if (lateCleanup) {
			assert.throws(
				() => assertMigrationDescendantDeadline(deadlineEvidence),
				/owned descendant must terminate by its command deadline/,
			);
			assert.equal(
				completedAt,
				undefined,
				"late cleanup must still be pending when the deadline assertion rejects it",
			);
			// A barrier makes eventual clean completion causally later than the
			// observed deadline failure, independent of timer scheduling jitter.
			fs.writeFileSync(path.join(f.control, "release-descendant"), "yes");
		} else assertMigrationDescendantDeadline(deadlineEvidence);
		const result = await completed;
		t.diagnostic(
			JSON.stringify({
				leaderExit,
				release,
				lateCleanup,
				commandDeadline: instance.commandDeadline,
				atCompletion,
				completedAt,
				deadlineEvidence,
				output: result.output,
			}),
		);
		assert(
			!atCompletion || ["Z", "X"].includes(atCompletion.state),
			"completion must follow termination of live owned descendants, before safety teardown",
		);
		if (lateCleanup) {
			assert.equal(result.status, 0, result.output);
			assert.match(result.output, /asset-migration completed [a-f0-9]+ 0/);
			assert(
				completedAt > instance.commandDeadline,
				"the sensitivity control must actually complete late",
			);
		}
		if (release) {
			assert(
				completedAt < instance.commandDeadline,
				"released descendants must preserve prompt command completion",
			);
			assert.equal(result.status === 0, leaderExit === 0, result.output);
			assert.match(
				result.output,
				new RegExp(`asset-migration completed [a-f0-9]+ ${leaderExit}`),
			);
		} else if (!lateCleanup) {
			assert.notEqual(result.status, 0, result.output);
			assert.match(result.output, /command deadline exhausted/);
		}
	});

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
async function pausedGeneration(t, phase = "", checkout) {
	const f = checkout ?? (await lockGenerationCheckout(t));
	f.readiness.enter(`paused ${phase || "generator"}`);
	flag(f, phase ? `pause-${phase}` : "pause");
	const command = f.run("run", "PACKAGE=scripts", "SCRIPT=dependencies:lock");
	const pending = command.done;
	await f.readiness.wait(
		() => {
			if (command.terminal) {
				throw new Error(
					`Make exited before paused ${phase || "generator"}: status=${command.terminal.status}, signal=${command.terminal.signal ?? "none"}\n${command.output()}`,
				);
			}
			return fs.existsSync(
				path.join(f.control, phase ? `entered-${phase}` : "entered"),
			);
		},
		`paused ${phase || "generator"}`,
	);
	return {
		...f,
		pending,
		release: () => flag(f, phase ? `release-${phase}` : "release"),
	};
}

test("paused lock fixture reports Make failure before the sync barrier", async (t) => {
	const f = await lockGenerationCheckout(t);
	fs.writeFileSync(
		path.join(f.control, "info-error"),
		"fixture_early_info_failure",
	);
	await assert.rejects(pausedGeneration(t, "sync", f), (error) => {
		assert.match(error.message, /Make exited before paused sync/);
		assert.match(error.message, /status=2, signal=none/);
		assert.match(error.message, /fixture_early_info_failure/);
		assert.doesNotMatch(error.message, /Timed out/);
		assert.equal(fs.existsSync(path.join(f.control, "entered-sync")), false);
		return true;
	});
	assert.equal(f.commands.length, 1);
	const command = f.commands[0];
	assert.deepEqual(await stopLockFixtureChildren(f.commands, true), {
		drained: true,
		signal: null,
	});
	await command.done;
	assert.equal(command.closed, true);
	assert.equal(command.child.exitCode, 2);
	assert.equal(command.child.signalCode, null);
	assert.equal(processGroupRunning(command.child.pid), false);
});

test("lock fixture output retains a bounded sanitized tail across split controls", () => {
	const output = lockFixtureOutput();
	output.capture("\u001b[");
	assert.equal(output.read(), "[");
	output.capture("31mfixture failure\u001b[0m");
	assert.equal(output.read(), "fixture failure");
	output.capture("x".repeat(20000));
	output.capture("\u001b[");
	output.capture("31mbounded failure\u001b[0m");
	assert.ok(output.read().length <= 16384);
	assert.ok(output.read().endsWith("bounded failure"));
	assert.equal(output.read().includes(String.fromCharCode(27)), false);
});

test("paused lock fixture sanitizes split terminal controls in bounded Make diagnostics", async (t) => {
	const f = await lockGenerationCheckout(t);
	f.local(
		"scripts/boat.mjs",
		`import fs from 'node:fs';import path from 'node:path';
const control=process.env.FAKE_CONTROL;
const wait=(name)=>{while(!fs.existsSync(path.join(control,name)))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);};
fs.writeSync(1,'x'.repeat(20000)+'\u001b[');wait('complete-diagnostic');
fs.writeSync(1,'31mfixture split failure\u001b[0m');wait('exit-diagnostic');process.exit(37);`,
	);
	const rejected = assert.rejects(pausedGeneration(t, "sync", f), (error) => {
		assert.match(
			error.message,
			/Make exited before paused sync: status=2, signal=none/,
		);
		assert.match(error.message, /fixture split failure/);
		assert.equal(
			error.message.includes(String.fromCharCode(27)),
			false,
			"split ANSI control must not escape into diagnostic",
		);
		assert.ok(
			error.message.length <= 16500,
			"terminal diagnostic retains its bounded output tail",
		);
		return true;
	});
	const command = f.commands[0];
	await f.readiness.wait(
		() => command.output().endsWith("["),
		"first split diagnostic chunk captured",
	);
	flag(f, "complete-diagnostic");
	await f.readiness.wait(
		() => command.output().includes("fixture split failure"),
		"second split diagnostic chunk captured",
	);
	flag(f, "exit-diagnostic");
	await rejected;
	assert.deepEqual(await stopLockFixtureChildren(f.commands, true), {
		drained: true,
		signal: null,
	});
	const result = await command.done;
	assert.equal(command.closed, true);
	assert.equal(result.status, 2);
	assert.equal(result.signal, null);
	assert.equal(result.output.includes(String.fromCharCode(27)), false);
	assert.ok(result.output.length <= 16384);
});

for (const status of [0, 37])
	test(`paused lock fixture observes Make exit ${status} while descendant pipes remain open`, async (t) => {
		const f = await lockGenerationCheckout(t);
		f.local(
			"scripts/boat.mjs",
			`import {spawn} from 'node:child_process';
spawn(process.execPath,['-e',"console.log('pipe holder ready');setInterval(()=>{},1000)"],{stdio:'inherit'});
console.error('fixture early controller exit');process.exit(${status});`,
		);
		await assert.rejects(pausedGeneration(t, "sync", f), (error) => {
			assert.match(error.message, /Make exited before paused sync/);
			assert.match(
				error.message,
				new RegExp(`status=${status === 0 ? 0 : 2}, signal=none`),
			);
			assert.match(error.message, /fixture early controller exit/);
			return true;
		});
		const command = f.commands[0];
		assert.equal(command.closed, false);
		assert.equal(command.child.exitCode, status === 0 ? 0 : 2);
		assert.equal(command.child.signalCode, null);
		await stopLockFixtureChildren(f.commands);
		assert.equal(command.closed, true);
		assert.deepEqual(await command.done, {
			status: status === 0 ? 0 : 2,
			signal: null,
			output: command.output(),
		});
		assert.equal(processGroupRunning(command.child.pid), false);
	});

test("paused lock fixture observes Make signal before generator barrier", async (t) => {
	const f = await lockGenerationCheckout(t);
	flag(f, "pause-sync");
	const waiting = pausedGeneration(t, "", f);
	// Observe the rejection immediately, while arranging the earlier sync barrier.
	const rejected = assert.rejects(
		waiting,
		/Make exited before paused generator: status=null, signal=SIGTERM/,
	);
	await observed(
		() => fs.existsSync(path.join(f.control, "entered-sync")),
		"earlier sync barrier",
	);
	const command = f.commands[0];
	command.child.kill("SIGTERM");
	await rejected;
	assert.equal(command.child.exitCode, null);
	assert.equal(command.child.signalCode, "SIGTERM");
	await stopLockFixtureChildren(f.commands);
	assert.equal(command.closed, true);
	assert.equal((await command.done).signal, "SIGTERM");
	assert.equal(processGroupRunning(command.child.pid), false);
});

test("lock fixture phases consume one monotonic budget even while Make stays live", async (t) => {
	let clock = 1000;
	const shared = lockFixtureReadiness({
		deadline: clock + 5000,
		now: () => clock,
	});
	const f = await lockGenerationCheckout(t, { readiness: shared });
	clock = 4000;
	const paused = await pausedGeneration(t, "sync", f);
	assert.equal(shared.deadline, 6000);
	const command = f.commands[0];
	assert.equal(command.child.exitCode, null);
	assert.equal(command.child.signalCode, null);
	assert.equal(command.closed, false);
	clock = 5999;
	await assert.rejects(
		shared.wait(() => {
			clock = 6000;
			return true;
		}, "report publication"),
		/Readiness deadline exhausted during report publication/,
	);
	await assert.rejects(
		shared.wait(
			() => fs.existsSync(path.join(f.control, "entered")),
			"paused generator",
		),
		/Readiness deadline exhausted during paused generator/,
	);
	assert.equal(fs.existsSync(path.join(f.control, "entered")), false);
	assert.equal(
		command.terminal,
		null,
		"live missing marker must still exhaust the original budget",
	);
	paused.release();
	await stopLockFixtureChildren(f.commands, true);
	assert.equal(command.closed, true);
	const result = await paused.pending;
	assert.equal(result.status, 0, result.output);
	assert.equal(result.signal, null);
	assert.equal(processGroupRunning(command.child.pid), false);
});

test("lock fixture live missing marker expires after false observations", async (t) => {
	let clock = 1000;
	const readiness = lockFixtureReadiness({
		deadline: clock + 5000,
		now: () => clock,
	});
	const f = await lockGenerationCheckout(t, { readiness });
	const paused = await pausedGeneration(t, "sync", f);
	const command = f.commands[0];
	let observations = 0;
	let cancelWait = false;
	let outcome;
	assert.ok(clock < readiness.deadline);
	readiness
		.wait(() => {
			if (cancelWait)
				throw new Error("independent missing-marker safety cancellation");
			observations++;
			clock += 1000;
			return fs.existsSync(path.join(f.control, "entered"));
		}, "live missing generator marker")
		.then(
			() => {
				outcome = "ready";
			},
			(error) => {
				outcome = error;
			},
		);
	try {
		assert.ok(
			await fixtureStopped(() => outcome !== undefined),
			"live missing marker must settle at the original deadline",
		);
		assert.ok(outcome instanceof Error);
		assert.match(
			outcome.message,
			/Readiness deadline exhausted during live missing generator marker/,
		);
		assert.ok(
			observations > 1,
			"false observations must advance an initially unexpired budget",
		);
		assert.ok(clock >= readiness.deadline);
		assert.equal(fs.existsSync(path.join(f.control, "entered")), false);
		assert.equal(command.terminal, null);
		assert.equal(command.child.exitCode, null);
		assert.equal(command.child.signalCode, null);
		assert.equal(command.closed, false);
		assert.equal(processGroupRunning(command.child.pid), true);
	} finally {
		// Stop a broken waiter independently before releasing its real command.
		cancelWait = true;
		assert.ok(
			await fixtureStopped(() => outcome !== undefined),
			"missing-marker waiter canceled for safety",
		);
		paused.release();
		assert.deepEqual(await stopLockFixtureChildren(f.commands, true), {
			drained: true,
			signal: null,
		});
		const result = await paused.pending;
		assert.equal(result.status, 0, result.output);
		assert.equal(result.signal, null);
		assert.equal(command.closed, true);
		assert.equal(processGroupRunning(command.child.pid), false);
	}
});

test("lock fixture child cannot restart an expired overall readiness budget", async (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boat-lock-budget-"));
	const report = path.join(directory, "report.json");
	const fixtureDirectory = path.join(directory, "fixture");
	fs.mkdirSync(fixtureDirectory);
	let runner, done, runnerIdentity;
	t.after(async () => {
		if (runner)
			await emergencyLockFixtureCleanup({
				runner,
				runnerIdentity,
				done,
				directory: fixtureDirectory,
			});
		fs.rmSync(directory, { recursive: true, force: true });
	});
	runner = spawn(
		process.execPath,
		[
			"--test",
			"--test-name-pattern=^lock fixture intentional failure$",
			fileURLToPath(import.meta.url),
		],
		{
			env: {
				...process.env,
				NODE_TEST_CONTEXT: undefined,
				NODE_OPTIONS: "",
				BOAT_LOCK_CLEANUP_PHASE: "sync",
				BOAT_LOCK_CLEANUP_REPORT: report,
				BOAT_LOCK_FIXTURE_DIRECTORY: fixtureDirectory,
				BOAT_LOCK_READY_DEADLINE: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	runner.stdout.on("data", (bytes) => {
		output += bytes;
	});
	runner.stderr.on("data", (bytes) => {
		output += bytes;
	});
	runnerIdentity = fixtureProcess(runner.pid);
	done = once(runner, "close");
	await observed(
		() => runner.exitCode !== null || runner.signalCode !== null,
		"expired budget runner exit",
	);
	const [status, signal] = await done;
	assert.equal(status, 1, output);
	assert.equal(signal, null, output);
	assert.match(output, /Readiness deadline exhausted during checkout setup/);
	assert.equal(
		fs.existsSync(report),
		false,
		"expired setup must not advance to report publication",
	);
});

// Run an actual failing test in a child so its after hooks and open handles are
// exercised without failing (or hanging) the surrounding regression suite.
if (process.env.BOAT_LOCK_CLEANUP_PHASE) {
	test("lock fixture intentional failure", async (t) => {
		const phase = process.env.BOAT_LOCK_CLEANUP_PHASE;
		const pause =
			phase === "generate" ? "" : phase === "unresponsive" ? "sync" : phase;
		const readiness = lockFixtureReadiness({
			deadline: Number(process.env.BOAT_LOCK_READY_DEADLINE),
			report: process.env.BOAT_LOCK_CLEANUP_REPORT,
		});
		const checkout = await lockGenerationCheckout(t, {
			readiness,
			directory: process.env.BOAT_LOCK_FIXTURE_DIRECTORY,
			cleanupReport: process.env.BOAT_LOCK_CLEANUP_REPORT,
		});
		const f = await pausedGeneration(t, pause, checkout);
		if (phase === "unresponsive") flag(f, "ignore-release");
		f.pending.then((result) => {
			fs.writeFileSync(
				`${process.env.BOAT_LOCK_CLEANUP_REPORT}.result`,
				JSON.stringify(result),
			);
		});
		if (process.env.BOAT_LOCK_BEFORE_REPORT) {
			fs.writeFileSync(`${process.env.BOAT_LOCK_CLEANUP_REPORT}.parked`, "yes");
			await readiness.wait(
				() => fs.existsSync(path.join(f.control, "publish-report")),
				"pre-report barrier",
			);
		}
		if (process.env.BOAT_LOCK_BEFORE_REPORT === "late") {
			const nested = path.join(f.worker, "scripts");
			spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
				cwd: nested,
				detached: true,
				stdio: "ignore",
			});
			fs.writeFileSync(
				process.env.BOAT_LOCK_CLEANUP_REPORT,
				JSON.stringify({ directory: f.directory, processes: [] }),
			);
			fs.writeFileSync(`${process.env.BOAT_LOCK_CLEANUP_REPORT}.late`, "yes");
			await readiness.wait(() => false, "late report parked runner");
		}
		readiness.enter("daemon startup");
		const { child: daemon } = f.daemon();
		await readiness.wait(
			() => worktreeProcesses(f.root).some((p) => p.pid === daemon.pid),
			"owned daemon started",
		);
		const processes = fixtureCensus(f.directory);
		readiness.enter("report publication");
		fs.writeFileSync(
			process.env.BOAT_LOCK_CLEANUP_REPORT,
			JSON.stringify({ directory: f.directory, processes }),
		);
		assert.fail("intentional failure before normal barrier release");
	});
}

async function fixtureStopped(predicate) {
	const deadline = fixtureNow() + 1000;
	while (!predicate()) {
		if (fixtureNow() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return true;
}
function fixtureGroupMembers(group) {
	const members = [];
	for (const pid of fs.readdirSync("/proc")) {
		if (!/^\d+$/.test(pid)) continue;
		try {
			const text = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
			const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
			if (Number(fields[2]) !== group || fields[0] === "Z") continue;
			const record = fixtureProcess(pid);
			if (record) members.push(record);
		} catch (error) {
			if (!["ENOENT", "ESRCH"].includes(error.code)) throw error;
		}
	}
	return members;
}
function signalFixtureGroup(record, signal, directory) {
	const current = fixtureProcess(record.pid);
	if (
		!current ||
		current.startTicks !== record.startTicks ||
		current.group !== record.group ||
		current.session !== record.session ||
		current.cwd !== record.cwd
	)
		return false;
	const ownGroup = fixtureProcess(process.pid).group;
	if (
		!Number.isSafeInteger(record.group) ||
		record.group <= 1 ||
		record.group === ownGroup
	)
		return false;
	if (directory) {
		if (!fixtureContains(directory, current.cwd)) return false;
		assert.ok(
			fixtureGroupMembers(record.group).every((p) =>
				fixtureContains(directory, p.cwd),
			),
			"Refusing mixed-ownership fixture group",
		);
	}
	const verified = fixtureProcess(record.pid);
	if (
		!verified ||
		verified.startTicks !== record.startTicks ||
		verified.group !== record.group ||
		verified.session !== record.session ||
		verified.cwd !== record.cwd
	)
		return false;
	try {
		process.kill(-record.group, signal);
	} catch (error) {
		if (error.code !== "ESRCH") throw error;
	}
	return true;
}
async function emergencyLockFixtureCleanup({
	runner,
	runnerIdentity,
	done,
	directory,
	beforeRunnerStop = async () => {},
}) {
	// The parent already owns this directory. A report is never an ownership source.
	const records = new Map();
	const census = () => {
		for (const record of fixtureCensus(directory))
			records.set(`${record.pid}:${record.startTicks}`, record);
	};
	let runnerClosed = false;
	done.then(() => {
		runnerClosed = true;
	});
	census();
	const currentRunner = fixtureProcess(runner.pid);
	const runnerRecords =
		runnerIdentity && currentRunner?.startTicks === runnerIdentity.startTicks
			? fixtureGroupMembers(runner.pid)
			: [];
	await beforeRunnerStop();
	const runnerSignals = [];
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		for (const record of runnerRecords)
			if (signalFixtureGroup(record, signal)) {
				runnerSignals.push(signal);
				break;
			}
		if (
			await fixtureStopped(
				() =>
					!processGroupRunning(runner.pid) &&
					(runner.exitCode !== null || runner.signalCode !== null),
			)
		)
			break;
	}
	assert.equal(
		processGroupRunning(runner.pid),
		false,
		"runner group survived emergency cleanup",
	);
	// Capture groups launched after the first census and before runner shutdown.
	census();
	const control = path.join(directory, "control");
	if (fs.existsSync(control))
		for (const name of [
			"release",
			"release-sync",
			"release-collect",
			"release-stop-completion",
		])
			fs.writeFileSync(path.join(control, name), "yes");
	const stopped = () => {
		census();
		return [...new Set([...records.values()].map((p) => p.group))].every(
			(group) => !processGroupRunning(group),
		);
	};
	await fixtureStopped(stopped);
	const drainedGroups = [
		...new Set([...records.values()].map((p) => p.group)),
	].filter((group) => !processGroupRunning(group));
	const signaled = [];
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		census();
		const groups = new Set();
		for (const record of records.values()) {
			if (groups.has(record.group)) continue;
			if (signalFixtureGroup(record, signal, directory)) {
				groups.add(record.group);
				signaled.push({ group: record.group, signal });
			}
		}
		if (await fixtureStopped(stopped)) {
			assert.deepEqual(
				fixtureCensus(directory),
				[],
				"owned processes survived emergency cleanup",
			);
			assert.ok(
				await fixtureStopped(() => runnerClosed),
				"runner pipes did not close after owned cleanup",
			);
			await done;
			fs.rmSync(directory, { recursive: true, force: true });
			return {
				processes: [...records.values()],
				drainedGroups,
				signaled,
				runnerSignals,
			};
		}
	}
	assert.fail("Owned fixture groups did not stop; preserving fixture files");
}

function fixtureProcess(pid) {
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
			before[3] !== after[3] ||
			after[0] === "Z"
		)
			return null;
		return {
			name: fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim(),
			pid: Number(pid),
			group: Number(after[2]),
			session: Number(after[3]),
			startTicks: after[19],
			cwd,
		};
	} catch (error) {
		if (["ENOENT", "ESRCH"].includes(error.code)) return null;
		throw error;
	}
}
function fixtureContains(directory, cwd) {
	return cwd === directory || cwd.startsWith(`${directory}/`);
}
function fixtureCensus(directory) {
	return fs
		.readdirSync("/proc")
		.filter((pid) => /^\d+$/.test(pid))
		.flatMap((pid) => {
			// Read cwd first: other users' proc entries need no identity inspection.
			let cwd;
			try {
				cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
			} catch (error) {
				if (["ENOENT", "ESRCH", "EACCES"].includes(error.code)) return [];
				throw error;
			}
			if (!fixtureContains(directory, cwd)) return [];
			const record = fixtureProcess(pid);
			return record && fixtureContains(directory, record.cwd) ? [record] : [];
		});
}

async function lockCanaryReady(canary, readiness) {
	let output = "";
	let failure;
	const capture = (bytes) => {
		output = (output + stripVTControlCharacters(String(bytes))).slice(-1024);
	};
	const failed = (error) => {
		failure = error;
	};
	canary.stdout.on("data", capture);
	canary.on("error", failed);
	try {
		await readiness.wait(() => {
			if (failure)
				throw new Error(`Canary failed before readiness: ${failure.code}`);
			if (canary.exitCode !== null || canary.signalCode !== null)
				throw new Error(
					`Canary exited before readiness: status=${canary.exitCode}, signal=${canary.signalCode ?? "none"}`,
				);
			return output.includes("ready");
		}, "unrelated canary ready");
	} finally {
		canary.stdout.off("data", capture);
		canary.off("error", failed);
	}
}

test("lock fixture canary readiness detects early exit without output", async (t) => {
	const readiness = lockFixtureReadiness();
	const canary = spawn(process.execPath, ["-e", "process.exit(37)"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let closed = false;
	const done = once(canary, "close").then((result) => {
		closed = true;
		return result;
	});
	t.after(async () => {
		if (canary.exitCode === null && canary.signalCode === null)
			canary.kill("SIGKILL");
		assert.ok(await fixtureStopped(() => closed), "early-exit canary closes");
		await done;
	});
	let outcome;
	lockCanaryReady(canary, readiness).then(
		() => {
			outcome = "ready";
		},
		(error) => {
			outcome = error;
		},
	);
	assert.ok(
		await fixtureStopped(() => closed),
		"real canary exits without a readiness marker",
	);
	assert.deepEqual(await done, [37, null]);
	assert.ok(
		await fixtureStopped(() => outcome !== undefined),
		"canary readiness must settle after premature exit",
	);
	assert.ok(outcome instanceof Error);
	assert.match(
		outcome.message,
		/Canary exited before readiness: status=37, signal=none/,
	);
	assert.equal(canary.exitCode, 37);
	assert.equal(canary.signalCode, null);
});

test("lock fixture preserves owned files when verified cleanup fails", async (t) => {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-lock-retention-"),
	);
	const fixture = path.join(directory, "fixture");
	const destination = path.join(directory, "escaped-owned-child");
	fs.mkdirSync(fixture);
	fs.mkdirSync(destination);
	const evidence = path.join(fixture, "owned-evidence");
	fs.writeFileSync(evidence, "retain these fixture bytes");
	const readiness = lockFixtureReadiness();
	const children = [];
	// This direct-child teardown deliberately does not use the cleanup under test.
	t.after(async () => {
		for (const record of children) {
			const current = fixtureProcess(record.child.pid);
			if (current) {
				assert.equal(current.startTicks, record.identity.startTicks);
				assert.equal(current.group, record.identity.group);
				record.child.kill("SIGTERM");
			}
			assert.ok(
				await fixtureStopped(() => record.closed),
				"independent owned child closure",
			);
			assert.deepEqual(await record.done, [null, "SIGTERM"]);
		}
		fs.rmSync(directory, { recursive: true, force: true });
	});
	const start = (cwd, code, args = []) => {
		const child = spawn(process.execPath, ["-e", code, ...args], {
			cwd,
			detached: true,
			stdio: "ignore",
		});
		const record = {
			child,
			identity: fixtureProcess(child.pid),
			closed: false,
		};
		record.done = once(child, "close").then((result) => {
			record.closed = true;
			return result;
		});
		children.push(record);
		return record;
	};
	const runner = start(import.meta.dirname, "setInterval(()=>{},1000)");
	const escaped = start(
		fixture,
		`const fs=require('fs'),path=require('path');const [fixture,destination]=process.argv.slice(1);
fs.writeFileSync(path.join(fixture,'ready'),'yes');
const timer=setInterval(()=>{if(fs.existsSync(path.join(fixture,'move'))){process.chdir(destination);fs.writeFileSync(path.join(destination,'moved'),'yes');clearInterval(timer);}},10);
setInterval(()=>{},1000);`,
		[fixture, destination],
	);
	await readiness.wait(() => {
		assert.equal(escaped.child.exitCode, null);
		assert.equal(escaped.child.signalCode, null);
		return fs.existsSync(path.join(fixture, "ready"));
	}, "owned child ready before retention scenario");
	assert.ok(fixtureCensus(fixture).some((p) => p.pid === escaped.child.pid));
	await assert.rejects(
		emergencyLockFixtureCleanup({
			runner: runner.child,
			runnerIdentity: runner.identity,
			done: runner.done,
			directory: fixture,
			beforeRunnerStop: async () => {
				// Moving after the first census makes the captured cwd identity stale.
				// Cleanup must reject rather than signal outside verified ownership.
				fs.writeFileSync(path.join(fixture, "move"), "yes");
				await readiness.wait(
					() => fs.existsSync(path.join(destination, "moved")),
					"owned child moved after initial census",
				);
			},
		}),
		/Owned fixture groups did not stop; preserving fixture files/,
	);
	assert.equal(
		fs.existsSync(evidence),
		true,
		"failed cleanup retains owned files before safety teardown",
	);
	assert.equal(fs.readFileSync(evidence, "utf8"), "retain these fixture bytes");
	assert.ok(
		await fixtureStopped(() => runner.closed),
		"terminated runner pipes close",
	);
	assert.equal(runner.closed, true);
	assert.deepEqual(await runner.done, [null, "SIGTERM"]);
	assert.equal(escaped.closed, false);
	assert.equal(escaped.child.exitCode, null);
	assert.equal(escaped.child.signalCode, null);
	assert.equal(processGroupRunning(escaped.child.pid), true);
	const survivor = fixtureProcess(escaped.child.pid);
	assert.equal(survivor.startTicks, escaped.identity.startTicks);
	assert.equal(survivor.cwd, destination);
});

for (const scenario of ["missing", "late", "unresponsive"])
	test(`lock fixture emergency cleanup owns detached Make and keeper before ${scenario} report`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-lock-emergency-"),
		);
		const owned = path.join(directory, "fixture");
		const sibling = `${owned}-sibling`;
		fs.mkdirSync(owned);
		fs.mkdirSync(sibling);
		const report = path.join(directory, "report.json");
		const readiness = lockFixtureReadiness({ report });
		let canary, canaryClosed, runner, runnerIdentity, done;
		// Keep mutation/reproduction failures bounded independently of the helper under test.
		t.after(async () => {
			for (const record of fixtureCensus(owned))
				signalFixtureGroup(record, "SIGKILL", owned);
			if (
				runner &&
				runnerIdentity &&
				fixtureProcess(runner.pid)?.startTicks === runnerIdentity.startTicks
			) {
				for (const record of fixtureGroupMembers(runner.pid))
					if (signalFixtureGroup(record, "SIGKILL")) break;
			}
			await observed(
				() =>
					(!runner || !processGroupRunning(runner.pid)) &&
					fixtureCensus(owned).length === 0,
				"regression safety cleanup",
			);
			if (done) await done;
			if (canary) {
				canary.kill("SIGTERM");
				const [status, signal] = await canaryClosed;
				assert.equal(status, null);
				assert.equal(signal, "SIGTERM");
				assert.equal(canary.exitCode, null);
				assert.equal(canary.signalCode, "SIGTERM");
			}
			fs.rmSync(directory, { recursive: true, force: true });
		});
		canary = spawn(
			process.execPath,
			["-e", "console.log('ready');setInterval(()=>{},1000)"],
			{ cwd: sibling, detached: true },
		);
		canaryClosed = once(canary, "close");
		const canaryReady = lockCanaryReady(canary, readiness);
		runner = spawn(
			process.execPath,
			[
				"--test",
				"--test-name-pattern=^lock fixture intentional failure$",
				fileURLToPath(import.meta.url),
			],
			{
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					NODE_OPTIONS: "",
					NODE_TEST_CONTEXT: undefined,
					BOAT_LOCK_CLEANUP_PHASE:
						scenario === "unresponsive" ? "unresponsive" : "sync",
					BOAT_LOCK_CLEANUP_REPORT: report,
					BOAT_LOCK_FIXTURE_DIRECTORY: owned,
					BOAT_LOCK_READY_DEADLINE: String(readiness.deadline),
					BOAT_LOCK_BEFORE_REPORT: scenario === "late" ? "late" : "1",
				},
			},
		);
		runnerIdentity = fixtureProcess(runner.pid);
		done = once(runner, "close");
		runner.stdout.resume();
		runner.stderr.resume();

		await canaryReady;
		await readiness.wait(
			() => fs.existsSync(`${report}.parked`),
			"pre-report detached children barrier",
		);
		assert.equal(fs.existsSync(report), false);
		const before = fixtureCensus(owned);
		assert.ok(
			new Set(before.map((p) => p.group)).size >= 2,
			"detached Make and keeper are active before report",
		);
		const makeGroup = before.find(
			(p) => p.name === "make" && p.pid === p.group,
		)?.group;
		assert.ok(makeGroup, "real Make group must be owned before report");
		if (scenario === "missing") {
			const make = before.find((p) => p.pid === makeGroup);
			assert.equal(
				signalFixtureGroup({ ...make, startTicks: "0" }, "SIGTERM", owned),
				false,
				"changed start identity never authorizes a signal",
			);
			assert.equal(
				signalFixtureGroup(
					{ ...make, group: make.group + 1 },
					"SIGTERM",
					owned,
				),
				false,
				"changed group never authorizes a signal",
			);
			assert.equal(
				signalFixtureGroup(fixtureProcess(canary.pid), "SIGTERM", owned),
				false,
				"sibling-prefix cwd is unrelated",
			);
			assert.equal(
				signalFixtureGroup(fixtureProcess(process.pid), "SIGTERM"),
				false,
				"caller group is forbidden",
			);
			assert.equal(processGroupRunning(makeGroup), true);
		}

		const outcome = await emergencyLockFixtureCleanup({
			runner,
			runnerIdentity,
			done,
			directory: owned,
			beforeRunnerStop: async () => {
				assert.equal(
					fs.existsSync(report),
					false,
					"first census occurs before report",
				);
				assert.equal(
					fs.existsSync(owned),
					true,
					"files survive until groups stop",
				);
				if (scenario === "late") {
					fs.writeFileSync(path.join(owned, "control/publish-report"), "yes");
					await readiness.wait(
						() => fs.existsSync(`${report}.late`),
						"late report and nested detached child",
					);
				}
			},
		});
		const [status, signal] = await done;
		// Node test runner handles SIGTERM and reports a failing test exit.
		assert.equal(status, 1);
		assert.equal(signal, null);
		assert.equal(runner.exitCode, 1);
		assert.equal(runner.signalCode, null);
		assert.deepEqual(outcome.runnerSignals, ["SIGTERM"]);
		assert.equal(fs.existsSync(owned), false);
		if (scenario === "unresponsive") {
			assert.equal(outcome.drainedGroups.includes(makeGroup), false);
			assert.ok(
				outcome.signaled.some(
					(p) => p.group === makeGroup && p.signal === "SIGTERM",
				),
			);
		} else {
			assert.ok(
				outcome.drainedGroups.includes(makeGroup),
				"released Make drains before termination",
			);
			assert.equal(
				outcome.signaled.some((p) => p.group === makeGroup),
				false,
			);
		}
		if (scenario === "late") {
			assert.ok(
				outcome.processes.some(
					(p) => p.cwd === path.join(owned, "worker/scripts"),
				),
				"post-runner census owns child launched after initial census",
			);
			assert.equal(fs.existsSync(report), true);
		}

		assert.deepEqual(
			fixtureCensus(owned),
			[],
			"pre-report owned groups survived runner cleanup",
		);
		assert.equal(canary.exitCode, null);
		assert.equal(canary.signalCode, null);
		assert.equal(canary.kill(0), true);
	});

for (const phase of ["sync", "generate", "collect", "unresponsive"])
	test(`lock fixture cleans up after failure during ${phase} without stopping unrelated processes`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-lock-cleanup-"),
		);
		const report = path.join(directory, "report.json");
		const fixtureDirectory = path.join(directory, "fixture");
		fs.mkdirSync(fixtureDirectory);
		let unrelated, unrelatedClosed, runner, runnerIdentity, done;
		t.after(async () => {
			try {
				if (runner)
					await emergencyLockFixtureCleanup({
						runner,
						runnerIdentity,
						done,
						directory: fixtureDirectory,
					});
			} finally {
				if (unrelated) {
					unrelated.kill("SIGKILL");
					await observed(
						() => unrelated.exitCode !== null || unrelated.signalCode !== null,
						"unrelated process shutdown",
					);
					await unrelatedClosed;
				}
			}
			fs.rmSync(directory, { recursive: true, force: true });
		});
		unrelated = spawn(process.execPath, [
			"-e",
			"console.log('ready');setInterval(()=>{},1000)",
		]);
		unrelatedClosed = once(unrelated, "close");
		let unrelatedReady = false;
		unrelated.stdout.once("data", () => {
			unrelatedReady = true;
		});
		const readiness = lockFixtureReadiness({ report });
		runner = spawn(
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
					BOAT_LOCK_FIXTURE_DIRECTORY: fixtureDirectory,
					BOAT_LOCK_READY_DEADLINE: String(readiness.deadline),
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const output = lockFixtureOutput();
		const capture = output.capture;
		runner.stdout.on("data", capture);
		runner.stderr.on("data", capture);
		runnerIdentity = fixtureProcess(runner.pid);
		let closed = false;
		done = once(runner, "close").then(([status]) => {
			closed = true;
			return status;
		});

		await observed(() => unrelatedReady, "unrelated process ready");
		try {
			await readiness.wait(
				() => fs.existsSync(report) || closed,
				"failure scenario ready",
			);
		} catch (error) {
			const phases = fs.existsSync(`${report}.phases`)
				? fs.readFileSync(`${report}.phases`, "utf8").slice(-8192)
				: "no child phase recorded";
			error.message += `\nChild phases: ${phases}\nChild output: ${output.read()}`;
			throw error;
		}
		assert.equal(fs.existsSync(report), true, output.read());
		await observed(() => closed, `failed ${phase} test exits after cleanup`);
		assert.equal(await done, 1, output.read());
		assert.equal(runner.exitCode, 1, output.read());
		assert.equal(runner.signalCode, null, output.read());
		assert.match(
			output.read(),
			/intentional failure before normal barrier release/,
		);
		const snapshot = JSON.parse(fs.readFileSync(report, "utf8"));
		const result = JSON.parse(fs.readFileSync(`${report}.result`, "utf8"));
		const cleanup = JSON.parse(fs.readFileSync(`${report}.cleanup`, "utf8"));
		if (phase === "unresponsive") {
			assert.equal(result.status, null, result.output);
			assert.equal(result.signal, "SIGTERM", result.output);
			assert.deepEqual(cleanup.commands, { drained: false, signal: "SIGTERM" });
		} else {
			assert.equal(result.status, 0, result.output);
			assert.equal(result.signal, null, result.output);
			assert.deepEqual(cleanup.commands, { drained: true, signal: null });
		}
		assert.deepEqual(cleanup.background, { drained: false, signal: "SIGTERM" });
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

async function developmentCheckout(t, { prepare = true } = {}) {
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
if(argv.includes('down')&&fs.existsSync(path.join(control,'shutdown-hang-cleanup'))){
 const text=fs.readFileSync('/proc/'+process.pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');
 fs.writeFileSync(path.join(control,'shutdown-entered-cleanup'),JSON.stringify({pid:process.pid,startTicks:fields[19],group:Number(fields[2]),session:Number(fields[3]),state:JSON.parse(fs.readFileSync(path.join(process.env.FAKE_SOURCE,'.boat/state.json')))}));
 process.on('SIGTERM',()=>{});while(true)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
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
	if (prepare) {
		const generated = await f.generate();
		assert.equal(generated.status, 0, generated.output);
		const prepared = await normal();
		assert.equal(prepared.status, 0, prepared.output);
	}
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

// Safety cleanup is independent of the controller verdict and never makes a green.
async function shutdownCheckout(t, development = false, fixtureOptions = {}) {
	let f;
	const identities = [];
	const safetySignals = [];
	t.after(async () => {
		if (!f) return;
		for (const name of fs
			.readdirSync(f.control)
			.filter((n) => n.startsWith("shutdown-entered-"))) {
			const record = JSON.parse(fs.readFileSync(path.join(f.control, name)));
			identities.push(record);
			const current = fixtureProcess(record.pid);
			if (current?.startTicks === record.startTicks) {
				safetySignals.push(current);
				process.kill(record.pid, "SIGKILL");
			}
		}
		await observed(
			() =>
				identities.every(
					(p) => fixtureProcess(p.pid)?.startTicks !== p.startTicks,
				),
			"independent shutdown safety disposal",
		);
		t.diagnostic(
			JSON.stringify({
				kind: "independent-test-safety",
				signals: safetySignals,
				identitiesGone: identities.every(
					(p) => fixtureProcess(p.pid)?.startTicks !== p.startTicks,
				),
			}),
		);
	});
	f = development
		? await developmentCheckout(t, { prepare: false })
		: await lockGenerationCheckout(t, fixtureOptions);
	f.local(
		".boat/enrollment.json",
		JSON.stringify({
			...f.json(".boat/enrollment.json"),
			shutdownBudgetMs: 18000,
		}),
	);
	// A fixture keeper stands in for shared cache/daemon resources, not a tunnel.
	// The fixture tunnel is independently owned; preserve the sibling cache/daemon.
	fs.rmSync(path.join(f.control, "transport"), { force: true });
	flag(f, "shutdown-strict");
	return f;
}
async function shutdownResult(t, f, pending) {
	const start = fixtureNow();
	let timer;
	try {
		return await Promise.race([
			pending.done,
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error("independent shutdown wall clock watchdog expired"),
						),
					25000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		const processes = fs
			.readdirSync(f.control)
			.filter((n) => n.startsWith("shutdown-entered-"))
			.map((n) => {
				const record = JSON.parse(fs.readFileSync(path.join(f.control, n)));
				return { phase: n, ...record, surviving: fixtureProcess(record.pid) };
			});
		const evidence = fs.existsSync(
			path.join(f.root, ".boat/shutdown-processes.jsonl"),
		)
			? fs
					.readFileSync(
						path.join(f.root, ".boat/shutdown-processes.jsonl"),
						"utf8",
					)
					.trim()
					.split("\n")
					.map(JSON.parse)
			: [];
		t.diagnostic(
			JSON.stringify({
				elapsedMs: fixtureNow() - start,
				directory: f.directory,
				processes,
				closed: pending.closed,
				evidence,
				state: f.json(".boat/state.json"),
			}),
		);
	}
}
function shutdownDisposed(f, phase) {
	const record = JSON.parse(
		fs.readFileSync(path.join(f.control, "shutdown-entered-" + phase)),
	);
	assert.notEqual(
		fixtureProcess(record.pid)?.startTicks,
		record.startTicks,
		"controller must dispose owned process before test safety cleanup",
	);
	assert.equal(record.state.snapshotRecovery.status, "DIRTY");
	const receipts = fs
		.readFileSync(path.join(f.root, ".boat/shutdown-processes.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.ok(
		receipts.some(
			(r) =>
				r.observed?.some((p) => p.pid === record.pid) &&
				r.unresolved.length === 0,
		),
		"owned cleanup receipt before safety",
	);
}

test("shutdown wall clock initial info hang preserves single stop admission", async (t) => {
	const f = await shutdownCheckout(t);
	flag(f, "shutdown-hang-initial");
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /initial.*deadline/i);
	shutdownDisposed(f, "initial");
	const calls = fs.readFileSync(path.join(f.control, "transport"), "utf8");
	assert.equal(
		calls.split("\n").filter((line) => line.includes('"stop"')).length,
		1,
	);
	assert.equal(f.json(".boat/state.json").runningSince, null);
});

function shutdownCalls(f) {
	return fs.existsSync(path.join(f.control, "transport"))
		? fs
				.readFileSync(path.join(f.control, "transport"), "utf8")
				.trim()
				.split("\n")
				.map(JSON.parse)
		: [];
}
function shutdownLedger(f) {
	const state = f.json(".boat/state.json");
	const mirror = JSON.parse(
		fs.readFileSync(
			path.join(
				f.directory,
				"home/.local/state/wallpaperdb-boat/557/fixture.worker.json",
			),
		),
	);
	assert.deepEqual(mirror, state);
	assert.equal(state.snapshotRecovery.status, "DIRTY");
	assert.equal(state.cleanReceipt, undefined);
	return state;
}
for (const phase of ["retirement", "cleanup"])
	test(`shutdown wall clock hung ${phase} still submits once and preserves intent`, async (t) => {
		const f = await shutdownCheckout(t, phase === "cleanup");
		const state = f.json(".boat/state.json");
		f.local(
			".boat/state.json",
			JSON.stringify({
				...state,
				developmentWanted: true,
				reconciliationPending: true,
			}),
		);
		flag(f, "shutdown-hang-" + phase);
		const result = await shutdownResult(
			t,
			f,
			f.run(phase === "cleanup" ? "stop" : "boat-stop"),
		);
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, new RegExp(phase + ".*deadline", "i"));
		shutdownDisposed(f, phase);
		assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
		const after = shutdownLedger(f);
		assert.equal(after.developmentWanted, true);
		assert.equal(after.reconciliationPending, true);
		assert.equal(after.runningSince, null);
		assert.equal(after.shutdownAttempt.status, "completed-observed");
		const submitted = JSON.parse(
			fs.readFileSync(path.join(f.control, "shutdown-request-state")),
		);
		assert.equal(submitted.shutdownAttempt.status, "submission-uncertain");
	});

test("shutdown wall clock ambiguous submission observes completion without clearing stopping accounting", async (t) => {
	const f = await shutdownCheckout(t);
	const before = f.json(".boat/state.json");
	flag(f, "shutdown-hang-submission");
	flag(f, "pause-stop-completion");
	const pending = f.run("boat-stop");
	const resultPromise = shutdownResult(t, f, pending);
	await observed(
		() => fs.existsSync(path.join(f.control, "stop-completing")),
		"completion inspection after timed out submission",
	);
	assert.equal(f.json(".boat/state.json").runningSince, before.runningSince);
	assert.equal(f.json(".boat/state.json").cost, before.cost);
	assert.equal(
		f.json(".boat/state.json").shutdownAttempt.completion,
		undefined,
	);
	flag(f, "release-stop-completion");
	const result = await resultPromise;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /submission.*deadline/i);
	shutdownDisposed(f, "submission");
	const after = shutdownLedger(f);
	assert.equal(after.runningSince, null);
	assert.equal(after.shutdownAttempt.completion.workerId, "fake-worker");
	assert.equal(after.shutdownAttempt.completion.status, "stopped");
	assert.ok(after.shutdownAttempt.accountingAppliedAt);
	assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
});

test("shutdown wall clock unresolved inspection retains obligation and later observes without resubmission", async (t) => {
	const f = await shutdownCheckout(t);
	const before = f.json(".boat/state.json");
	flag(f, "shutdown-hang-observation");
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /observation.*deadline/i);
	shutdownDisposed(f, "observation");
	let after = shutdownLedger(f);
	assert.equal(after.runningSince, before.runningSince);
	assert.equal(after.cost, before.cost);
	assert.equal(after.shutdownAttempt.completion, undefined);
	fs.rmSync(path.join(f.control, "shutdown-hang-observation"));
	flag(f, "sleep");
	fs.rmSync(path.join(f.control, "stopping"));
	const completed = await shutdownResult(t, f, f.run("boat-stop"));
	assert.equal(completed.status, 0, completed.output);
	after = shutdownLedger(f);
	assert.equal(after.runningSince, null);
	assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
});

for (const failure of ["fail-usage", "shutdown-hang-usage"])
	test(`shutdown wall clock ${failure} preserves completion prior usage and accounting once`, async (t) => {
		const f = await shutdownCheckout(t);
		f.local(".boat/usage.json", '{"prior":"exact bytes"}\n');
		const canary = fixtureProcess(f.json(".boat/state.json").daemon.pid);
		const tunnel = f.json(".boat/cache-tunnel.json");
		flag(f, failure);
		const result = await shutdownResult(t, f, f.run("boat-stop"));
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /Usage after completed stop/);
		if (failure.startsWith("shutdown-hang")) shutdownDisposed(f, "usage");
		const after = shutdownLedger(f);
		assert.equal(after.runningSince, null);
		assert.equal(after.shutdownAttempt.status, "completed-observed");
		assert.equal(
			fs.readFileSync(path.join(f.root, ".boat/usage.json"), "utf8"),
			'{"prior":"exact bytes"}\n',
		);
		assert.notEqual(fixtureProcess(tunnel.pid)?.startTicks, tunnel.startTicks);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/cache-tunnel.json")),
			false,
		);
		assert.deepEqual(
			fixtureProcess(canary.pid),
			canary,
			"separately acquired cache sibling survives",
		);
		fs.rmSync(path.join(f.control, failure));
		const second = await shutdownResult(t, f, f.run("boat-stop"));
		assert.equal(second.status, 0, second.output);
		assert.equal(shutdownLedger(f).cost, after.cost);
		assert.equal(
			shutdownLedger(f).shutdownAttempt.accountingAppliedAt,
			after.shutdownAttempt.accountingAppliedAt,
		);
		assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
	});

test("shutdown wall clock leader exit cannot strand owned pipes or kill sibling canary", async (t) => {
	const f = await shutdownCheckout(t);
	const sibling = fixtureProcess(f.json(".boat/state.json").daemon.pid);
	flag(f, "shutdown-pipe-holder");
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /initial.*deadline/i);
	shutdownDisposed(f, "pipe");
	assert.deepEqual(fixtureProcess(sibling.pid), sibling);
	assert.equal(shutdownLedger(f).runningSince, null);
	assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
});

test("shutdown wall clock live lock contention is bounded without remote effects", async (t) => {
	const f = await shutdownCheckout(t);
	const before = f.json(".boat/state.json");
	const lock = path.join(f.root, ".boat/lifecycle.lock");
	fs.mkdirSync(lock);
	fs.writeFileSync(path.join(lock, "pid"), String(before.daemon.pid));
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Shutdown lock.*deadline/);
	assert.equal(shutdownCalls(f).length, 0);
	assert.deepEqual(f.json(".boat/state.json"), before);
	assert.equal(
		fs.readFileSync(path.join(lock, "pid"), "utf8"),
		String(before.daemon.pid),
	);
	assert.ok(fixtureProcess(before.daemon.pid));
});

test("shutdown wall clock already stopping observes without cleanup or submission", async (t) => {
	const f = await shutdownCheckout(t, true);
	f.local(
		".boat/state.json",
		JSON.stringify({
			...f.json(".boat/state.json"),
			developmentWanted: true,
			reconciliationPending: true,
			runningSince: null,
		}),
	);
	flag(f, "stopping");
	const result = await shutdownResult(t, f, f.run("stop"));
	assert.equal(result.status, 0, result.output);
	assert.match(
		result.output,
		/already stopped or stopping.*physical cleanup.*DIRTY/,
	);
	assert.equal(
		shutdownCalls(f).some((a) => a.includes("ssh") || a.includes("stop")),
		false,
	);
	const state = shutdownLedger(f);
	assert.equal(state.developmentWanted, false);
	assert.equal(state.runningSince, null);
	assert.ok(state.shutdownAttempt.completion);
});

for (const value of [0, -1, 180001, 1.5, "18000"])
	test(`shutdown wall clock rejects invalid budget ${JSON.stringify(value)} before effects`, async (t) => {
		const f = await shutdownCheckout(t);
		f.local(
			".boat/enrollment.json",
			JSON.stringify({
				...f.json(".boat/enrollment.json"),
				shutdownBudgetMs: value,
			}),
		);
		const before = f.json(".boat/state.json");
		const result = await shutdownResult(t, f, f.run("boat-stop"));
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /shutdownBudgetMs/);
		assert.equal(shutdownCalls(f).length, 0);
		assert.deepEqual(f.json(".boat/state.json"), before);
	});

test("shutdown wall clock wrong worker proof retains accounting and refuses submission", async (t) => {
	const f = await shutdownCheckout(t);
	const before = f.json(".boat/state.json");
	fs.writeFileSync(
		path.join(f.control, "provider-info"),
		JSON.stringify({ sandbox: { id: "wrong-worker", state: "stopped" } }),
	);
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /contradictory worker identity/);
	const after = shutdownLedger(f);
	assert.equal(after.runningSince, before.runningSince);
	assert.equal(after.cost, before.cost);
	assert.equal(after.shutdownAttempt.completion, undefined);
	assert.equal(
		shutdownCalls(f).some((a) => a.includes("stop")),
		false,
	);
});

test("shutdown wall clock cumulative pre-stop hangs preserve the submission reserve", async (t) => {
	const f = await shutdownCheckout(t, true);
	for (const phase of ["initial", "retirement", "cleanup"])
		flag(f, "shutdown-hang-" + phase);
	const result = await shutdownResult(t, f, f.run("stop"));
	assert.notEqual(result.status, 0, result.output);
	for (const phase of ["initial", "retirement", "cleanup"])
		shutdownDisposed(f, phase);
	const receipts = fs
		.readFileSync(path.join(f.root, ".boat/shutdown-processes.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	const submission = receipts.find(
		(r) => r.phase === "submission" && r.terminal,
	);
	assert.ok(
		submission.elapsedMs <= 7500,
		`submission completed inside its reserved cutoff: ${submission.elapsedMs}`,
	);
	assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
	assert.equal(shutdownLedger(f).runningSince, null);
});

test("shutdown wall clock settle cleanup shares the budget and preserves desired development", async (t) => {
	const f = await shutdownCheckout(t, true);
	f.local(
		".boat/state.json",
		JSON.stringify({
			...f.json(".boat/state.json"),
			developmentWanted: true,
			reconciliationPending: true,
			runningSince: null,
		}),
	);
	f.env.T3CODE_HOME = path.join(f.directory, "t3");
	fs.mkdirSync(path.join(f.env.T3CODE_HOME, "userdata"), { recursive: true });
	execFileSync("python", [
		"-c",
		`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
c.execute('create table orchestration_v2_projection_threads(payload_json text)')
c.execute('create table orchestration_v2_projection_runs(thread_id text,status text)')
c.execute('insert into orchestration_v2_projection_threads values (?)',(json.dumps({'id':'settled-fixture','worktreePath':sys.argv[2],'settledOverride':'settled'}),))
c.commit()`,
		path.join(f.env.T3CODE_HOME, "userdata/statev2.sqlite"),
		f.root,
	]);
	flag(f, "shutdown-hang-cleanup");
	const result = await shutdownResult(t, f, f.run("boat-settle"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /cleanup.*deadline/i);
	shutdownDisposed(f, "cleanup");
	const calls = shutdownCalls(f);
	assert.equal(calls.filter((a) => a.includes("stop")).length, 1);
	assert.equal(
		calls.filter(
			(a) =>
				a.includes("ssh") && a.at(-1).includes("make BOAT_EXEC=worker 'stop'"),
		).length,
		1,
	);
	const after = shutdownLedger(f);
	assert.equal(after.developmentWanted, true);
	assert.equal(after.reconciliationPending, true);
	assert.equal(after.runningSince, null);
});

test("shutdown wall clock protected cache ownership fails disposal without killing the cache", async (t) => {
	const f = await shutdownCheckout(t);
	const canary = fixtureProcess(f.json(".boat/state.json").daemon.pid);
	const tunnel = { ...f.json(".boat/state.json").daemon, id: "fake-worker" };
	f.local(".boat/cache-tunnel.json", JSON.stringify(tunnel));
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /tunnel ownership unresolved/);
	assert.deepEqual(f.json(".boat/cache-tunnel.json"), tunnel);
	assert.deepEqual(fixtureProcess(canary.pid), canary);
	assert.equal(shutdownLedger(f).runningSince, null);
});

test("shutdown wall clock interrupted accounting charges only through persisted completion", async (t) => {
	const f = await shutdownCheckout(t);
	const observedAt = "2026-10-31T01:00:00.000Z";
	f.local(
		".boat/state.json",
		JSON.stringify({
			...f.json(".boat/state.json"),
			cost: 1,
			runningSince: Date.parse(observedAt) - 3600000,
			shutdownAttempt: {
				id: "interrupted-attempt",
				workerId: "fake-worker",
				status: "completed-observed",
				completion: { workerId: "fake-worker", status: "stopped", observedAt },
			},
		}),
	);
	flag(f, "sleep");
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.equal(result.status, 0, result.output);
	assert.equal(shutdownLedger(f).cost, 1.072);
	assert.equal(
		shutdownLedger(f).shutdownAttempt.completion.observedAt,
		observedAt,
	);
});

test("shutdown wall clock later stopping inspection cannot downgrade completed proof", async (t) => {
	const f = await shutdownCheckout(t);
	flag(f, "fail-usage");
	const first = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(first.status, 0, first.output);
	const before = shutdownLedger(f);
	flag(f, "stopping");
	flag(f, "failed-stop-inspection");
	flag(f, "shutdown-observe-stopping");
	fs.rmSync(path.join(f.control, "stop-observed"));
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	const after = shutdownLedger(f);
	assert.deepEqual(
		after.shutdownAttempt.completion,
		before.shutdownAttempt.completion,
	);
	assert.equal(after.shutdownAttempt.status, "completed-observed");
	assert.equal(after.cost, before.cost);
	assert.equal(after.runningSince, null);
});

test("shutdown wall clock closed output consumer still permits owned compute stop", async (t) => {
	const f = await shutdownCheckout(t);
	flag(f, "shutdown-output");
	flag(f, "shutdown-hang-output");
	const pending = f.run("boat-stop");
	const resultPromise = shutdownResult(t, f, pending);
	await observed(
		() => fs.existsSync(path.join(f.control, "shutdown-entered-output")),
		"controlled retirement output barrier",
	);
	pending.child.stdout.destroy();
	flag(f, "shutdown-release-output");
	const result = await resultPromise;
	assert.equal(
		shutdownCalls(f).filter((a) => a.includes("stop")).length,
		1,
		result.output,
	);
	assert.equal(shutdownLedger(f).runningSince, null);
});

test("shutdown wall clock incomplete live lock publication waits without bypassing ownership", async (t) => {
	const f = await shutdownCheckout(t);
	const before = f.json(".boat/state.json");
	fs.mkdirSync(path.join(f.root, ".boat/lifecycle.lock"));
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Shutdown lock.*deadline/);
	assert.equal(shutdownCalls(f).length, 0);
	assert.deepEqual(f.json(".boat/state.json"), before);
	assert.equal(fs.existsSync(path.join(f.root, ".boat/lifecycle.lock")), true);
});

test("shutdown wall clock aggregate observation expiry retains the unresolved compute obligation", async (t) => {
	const cleanupReport = path.join(
		os.tmpdir(),
		`boat-shutdown-aggregate-${process.pid}-${fixtureNow()}`,
	);
	const f = await shutdownCheckout(t, false, {
		ownPackageGroups: true,
		cleanupReport,
	});
	t.after(() =>
		t.diagnostic(
			JSON.stringify({
				kind: "aggregate-owned-safety",
				file: `${cleanupReport}.cleanup`,
				receipt: JSON.parse(
					fs.readFileSync(`${cleanupReport}.cleanup`, "utf8"),
				),
			}),
		),
	);
	const before = f.json(".boat/state.json"),
		sibling = fixtureProcess(before.daemon.pid);
	flag(f, "shutdown-persistent-stopping");
	const helper = "scripts/lib/boat-shutdown.mjs",
		production = fs.readFileSync(path.join(f.root, helper), "utf8");
	const mutant = process.env.BOAT_SHUTDOWN_AGGREGATE_MUTANT;
	assert.ok(
		!mutant || mutant === "renew",
		"unknown aggregate sensitivity mode",
	);
	if (mutant) {
		// Deliberately broken fixture only: renew the aggregate observation window,
		// preserving the actual production per-call cap and disposal mechanism.
		const remaining = "start + allocation[phase][1] * ratio",
			cutoff = "start + cutoff * ratio";
		assert.equal(production.split(remaining).length, 2);
		assert.equal(production.split(cutoff).length, 2);
		f.local(
			helper,
			production
				.replace(
					remaining,
					'(phase === "observation" ? now() : start) + allocation[phase][1] * ratio',
				)
				.replace(
					cutoff,
					'(phase === "observation" ? now() : start) + cutoff * ratio',
				),
		);
	}
	t.diagnostic(
		JSON.stringify({
			kind: "aggregate-observation-input",
			mode: mutant ?? "production",
			productionHash: createHash("sha256").update(production).digest("hex"),
			fixtureHash: createHash("sha256")
				.update(fs.readFileSync(path.join(f.root, helper)))
				.digest("hex"),
			budgetMs: 18000,
			observationCutoffMs: 16500,
		}),
	);
	const start = fixtureNow(),
		pending = f.run("boat-stop");
	let result;
	try {
		result = await shutdownResult(t, f, pending);
	} finally {
		t.diagnostic(
			JSON.stringify({
				kind: "aggregate-observation-verdict",
				makeIdentity: fixtureProcess(pending.child.pid),
				makeElapsedMs: fixtureNow() - start,
				closed: pending.closed,
				beforeSafety: true,
			}),
		);
	}
	assert.notEqual(result.status, 0, result.output);
	assert.match(
		result.output,
		/Shutdown observation: deadline (exceeded; worker completion unresolved|exhausted before launch)/,
	);
	assert.ok(
		fixtureNow() - start >= 16000,
		"successful stopping must consume the aggregate window",
	);
	assert.ok(
		fixtureNow() - start < 18000,
		"Make must close within the selected fixture bound before safety",
	);
	assert.equal(pending.closed, true);
	const after = shutdownLedger(f);
	for (const key of ["id", "size", "cost", "runningSince"])
		assert.equal(after[key], before[key]);
	assert.equal(after.shutdownAttempt.status, "stopping-observed");
	assert.equal(after.shutdownAttempt.completion, undefined);
	assert.equal(after.shutdownAttempt.accountingAppliedAt, undefined);
	assert.ok(
		after.shutdownAttempt.errors.some(
			(e) => e.includes("observation") && e.includes("deadline"),
		),
	);
	const calls = shutdownCalls(f);
	assert.equal(calls.filter((a) => a.includes("stop")).length, 1);
	assert.equal(
		calls
			.flat()
			.some((a) => ["new", "resume", "delete", "--force"].includes(a)),
		false,
	);
	assert.deepEqual(fixtureProcess(sibling.pid), sibling);
	const receipts = fs
		.readFileSync(path.join(f.root, ".boat/shutdown-processes.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	const observations = receipts.filter(
		(r) => r.phase === "observation" && r.terminal,
	);
	assert.ok(
		observations.length >= 10,
		"repeated successful metadata, not a single hung call",
	);
	assert.ok(
		observations.every(
			(r) =>
				r.terminal.code === 0 &&
				!r.failure &&
				r.pipesClosed &&
				r.unresolved.length === 0,
		),
	);
	assert.ok(
		receipts
			.filter((r) => r.kind === "phase" && r.phase === "observation")
			.every((r) => r.deadlineMs <= 16501),
	);
});

// Ordinary cache has the existing 601 * 500 ms contention allowance. Do not
// substitute a reduced counter/clock: this one public limit check pays that cost.
test("ordinary lock unpublished pid retains ownership through its existing contention limit", async (t) => {
	const f = await lockGenerationCheckout(t);
	const before = f.json(".boat/state.json"),
		server = f.json(".boat/cache-server.json"),
		settings = f.json(".boat/cache.json");
	const keeper = fixtureProcess(server.pid);
	const lock = path.join(f.root, ".boat/lifecycle.lock");
	fs.mkdirSync(lock);
	const start = fixtureNow(),
		pending = f.run("boat-cache");
	let timer;
	let result;
	try {
		result = await Promise.race([
			pending.done,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("independent ordinary lock watchdog expired")),
					310000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		t.diagnostic(
			JSON.stringify({
				kind: "ordinary-lock-limit",
				elapsedMs: fixtureNow() - start,
				closed: pending.closed,
				lockRetained: fs.existsSync(lock),
			}),
		);
	}
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Lifecycle lock timed out/);
	assert.ok(
		fixtureNow() - start >= 300000,
		"preserve the real ordinary allowance",
	);
	assert.ok(
		fixtureNow() - start < 310000,
		"controller must refuse before independent safety",
	);
	assert.equal(pending.closed, true);
	assert.equal(fs.existsSync(lock), true);
	assert.equal(fs.existsSync(path.join(lock, "pid")), false);
	assert.deepEqual(f.json(".boat/state.json"), before);
	assert.deepEqual(f.json(".boat/cache-server.json"), server);
	assert.deepEqual(f.json(".boat/cache.json"), settings);
	assert.deepEqual(fixtureProcess(keeper.pid), keeper);
	assert.equal(fs.existsSync(path.join(f.control, "transport")), false);
});

for (const publication of ["delayed-pid", "release-without-pid"])
	test(`ordinary lock ${publication} contention preserves cache and progresses after release`, async (t) => {
		const f = await lockGenerationCheckout(t);
		const before = f.json(".boat/state.json"),
			server = f.json(".boat/cache-server.json"),
			settings = f.json(".boat/cache.json");
		const keeper = fixtureProcess(server.pid),
			lock = path.join(f.root, ".boat/lifecycle.lock");
		fs.mkdirSync(lock);
		const pending = f.run("boat-cache");
		// Observe the actual ordinary controller in its fixture before publishing.
		await observed(
			() =>
				worktreeProcesses(f.root).some((p) => {
					try {
						return fs
							.readFileSync(`/proc/${p.pid}/cmdline`, "utf8")
							.split("\0")
							.some((a) => a === "scripts/boat.mjs");
					} catch {
						return false;
					}
				}),
			"ordinary cache controller with unpublished ownership",
		);
		assert.equal(pending.closed, false);
		assert.equal(fs.existsSync(lock), true);
		assert.equal(fs.existsSync(path.join(f.control, "transport")), false);
		if (publication === "delayed-pid") {
			const pidFile = path.join(lock, "pid");
			fs.writeFileSync(pidFile, String(keeper.pid));
			fs.utimesSync(pidFile, new Date(0), new Date());
			await observed(
				() => fs.statSync(pidFile).atimeMs > 0,
				"actual published lock pid read",
			);
			assert.equal(pending.closed, false);
			assert.equal(fs.existsSync(lock), true);
		}
		fs.rmSync(lock, { recursive: true });
		const result = await pending.done;
		assert.equal(result.status, 0, result.output);
		assert.deepEqual(f.json(".boat/state.json"), before);
		assert.deepEqual(f.json(".boat/cache-server.json"), server);
		assert.deepEqual(f.json(".boat/cache.json"), settings);
		assert.deepEqual(fixtureProcess(keeper.pid), keeper);
		assert.equal(fs.existsSync(path.join(f.control, "transport")), false);
	});

test("shutdown wall clock captured tunnel session escape remains unresolved before safety cleanup", async (t) => {
	const f = await shutdownCheckout(t);
	const sibling = fixtureProcess(f.json(".boat/state.json").daemon.pid);
	f.local(
		"scripts/shutdown-tunnel.py",
		`import os,sys,time,signal,json
from pathlib import Path
control=Path(os.environ['FAKE_CONTROL'])
if os.fork()==0:
 def escaped(_signal,_frame):
  os.setsid()
  fields=Path('/proc/self/stat').read_text().rsplit(') ',1)[1].split()
  (control/'shutdown-entered-tunnel-escape').write_text(json.dumps({'pid':os.getpid(),'startTicks':fields[19],'group':int(fields[2]),'session':int(fields[3])}))
 signal.signal(signal.SIGTERM,escaped)
 (control/'shutdown-tunnel-child').write_text(str(os.getpid()))
 while not (control/'shutdown-tunnel-retire').exists(): time.sleep(0.01)
 os._exit(0)
while not (control/'shutdown-tunnel-child').exists(): time.sleep(0.01)
print('ready',flush=True)
while True: time.sleep(0.01)
`,
	);
	const local = f.shutdownTunnel();
	await observed(
		() => local.output().includes("ready"),
		"owned tunnel child readiness",
	);
	const leader = fixtureProcess(local.child.pid);
	const child = fixtureProcess(
		Number(fs.readFileSync(path.join(f.control, "shutdown-tunnel-child"))),
	);
	f.local(
		".boat/cache-tunnel.json",
		JSON.stringify({ ...leader, id: "fake-worker" }),
	);
	const result = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /tunnel did not exit.*record retained/);
	const escaped = fixtureProcess(child.pid);
	assert.equal(escaped.startTicks, child.startTicks);
	assert.notEqual(escaped.session, child.session);
	assert.equal(f.json(".boat/cache-tunnel.json").startTicks, leader.startTicks);
	const receipts = fs
		.readFileSync(path.join(f.root, ".boat/shutdown-processes.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.ok(
		receipts.some(
			(r) =>
				r.phase === "tunnel-disposal" &&
				r.unresolved.some((p) => p.pid === child.pid),
		),
	);
	const second = await shutdownResult(t, f, f.run("boat-stop"));
	assert.notEqual(
		second.status,
		0,
		"second Make must retain the captured live escape: " + second.output,
	);
	assert.match(second.output, /tunnel .*record retained/);
	assert.equal(
		fixtureProcess(child.pid)?.startTicks,
		child.startTicks,
		"assert before independent safety",
	);
	const retained = f.json(".boat/cache-tunnel.json");
	assert.ok(
		retained.shutdownOwnership.captured.some(
			(p) => p.pid === child.pid && p.birth === child.startTicks,
		),
	);
	assert.ok(
		retained.shutdownOwnership.unresolved.some(
			(p) => p.pid === child.pid && p.birth === child.startTicks,
		),
	);
	assert.deepEqual(fixtureProcess(sibling.pid), sibling);
	// Release the controlled process normally as the neighboring retirement case.
	flag(f, "shutdown-tunnel-retire");
	await observed(
		() => fixtureProcess(child.pid)?.startTicks !== child.startTicks,
		"controlled tunnel self-retirement",
	);
	const third = await shutdownResult(t, f, f.run("boat-stop"));
	assert.equal(third.status, 0, third.output);
	assert.equal(
		fs.existsSync(path.join(f.root, ".boat/cache-tunnel.json")),
		false,
	);
	// Model PID reuse with an existing sibling and a deliberately stale birth.
	// A birth mismatch is never signalling authority, even if PID still exists.
	retained.shutdownOwnership.captured.push({
		...retained.shutdownOwnership.captured[0],
		pid: sibling.pid,
		birth: String(BigInt(sibling.startTicks) - 1n),
	});
	f.local(".boat/cache-tunnel.json", JSON.stringify(retained));
	const reused = await shutdownResult(t, f, f.run("boat-stop"));
	assert.equal(reused.status, 0, reused.output);
	assert.equal(
		fs.existsSync(path.join(f.root, ".boat/cache-tunnel.json")),
		false,
	);
	assert.deepEqual(fixtureProcess(sibling.pid), sibling);
	assert.equal(shutdownCalls(f).filter((a) => a.includes("stop")).length, 1);
	assert.equal(shutdownLedger(f).runningSince, null);
	// Both failure verdicts precede the normal controlled release. Independent
	// test safety is fallback only and supplies neither failure nor retirement proof.
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
	for (const name of ["scripts/mise-shell.sh", "scripts/boat-shell.mjs"])
		f.local(name, fs.readFileSync(path.join(repository, name)));
	fs.mkdirSync(path.join(f.worker, ".boat"), { recursive: true });
	fs.writeFileSync(
		path.join(f.worker, ".boat/cache.json"),
		JSON.stringify({ api: "http://127.0.0.1:12345", token: "fixture" }),
	);
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
const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json')),tag=journal.entries.at(-1).tag;
const mode=fs.existsSync(path.join(control,'migration-mode'))?fs.readFileSync(path.join(control,'migration-mode'),'utf8'):'';
const snapshot='drizzle/meta/'+tag.split('_')[0]+'_snapshot.json';
if(mode==='incomplete')fs.unlinkSync(snapshot);
if(mode==='orphan')fs.writeFileSync('drizzle/9999_orphan.sql','-- unjournalled');
if(mode==='old-sql')fs.appendFileSync('drizzle/'+journal.entries[0].tag+'.sql','-- rewritten');
if(mode==='old-journal'){journal.entries[0].when+=1;fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(journal));}
if(mode==='chain'){const value=JSON.parse(fs.readFileSync(snapshot));value.prevId='00000000-0000-0000-0000-000000000000';fs.writeFileSync(snapshot,JSON.stringify(value));}
if(mode==='symlink'){fs.unlinkSync(snapshot);fs.symlinkSync(path.join(control,'outside'),snapshot);}
if(mode==='meta-symlink'){fs.renameSync('drizzle/meta',path.join(control,'outside-meta'));fs.symlinkSync(path.join(control,'outside-meta'),'drizzle/meta');}
if(mode==='invalid-path')fs.writeFileSync('drizzle/private.env','not source');
if(mode==='missing-sql')fs.unlinkSync('drizzle/'+tag+'.sql');
if(mode==='unjournalled'){journal.entries.pop();fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(journal));}
if(mode==='timestamp'){journal.entries.at(-1).when=journal.entries.at(-2).when;fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(journal));}
if(mode==='origin-id'){const value=JSON.parse(fs.readFileSync(snapshot));value.id='00000000-0000-0000-0000-000000000000';fs.writeFileSync(snapshot,JSON.stringify(value));}
if(mode==='duplicate-id'){const value=JSON.parse(fs.readFileSync(snapshot));value.id=value.prevId;fs.writeFileSync(snapshot,JSON.stringify(value));}
if(mode==='unsafe-tag'){journal.entries.at(-1).tag='../outside';fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(journal));}
if(mode==='oversized')fs.writeFileSync('drizzle/'+tag+'.sql',Buffer.alloc(8*1024*1024+1,'x'));
if(mode==='multiple-appends'){const value=JSON.parse(fs.readFileSync(snapshot));value.prevId=value.id;value.id='12345678-1234-1234-1234-123456789abc';fs.writeFileSync('drizzle/meta/0019_snapshot.json',JSON.stringify(value));fs.writeFileSync('drizzle/0019_extra.sql','-- second append');journal.entries.push({...journal.entries.at(-1),idx:19,tag:'0019_extra',when:journal.entries.at(-1).when+1});fs.writeFileSync('drizzle/meta/_journal.json',JSON.stringify(journal));}
process.exit(fs.existsSync(path.join(control,'migration-fail'))?23:result.status??1);
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
	assert.equal(
		JSON.parse(remote["apps/asset/drizzle/meta/0000_snapshot.json"]).prevId,
		"00000000-0000-0000-0000-000000000000",
	);
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

async function pausedMigrations(t, phase = "generate") {
	const f = await migrationGenerationCheckout(t);
	flag(f, phase === "generate" ? "migration-pause" : `pause-${phase}`);
	if (phase === "sync") f.local("notes.txt", "force captured upload\n");
	const pending = f.migrations();
	await observed(
		() =>
			fs.existsSync(
				path.join(
					f.control,
					phase === "generate" ? "migration-entered" : `entered-${phase}`,
				),
			),
		`native migration ${phase}`,
	);
	return {
		...f,
		pending,
		release: () =>
			flag(f, phase === "generate" ? "migration-release" : `release-${phase}`),
	};
}
for (const [name, edit] of [
	[
		"schema",
		(f) =>
			f.local("apps/asset/src/db/schema.ts", "// concurrent local schema\n"),
	],
	[
		"schema import addition",
		(f) => f.local("apps/asset/src/db/extra.ts", "export const extra = 1;\n"),
	],
	[
		"schema deletion",
		(f) => fs.unlinkSync(path.join(f.root, "apps/asset/src/db/schema.ts")),
	],
	[
		"config",
		(f) =>
			f.local("apps/asset/drizzle.config.ts", "// concurrent local config\n"),
	],
	[
		"manifest",
		(f) => f.local("apps/asset/package.json", '{"concurrent":true}\n'),
	],
	[
		"dependency",
		(f) => f.local("patches/dependency.patch", "local changed dependency\n"),
	],
	[
		"journal",
		(f) =>
			f.local(
				"apps/asset/drizzle/meta/_journal.json",
				JSON.stringify({
					...f.json("apps/asset/drizzle/meta/_journal.json"),
					local: true,
				}),
			),
	],
	[
		"old SQL",
		(f) =>
			f.local(
				"apps/asset/drizzle/0000_mute_the_professor.sql",
				"-- local SQL\n",
			),
	],
	[
		"old snapshot",
		(f) => f.local("apps/asset/drizzle/meta/0000_snapshot.json", "{}\n"),
	],
	[
		"new output",
		(f) =>
			f.local(
				"apps/asset/drizzle/9999_local.sql",
				"-- local untracked output\n",
			),
	],
	[
		"output deletion",
		(f) =>
			fs.unlinkSync(
				path.join(f.root, "apps/asset/drizzle/meta/0017_snapshot.json"),
			),
	],
])
	test(`native migration return preserves concurrent local ${name}`, async (t) => {
		const f = await pausedMigrations(t);
		edit(f);
		const before = migrationBytes(f.root),
			schema = fs.existsSync(path.join(f.root, "apps/asset/src/db/schema.ts"))
				? fs.readFileSync(path.join(f.root, "apps/asset/src/db/schema.ts"))
				: null;
		f.release();
		const result = await f.pending;
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /proposal retained at|retained evidence at/);
		assert.deepEqual(migrationBytes(f.root), before);
		if (schema)
			assert.deepEqual(
				fs.readFileSync(path.join(f.root, "apps/asset/src/db/schema.ts")),
				schema,
			);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/prepared.json")),
			false,
		);
		const proposal = result.output.match(/proposal retained at ([^\n;]+)/)?.[1];
		assert.ok(proposal, result.output);
		assert.equal(path.relative(f.root, proposal).startsWith(".."), true);
		assert.equal(
			JSON.parse(
				fs.readFileSync(
					path.join(proposal, "apps/asset/drizzle/meta/_journal.json"),
				),
			).entries.length,
			19,
		);
	});

test("migration upload uses captured schema imports and leaves unrelated concurrent edits pending", async (t) => {
	const f = await migrationGenerationCheckout(t);
	const schema = fs.readFileSync(
		path.join(f.root, "apps/asset/src/db/schema.ts"),
		"utf8",
	);
	f.local("apps/asset/src/db/schema.ts", `import './extra';\n${schema}`);
	f.local("apps/asset/src/db/extra.ts", "export const extra = 1;\n");
	flag(f, "pause-sync");
	const pending = f.migrations();
	await observed(
		() => fs.existsSync(path.join(f.control, "entered-sync")),
		"captured migration upload",
	);
	f.local(
		"apps/asset/src/db/extra.ts",
		"throw Error('new local code must not run remotely');\n",
	);
	flag(f, "release-sync");
	const result = await pending;
	assert.notEqual(result.status, 0, result.output);
	assert.match(
		result.output,
		/Local generator inputs or old migration set changed/,
	);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "apps/asset/src/db/extra.ts"), "utf8"),
		"export const extra = 1;\n",
	);
	assert.equal(
		f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
		18,
	);
});

for (const mode of [
	"incomplete",
	"orphan",
	"chain",
	"symlink",
	"meta-symlink",
	"invalid-path",
	"old-sql",
	"old-journal",
	"generator-failure",
	"missing-sql",
	"unjournalled",
	"timestamp",
	"duplicate-id",
	"origin-id",
	"unsafe-tag",
	"oversized",
	"multiple-appends",
	"transfer-failure",
])
	test(`native migration return rejects ${mode} and next public sync restores local outputs`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		fs.writeFileSync(
			path.join(f.control, "outside"),
			"private outside bytes\n",
		);
		if (mode === "generator-failure") flag(f, "migration-fail");
		else if (mode === "transfer-failure") flag(f, "transfer-fail");
		else fs.writeFileSync(path.join(f.control, "migration-mode"), mode);
		const result = await f.migrations();
		if (mode === "origin-id") {
			const proposed = JSON.parse(
				fs.readFileSync(
					path.join(f.worker, "apps/asset/drizzle/meta/0018_snapshot.json"),
				),
			);
			assert.equal(proposed.id, "00000000-0000-0000-0000-000000000000");
			assert.equal(
				proposed.prevId,
				f.json("apps/asset/drizzle/meta/0017_snapshot.json").id,
			);
		}
		assert.notEqual(result.status, 0, result.output);
		if (mode === "origin-id")
			assert.match(result.output, /Inconsistent migration snapshot chain/);
		assert.match(result.output, /proposal retained at|retained evidence at/);
		assert.deepEqual(migrationBytes(f.root), before);
		assert.equal(
			fs.readFileSync(path.join(f.control, "outside"), "utf8"),
			"private outside bytes\n",
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/prepared.json")),
			false,
		);
		const next = await f.run(
			"run",
			"PACKAGE=asset",
			"SCRIPT=dev:configure",
			"BOAT_EXEC=remote",
		).done;
		assert.equal(next.status, 0, next.output);
		assert.deepEqual(migrationBytes(f.worker), before);
	});

test("migration acceptance acknowledges only returned outputs and later sync retains the accepted set", async (t) => {
	const f = await pausedMigrations(t);
	const before = f.json(".boat/manifest.json")["notes.txt"];
	f.local("notes.txt", "pending unrelated local source\n");
	f.release();
	const result = await f.pending;
	assert.equal(result.status, 0, result.output);
	assert.equal(f.json(".boat/manifest.json")["notes.txt"], before);
	const accepted = migrationBytes(f.root);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "notes.txt"), "utf8"),
		"original unrelated source\n",
	);
	const next = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=dev:configure",
		"BOAT_EXEC=remote",
	).done;
	assert.equal(next.status, 0, next.output);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "notes.txt"), "utf8"),
		"pending unrelated local source\n",
	);
	assert.deepEqual(migrationBytes(f.worker), accepted);
});

for (const phase of ["sync", "generate", "collect"])
	test(`daemon sync and both maintained generators serialize through native migration ${phase}`, async (t) => {
		const f = await pausedMigrations(t, phase);
		f.local("notes.txt", "concurrent unrelated edit\n");
		f.daemon();
		const second = f.migrations(),
			lock = f.generate();
		await observed(
			() =>
				fs
					.readdirSync(path.join(f.root, ".boat"))
					.filter((name) => /^command-\d+\.json$/.test(name)).length === 3,
			"overlapping source commands",
		);
		f.release();
		for (const result of await Promise.all([f.pending, second, lock]))
			assert.equal(result.status, 0, result.output);
		const starts = fs
			.readFileSync(path.join(f.control, "migration-starts"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.deepEqual(
			starts.map((j) => j.entries.length),
			[18, 19],
		);
		assert.deepEqual(migrationBytes(f.worker), migrationBytes(f.root));
		assert.equal(
			f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
			19,
		);
	});

// Faults occur inside real filesystem publication in the controller process.
// These controls prove exclusive creation and rollback through public Make.
for (const mode of [
	"link-failure",
	"new-path-conflict",
	"journal-edit",
	"published-edit",
	"commit-failure",
])
	test(`public migration publication rolls back safely on ${mode}`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		const hook = path.join(f.directory, "publication.cjs"),
			report = path.join(f.control, "publication.json");
		fs.writeFileSync(
			hook,
			`
const fs=require('fs'),path=require('path');
const root=${JSON.stringify(f.root)},mode=${JSON.stringify(mode)},report=${JSON.stringify(report)};
const link=fs.linkSync,rename=fs.renameSync;let added=[];
fs.linkSync=function(from,to){
 if(!to.startsWith(root+'/apps/asset/drizzle/'))return link(from,to);
 if(added.length===1&&mode==='link-failure')throw Error('controlled publication I/O failure');
 if(added.length===1&&mode==='new-path-conflict'){fs.writeFileSync(to,'concurrent local new path',{flag:'wx'});fs.writeFileSync(report,JSON.stringify({name:path.relative(root,to),bytes:'concurrent local new path'}));}
 const result=link(from,to);added.push(to);
 if(added.length===2&&mode==='journal-edit'){const name='apps/asset/drizzle/meta/_journal.json',value=JSON.parse(fs.readFileSync(path.join(root,name)));value.localEdit=true;const bytes=JSON.stringify(value);fs.writeFileSync(path.join(root,name),bytes);fs.writeFileSync(report,JSON.stringify({name,bytes}));}
 if(added.length===2&&mode==='published-edit'){fs.writeFileSync(added[0],'local edit of new output');fs.writeFileSync(report,JSON.stringify({name:path.relative(root,added[0]),bytes:'local edit of new output'}));}
 return result;
};
fs.renameSync=function(from,to){if(to===root+'/apps/asset/drizzle/meta/_journal.json'&&mode==='commit-failure')throw Error('controlled journal commit failure');return rename(from,to);};
`,
		);
		f.env.NODE_OPTIONS = `--require=${hook}`;
		const result = await f.migrations();
		assert.notEqual(result.status, 0, result.output);
		const expected = { ...before };
		if (fs.existsSync(report)) {
			const edit = JSON.parse(fs.readFileSync(report));
			expected[edit.name] = edit.bytes;
		}
		assert.deepEqual(migrationBytes(f.root), expected);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/migration-return-pending.json")),
			true,
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/prepared.json")),
			false,
		);
	});

test("journal readers see complete old or new native migration sets throughout publication", async (t) => {
	const f = await migrationGenerationCheckout(t),
		repository = path.resolve(import.meta.dirname, "..");
	const hook = path.join(f.directory, "reader.cjs"),
		observations = path.join(f.control, "readers");
	fs.writeFileSync(
		hook,
		`
const fs=require('fs'),path=require('path');
const root=${JSON.stringify(f.root)},readMigrationFiles=require(${JSON.stringify(path.join(repository, "apps/asset/node_modules/drizzle-orm/migrator.cjs"))}).readMigrationFiles;
function observe(){const result=readMigrationFiles({migrationsFolder:path.join(root,'apps/asset/drizzle')});fs.appendFileSync(${JSON.stringify(observations)},String(result.length)+'\\n');}
const link=fs.linkSync,rename=fs.renameSync;
fs.linkSync=function(from,to){const result=link(from,to);if(to.startsWith(root+'/apps/asset/drizzle/'))observe();return result;};
fs.renameSync=function(from,to){if(to===root+'/apps/asset/drizzle/meta/_journal.json')observe();const result=rename(from,to);if(to===root+'/apps/asset/drizzle/meta/_journal.json')observe();return result;};
`,
	);
	f.env.NODE_OPTIONS = `--require=${hook}`;
	const result = await f.migrations();
	assert.equal(result.status, 0, result.output);
	assert.deepEqual(
		fs.readFileSync(observations, "utf8").trim().split("\n").map(Number),
		[18, 18, 18, 19],
	);
});

for (const kind of ["schema-link", "schema-parent-link", "output-link"])
	test(`public migration generation rejects local ${kind} without following it`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		const outside = path.join(f.control, "outside-source");
		fs.mkdirSync(outside);
		fs.writeFileSync(
			path.join(outside, "schema.ts"),
			"throw Error('outside input must not execute');\n",
		);
		if (kind === "schema-parent-link") {
			fs.renameSync(
				path.join(f.root, "apps/asset/src/db"),
				path.join(f.root, "apps/asset/src/old-db"),
			);
			fs.symlinkSync(outside, path.join(f.root, "apps/asset/src/db"));
		} else {
			const name =
				kind === "schema-link"
					? "apps/asset/src/db/schema.ts"
					: "apps/asset/drizzle/meta/0017_snapshot.json";
			fs.unlinkSync(path.join(f.root, name));
			fs.symlinkSync(path.join(outside, "schema.ts"), path.join(f.root, name));
		}
		const initial = migrationBytes(f.root);
		const result = await f.migrations();
		assert.notEqual(result.status, 0, result.output);
		assert.deepEqual(migrationBytes(f.root), initial);
		assert.equal(
			fs.existsSync(path.join(f.control, "migration-entered")),
			false,
		);
		assert.equal(
			fs.readFileSync(path.join(outside, "schema.ts"), "utf8"),
			"throw Error('outside input must not execute');\n",
		);
		if (kind !== "output-link")
			assert.deepEqual(migrationBytes(f.root), before);
	});

for (const mode of ["framed", "unsafe-transfer", "duplicate-transfer"])
	test(`public migration collection rejects ${mode} without extracting worker paths`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		const transport = path.join(f.root, ".mise/boat/boat");
		if (mode === "framed") flag(f, "framed");
		else
			fs.writeFileSync(
				transport,
				fs.readFileSync(transport, "utf8").replace(
					"if(command.includes('base64 -w0')||command.includes('collect-migrations')){",
					`
if(command.includes('collect-migrations')){
 const records=JSON.parse(cp.execFileSync('bash',['-c',command],{env:process.env,maxBuffer:48*1024*1024}));
 if(${JSON.stringify(mode)}==='duplicate-transfer')records.push({...records[0]});
 else records.push({...records[0],name:'../outside'});
 return process.stdout.write(JSON.stringify(records),()=>process.exit(0));
}
if(command.includes('base64 -w0')||command.includes('collect-migrations')){`,
				),
			);
		const result = await f.migrations();
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /output collection failed/);
		assert.deepEqual(migrationBytes(f.root), before);
		if (mode === "unsafe-transfer") {
			const failure = result.output.match(
				/Migration generation output collection failed; retained evidence at ([^:\n]+): ([^;\n]+)/,
			);
			assert.ok(failure, result.output);
			// The receiver stages records below <transaction>/proposal. ../outside
			// escapes that proposal directory, not the fixture's outer directory.
			const escapedDestination = path.join(failure[1], "outside");
			assert.deepEqual(
				{
					reason: failure[2],
					escapedDestinationExists: fs.existsSync(escapedDestination),
				},
				{
					reason: "Invalid migration transfer path",
					escapedDestinationExists: false,
				},
			);
		}
	});

test("native Drizzle zero-exit schema exception fails without accepting an unchanged tree", async (t) => {
	const f = await migrationGenerationCheckout(t),
		before = migrationBytes(f.root);
	f.local(
		"apps/asset/src/db/schema.ts",
		"throw new Error('controlled invalid schema');\n",
	);
	const result = await f.migrations();
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /controlled invalid schema/);
	assert.match(result.output, /Drizzle did not confirm successful generation/);
	assert.deepEqual(migrationBytes(f.root), before);
});

test("uncollected remote proposal is retained before restoration and retention failure blocks destructive repair", async (t) => {
	const f = await migrationGenerationCheckout(t),
		before = migrationBytes(f.root);
	flag(f, "transfer-fail");
	const generated = await f.migrations();
	assert.notEqual(generated.status, 0, generated.output);
	const proposal = migrationBytes(f.worker);
	const transport = path.join(f.root, ".mise/boat/boat");
	fs.writeFileSync(
		transport,
		fs
			.readFileSync(transport, "utf8")
			.replace(
				"const command=argv.at(-1)",
				"if(argv.at(-1).includes('retain-migrations')&&fs.existsSync(path.join(control,'retain-fail')))process.exit(67);\nconst command=argv.at(-1)",
			),
	);
	flag(f, "retain-fail");
	const failed = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=dev:configure",
		"BOAT_EXEC=remote",
	).done;
	assert.notEqual(failed.status, 0, failed.output);
	assert.deepEqual(migrationBytes(f.worker), proposal);
	assert.deepEqual(migrationBytes(f.root), before);
	fs.unlinkSync(path.join(f.control, "retain-fail"));
	const marker = f.json(".boat/migration-return-pending.json");
	const restored = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=dev:configure",
		"BOAT_EXEC=remote",
	).done;
	assert.equal(restored.status, 0, restored.output);
	assert.deepEqual(migrationBytes(f.worker), before);
	const retained = path.join(
		f.worker,
		".boat/source-proposals",
		marker.id,
		"drizzle",
	);
	assert.equal(
		JSON.parse(fs.readFileSync(path.join(retained, "meta/_journal.json")))
			.entries.length,
		19,
	);
	for (const [name, bytes] of Object.entries(proposal))
		assert.equal(
			fs.readFileSync(
				path.join(retained, name.slice("apps/asset/drizzle/".length)),
				"utf8",
			),
			bytes,
		);
});

async function crashMigrationPublication(f, phase) {
	const hook = path.join(f.directory, "crash.cjs");
	fs.writeFileSync(
		hook,
		`
const fs=require('fs'),root=${JSON.stringify(f.root)},flag=${JSON.stringify(path.join(f.control, "crashed"))};
let count=0;const link=fs.linkSync,rename=fs.renameSync;
function crash(){if(fs.existsSync(flag))return;fs.writeFileSync(flag,'yes');process.kill(process.pid,'SIGKILL');}
fs.linkSync=function(from,to){const result=link(from,to);if(to.startsWith(root+'/apps/asset/drizzle/')){count++;if(count===${phase === "first-addition" ? 1 : phase === "second-addition" ? 2 : -1})crash();}return result;};
fs.renameSync=function(from,to){const result=rename(from,to);if(to===root+'/apps/asset/drizzle/meta/_journal.json'&&${phase === "journal-commit"})crash();return result;};
`,
	);
	f.env.NODE_OPTIONS = `--require=${hook}`;
	const killed = await f.migrations();
	assert.notEqual(killed.status, 0, killed.output);
	delete f.env.NODE_OPTIONS;
	assert.equal(fs.existsSync(path.join(f.control, "crashed")), true);
	return f.json(".boat/migration-publication.json");
}

for (const phase of ["first-addition", "second-addition", "journal-commit"])
	test(`next public Make recovers a controller killed after ${phase} before consuming snapshots`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		await crashMigrationPublication(f, phase);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
			true,
		);
		const next = await f.run(
			"run",
			"PACKAGE=asset",
			"SCRIPT=dev:configure",
			"BOAT_EXEC=remote",
		).done;
		assert.equal(next.status, 0, next.output);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
			false,
		);
		if (phase !== "journal-commit")
			assert.deepEqual(migrationBytes(f.root), before);
		else
			assert.equal(
				f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
				19,
			);
		assert.deepEqual(migrationBytes(f.worker), migrationBytes(f.root));
		const again = await f.migrations();
		assert.equal(again.status, 0, again.output);
		assert.equal(
			f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
			19,
		);
	});

for (const phase of ["first-addition", "second-addition", "journal-commit"])
	test(`first public generation after ${phase} crash recovers before capture and retains subsequent edits`, async (t) => {
		const f = await migrationGenerationCheckout(t);
		const before = migrationBytes(f.root);
		const intent = await crashMigrationPublication(f, phase);
		const remoteProposal = migrationBytes(f.worker);
		const marker = f.json(".boat/migration-return-pending.json");
		const committed = phase === "journal-commit";
		assert.equal(
			f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
			committed ? 19 : 18,
		);
		assert.equal(
			fs.existsSync(path.join(f.root, intent.additions[0].name)),
			true,
			"pre-commit cases must contain an owned orphan before recovery",
		);
		const schema =
			fs.readFileSync(
				path.join(f.root, "apps/asset/src/db/schema.ts"),
				"utf8",
			) +
			"\nexport const postCrashRecords = pgTable('post_crash_records', {id: text('id').primaryKey()});\n";
		f.local("apps/asset/src/db/schema.ts", schema);
		f.local("notes.txt", "post-crash unrelated local edit\n");
		// Generation is the FIRST command after controller death. No normal sync
		// is allowed to repair the output set before this captures its baseline.
		const result = await f.migrations();
		assert.equal(result.status, 0, result.output);
		assert.match(result.output, /Your SQL migration file/);
		const accepted = migrationBytes(f.root);
		assert.deepEqual(migrationBytes(f.worker), accepted);
		const journal = f.json("apps/asset/drizzle/meta/_journal.json");
		assert.equal(journal.entries.length, committed ? 20 : 19);
		assert.match(
			accepted[`apps/asset/drizzle/${journal.entries.at(-1).tag}.sql`],
			/CREATE TABLE "post_crash_records"/,
		);
		for (const [name, bytes] of Object.entries(
			committed ? remoteProposal : before,
		))
			if (!name.endsWith("/_journal.json"))
				assert.equal(
					accepted[name],
					bytes,
					`preserve previously committed output ${name}`,
				);
		const manifest = f.json(".boat/manifest.json"),
			modes = f.json(".boat/source-modes.json");
		for (const [name, bytes] of Object.entries(accepted)) {
			assert.equal(
				manifest[name],
				createHash("sha256").update(bytes).digest("hex"),
			);
			assert.equal(
				modes[name],
				fs.statSync(path.join(f.root, name)).mode & 0o777,
			);
		}
		for (const root of [f.root, f.worker]) {
			assert.equal(
				fs.readFileSync(path.join(root, "apps/asset/src/db/schema.ts"), "utf8"),
				schema,
			);
			assert.equal(
				fs.readFileSync(path.join(root, "notes.txt"), "utf8"),
				"post-crash unrelated local edit\n",
			);
		}
		for (const name of [
			"migration-publication.json",
			"migration-return-pending.json",
			"source-writer.json",
		])
			assert.equal(fs.existsSync(path.join(f.root, ".boat", name)), false);
		assert.equal(fs.existsSync(intent.staging), false);
		assert.equal(
			fs.existsSync(intent.proposal),
			true,
			"retain original crash proposal evidence",
		);
		const retained = path.join(
			f.worker,
			".boat/source-proposals",
			marker.id,
			"drizzle",
		);
		if (!committed)
			for (const [name, bytes] of Object.entries(remoteProposal))
				assert.equal(
					fs.readFileSync(
						path.join(retained, name.slice("apps/asset/drizzle/".length)),
						"utf8",
					),
					bytes,
				);
		else
			assert.equal(
				fs.existsSync(retained),
				false,
				"same-worker committed recovery already owns the accepted set",
			);
	});

for (const kind of ["lock", "migrations"])
	for (const stop of [true, false])
		test(`queued ${kind} generation rechecks ${stop ? "DIRTY stop" : "awake admission"} after taking source ownership`, async (t) => {
			const f = await migrationGenerationCheckout(t);
			await crashMigrationPublication(f, "first-addition");
			f.local("notes.txt", "queued local edit remains authoritative\n");
			f.local(
				".boat/state.json",
				JSON.stringify({
					...f.json(".boat/state.json"),
					developmentWanted: true,
					reconciliationPending: true,
				}),
			);
			const before = migrationBytes(f.root);
			const intent = fs.readFileSync(
				path.join(f.root, ".boat/migration-publication.json"),
			);
			const marker = fs.readFileSync(
				path.join(f.root, ".boat/migration-return-pending.json"),
			);
			const lock = path.join(f.root, ".boat/source.lock");
			fs.rmSync(lock, { recursive: true, force: true });
			fs.mkdirSync(lock);
			fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
			t.after(() => fs.rmSync(lock, { recursive: true, force: true }));
			const leases = new Set(fs.readdirSync(path.join(f.root, ".boat")));
			const pending = kind === "lock" ? f.generate() : f.migrations();
			// A command lease is persisted after ensure completes, before source.lock.
			await observed(
				() =>
					fs
						.readdirSync(path.join(f.root, ".boat"))
						.some(
							(name) => /^command-\d+\.json$/.test(name) && !leases.has(name),
						),
				"queued generation lease after ensure",
			);
			if (stop) {
				const stopped = await f.run("boat-stop").done;
				assert.equal(stopped.status, 0, stopped.output);
				assert.equal(
					f.json(".boat/state.json").snapshotRecovery.status,
					"DIRTY",
				);
			}
			const state = f.json(".boat/state.json");
			const transport = fs.readFileSync(
				path.join(f.control, "transport"),
				"utf8",
			);
			const calls = fs.readFileSync(path.join(f.control, "calls"), "utf8");
			fs.rmSync(lock, { recursive: true });
			const result = await pending;
			assert.equal(result.status === 0, !stop, result.output);
			if (stop) {
				assert.match(result.output, /DIRTY.*snapshot/i);
				assert.equal(
					fs.readFileSync(path.join(f.control, "transport"), "utf8"),
					transport,
					"no upload, preparation or execution after queued admission becomes DIRTY",
				);
				assert.equal(
					fs.readFileSync(path.join(f.control, "calls"), "utf8"),
					calls,
				);
				assert.deepEqual(migrationBytes(f.root), before);
				assert.deepEqual(
					fs.readFileSync(
						path.join(f.root, ".boat/migration-publication.json"),
					),
					intent,
				);
				assert.deepEqual(
					fs.readFileSync(
						path.join(f.root, ".boat/migration-return-pending.json"),
					),
					marker,
				);
				const after = f.json(".boat/state.json");
				assert.equal(after.cost, state.cost);
				assert.equal(after.runningSince, null);
				assert.equal(after.developmentWanted, true);
				assert.equal(after.reconciliationPending, true);
				assert.equal(after.snapshotRecovery.status, "DIRTY");
			} else {
				assert.deepEqual(migrationBytes(f.worker), migrationBytes(f.root));
				assert.equal(
					fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
					false,
				);
				assert.equal(
					fs.existsSync(
						path.join(f.root, ".boat/migration-return-pending.json"),
					),
					false,
				);
				assert.equal(
					f.json(".boat/state.json").snapshotRecovery.status,
					"ACTIVE",
				);
			}
			assert.equal(
				fs.readFileSync(path.join(f.root, "notes.txt"), "utf8"),
				"queued local edit remains authoritative\n",
			);
		});

for (const identity of [
	"same-worker",
	"not_found",
	"expired",
	"unknown-intent",
	"unknown-pending",
])
	test(`committed publication recovery binds delivery to ${identity} ownership on public build`, async (t) => {
		const f = await migrationGenerationCheckout(t);
		const baseline = path.join(f.directory, "fresh-baseline");
		fs.cpSync(f.worker, baseline, { recursive: true });
		const intent = await crashMigrationPublication(f, "journal-commit");
		const accepted = migrationBytes(f.root);
		assert.equal(
			f.json("apps/asset/drizzle/meta/_journal.json").entries.length,
			19,
		);
		const marker = f.json(".boat/migration-return-pending.json");
		if (identity === "unknown-intent") {
			delete intent.workerId;
			f.local(".boat/migration-publication.json", JSON.stringify(intent));
		}
		if (identity === "unknown-pending") {
			delete marker.workerId;
			f.local(".boat/migration-return-pending.json", JSON.stringify(marker));
		}
		const fresh = ["not_found", "expired"].includes(identity);
		const priorWorker = path.join(f.directory, "prior-worker");
		if (fresh) {
			fs.renameSync(f.worker, priorWorker);
			fs.renameSync(baseline, f.worker);
			assert.equal(
				JSON.parse(
					migrationBytes(f.worker)["apps/asset/drizzle/meta/_journal.json"],
				).entries.length,
				18,
			);
			if (identity === "not_found")
				fs.writeFileSync(path.join(f.control, "info-error"), "not_found");
			else
				fs.writeFileSync(
					path.join(f.control, "provider-info"),
					JSON.stringify({
						sandbox: {
							id: "fake-worker",
							state: "archived",
							snapshotAvailable: false,
							dataExpiredAt: new Date(Date.now() - 60000).toISOString(),
						},
					}),
				);
			// Keep the fixture's controlled cache transport connected to the new identity.
			f.local(
				".boat/cache-tunnel.json",
				JSON.stringify({
					...f.json(".boat/cache-tunnel.json"),
					id: "fake-new-worker",
				}),
			);
		}
		const callsBefore = fs
			.readFileSync(path.join(f.control, "transport"), "utf8")
			.trim()
			.split("\n").length;
		const next = await f.run("build", "PACKAGE=asset").done;
		assert.equal(next.status, 0, next.output);
		assert.deepEqual(migrationBytes(f.root), accepted);
		assert.deepEqual(
			migrationBytes(f.worker),
			accepted,
			"recovery must upload accepted source to a worker that did not generate it",
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
			false,
		);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/migration-return-pending.json")),
			false,
		);
		assert.equal(
			fs.existsSync(intent.proposal),
			true,
			"crash evidence remains inspectable",
		);
		const calls = fs
			.readFileSync(path.join(f.control, "transport"), "utf8")
			.trim()
			.split("\n")
			.slice(callsBefore)
			.map((line) => JSON.parse(line));
		const retained = calls.some((argv) =>
			argv.at(-1).includes("retain-migrations"),
		);
		assert.equal(
			retained,
			identity !== "same-worker",
			"only proven same-worker recovery may acknowledge without restoration",
		);
		if (fresh) {
			assert.deepEqual(migrationBytes(priorWorker), accepted);
			assert.equal(
				f.json(".boat/state.json").retiredWorkers.at(-1).id,
				"fake-worker",
			);
		}
	});

test("interrupted publication preserves an edited orphan and blocks further source consumers", async (t) => {
	const f = await migrationGenerationCheckout(t);
	const hook = path.join(f.directory, "crash.cjs");
	fs.writeFileSync(
		hook,
		`const fs=require('fs'),link=fs.linkSync;fs.linkSync=function(from,to){const result=link(from,to);if(to.startsWith(${JSON.stringify(`${f.root}/apps/asset/drizzle/`)}))process.kill(process.pid,'SIGKILL');return result;};`,
	);
	f.env.NODE_OPTIONS = `--require=${hook}`;
	const killed = await f.migrations();
	assert.notEqual(killed.status, 0, killed.output);
	delete f.env.NODE_OPTIONS;
	const intent = f.json(".boat/migration-publication.json"),
		name = intent.additions[0].name;
	f.local(name, "concurrent local orphan edit\n");
	const before = migrationBytes(f.root);
	for (const pending of [
		f.migrations(),
		f.run("run", "PACKAGE=asset", "SCRIPT=dev:configure", "BOAT_EXEC=remote")
			.done,
	]) {
		const result = await pending;
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /recovery conflict/);
	}
	assert.deepEqual(migrationBytes(f.root), before);
	assert.equal(
		fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
		true,
	);
});

test("captured untracked schema helper is a valid native generator input and modes are preserved", async (t) => {
	const f = await migrationGenerationCheckout(t);
	f.local("apps/asset/src/db/helper.ts", "export const harmless = 1;\n");
	f.local(
		"apps/asset/src/db/schema.ts",
		"import './helper';\n" +
			fs.readFileSync(path.join(f.root, "apps/asset/src/db/schema.ts"), "utf8"),
	);
	fs.chmodSync(path.join(f.root, "apps/asset/src/db/helper.ts"), 0o640);
	fs.chmodSync(path.join(f.root, "apps/asset/src/db/schema.ts"), 0o640);
	const result = await f.migrations();
	assert.equal(result.status, 0, result.output);
	assert.equal(
		fs.readFileSync(path.join(f.worker, "apps/asset/src/db/helper.ts"), "utf8"),
		"export const harmless = 1;\n",
	);
	assert.equal(
		fs.statSync(path.join(f.worker, "apps/asset/src/db/helper.ts")).mode &
			0o777,
		0o640,
	);
	const before = Object.fromEntries(
		Object.keys(migrationBytes(f.root)).map((name) => [
			name,
			fs.statSync(path.join(f.root, name)).mtimeMs,
		]),
	);
	const again = await f.migrations();
	assert.equal(again.status, 0, again.output);
	for (const [name, mtime] of Object.entries(before))
		assert.equal(fs.statSync(path.join(f.root, name)).mtimeMs, mtime);
});

test("observed remote schema mutation rejects source return and remains pending for restoration", async (t) => {
	const f = await pausedMigrations(t, "collect"),
		before = migrationBytes(f.root);
	fs.writeFileSync(
		path.join(f.worker, "apps/asset/src/db/schema.ts"),
		"// remote concurrent mutation\n",
	);
	f.release();
	const result = await f.pending;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /Worker generation inputs changed/);
	assert.deepEqual(migrationBytes(f.root), before);
	assert.equal(
		f.json(".boat/manifest.json")["apps/asset/src/db/schema.ts"],
		null,
	);
	const restored = await f.run("build", "PACKAGE=asset").done;
	assert.equal(restored.status, 0, restored.output);
	assert.deepEqual(
		fs.readFileSync(path.join(f.worker, "apps/asset/src/db/schema.ts")),
		fs.readFileSync(path.join(f.root, "apps/asset/src/db/schema.ts")),
	);
});

test("unsupported generator flags fail visibly rather than bypass source return", async (t) => {
	const f = await migrationGenerationCheckout(t);
	const result = await f.run(
		"run",
		"PACKAGE=asset",
		"SCRIPT=db:generate",
		"ARGS=--name=unsupported",
	).done;
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /extra arguments are unsupported/);
	assert.equal(fs.existsSync(path.join(f.control, "migration-entered")), false);
});

for (const mode of [
	"hash",
	"length",
	"truncated",
	"nonregular",
	"absolute",
	"backslash",
])
	test(`public migration return validates transfer ${mode}`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		const transport = path.join(f.root, ".mise/boat/boat");
		fs.writeFileSync(
			transport,
			fs.readFileSync(transport, "utf8").replace(
				"if(command.includes('base64 -w0')||command.includes('collect-migrations')){",
				`
if(command.includes('collect-migrations')){
 const records=JSON.parse(cp.execFileSync('bash',['-c',command],{env:process.env,maxBuffer:48*1024*1024}));
 const mode=${JSON.stringify(mode)},record=records[0];
 if(mode==='hash')record.sha256='0'.repeat(64);
 if(mode==='length')record.size++;
 if(mode==='truncated')record.data=record.data.slice(0,-1);
 if(mode==='nonregular')record.type='hardlink';
 if(mode==='absolute')record.name='/tmp/outside';
 if(mode==='backslash')record.name='apps'+String.fromCharCode(92)+'asset'+String.fromCharCode(92)+'drizzle'+String.fromCharCode(92)+'0018_invalid.sql';
 return process.stdout.write(JSON.stringify(records),()=>process.exit(0));
}
if(command.includes('base64 -w0')||command.includes('collect-migrations')){`,
			),
		);
		const result = await f.migrations();
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /output collection failed/);
		assert.deepEqual(migrationBytes(f.root), before);
	});

test("local ignored output participates independently in the final source comparison", async (t) => {
	const f = await pausedMigrations(t);
	f.local(
		".gitignore",
		fs.readFileSync(path.join(f.root, ".gitignore"), "utf8") +
			"apps/asset/drizzle/ignored*\n",
	);
	const name = "apps/asset/drizzle/ignored.sql";
	f.local(name, "-- local ignored occupant\n");
	assert.equal(
		execFileSync("git", ["check-ignore", name], { cwd: f.root })
			.toString()
			.trim(),
		name,
	);
	const before = migrationBytes(f.root);
	f.release();
	const result = await f.pending;
	assert.notEqual(result.status, 0, result.output);
	assert.match(
		result.output,
		/Invalid migration path: apps\/asset\/drizzle\/ignored.sql/,
	);
	assert.deepEqual(migrationBytes(f.root), before);
});

test("concurrent schema chmod alone rejects migration source acceptance", async (t) => {
	const f = await pausedMigrations(t),
		file = path.join(f.root, "apps/asset/src/db/schema.ts");
	const before = migrationBytes(f.root),
		schema = fs.readFileSync(file),
		oldMode = fs.statSync(file).mode & 0o777;
	const editedMode = oldMode ^ 0o004;
	fs.chmodSync(file, editedMode);
	assert.notEqual(editedMode, oldMode);
	f.release();
	const result = await f.pending;
	assert.notEqual(result.status, 0, result.output);
	assert.match(
		result.output,
		/Local generator inputs or old migration set changed: apps\/asset\/src\/db\/schema.ts/,
	);
	assert.deepEqual(migrationBytes(f.root), before);
	assert.deepEqual(fs.readFileSync(file), schema);
	assert.equal(fs.statSync(file).mode & 0o777, editedMode);
});

test("remote proposal retention rejects a symlinked evidence ancestor before restoration", async (t) => {
	const f = await migrationGenerationCheckout(t);
	flag(f, "transfer-fail");
	const failed = await f.migrations();
	assert.notEqual(failed.status, 0, failed.output);
	const proposal = migrationBytes(f.worker),
		outside = path.join(f.control, "outside-evidence");
	fs.mkdirSync(outside);
	fs.mkdirSync(path.join(f.worker, ".boat"), { recursive: true });
	fs.symlinkSync(outside, path.join(f.worker, ".boat/source-proposals"));
	const next = await f.run("build", "PACKAGE=asset").done;
	assert.notEqual(next.status, 0, next.output);
	assert.deepEqual(fs.readdirSync(outside), []);
	assert.deepEqual(migrationBytes(f.worker), proposal);
});

test("post-commit verification preserves concurrent edits and leaves recovery blocked", async (t) => {
	const f = await migrationGenerationCheckout(t),
		hook = path.join(f.directory, "post-commit.cjs");
	fs.writeFileSync(
		hook,
		`const fs=require('fs'),rename=fs.renameSync,root=${JSON.stringify(f.root)};
fs.renameSync=function(from,to){const result=rename(from,to);if(to===root+'/apps/asset/drizzle/meta/_journal.json'){const journal=JSON.parse(fs.readFileSync(to)),sql=root+'/apps/asset/drizzle/'+journal.entries.at(-1).tag+'.sql';fs.writeFileSync(sql,'-- concurrent post-commit edit');}return result;};`,
	);
	f.env.NODE_OPTIONS = `--require=${hook}`;
	const result = await f.migrations();
	assert.notEqual(result.status, 0, result.output);
	assert.match(result.output, /source verification conflict/);
	const journal = f.json("apps/asset/drizzle/meta/_journal.json");
	assert.equal(journal.entries.length, 19);
	assert.equal(
		fs.readFileSync(
			path.join(
				f.root,
				"apps/asset/drizzle",
				`${journal.entries.at(-1).tag}.sql`,
			),
			"utf8",
		),
		"-- concurrent post-commit edit",
	);
	assert.equal(
		fs.existsSync(path.join(f.root, ".boat/migration-publication.json")),
		true,
	);
	delete f.env.NODE_OPTIONS;
	const next = await f.run("build", "PACKAGE=asset").done;
	assert.notEqual(next.status, 0, next.output);
	assert.match(next.output, /recovery conflict/);
});

test("generation rejects symlinked inputs without reading the outside target", async (t) => {
	const f = await migrationGenerationCheckout(t),
		outside = path.join(f.control, "outside-input"),
		readFlag = path.join(f.control, "outside-read"),
		hook = path.join(f.directory, "read-guard.cjs");
	fs.writeFileSync(outside, "outside bytes must not enter a source snapshot\n");
	const schema = path.join(f.root, "apps/asset/src/db/schema.ts");
	fs.unlinkSync(schema);
	fs.symlinkSync(outside, schema);
	fs.writeFileSync(
		hook,
		`const fs=require('fs'),read=fs.readFileSync;fs.readFileSync=function(file,...args){if(typeof file==='string'){try{if(fs.realpathSync(file)===${JSON.stringify(outside)})fs.writeFileSync(${JSON.stringify(readFlag)},'read');}catch{}}return read.call(fs,file,...args);};`,
	);
	f.env.NODE_OPTIONS = `--require=${hook}`;
	const result = await f.migrations();
	assert.notEqual(result.status, 0, result.output);
	assert.equal(fs.existsSync(readFlag), false);
	assert.equal(fs.readlinkSync(schema), outside);
});

for (const mode of ["missing-terminal", "missing-started", "launcher-failed"])
	test(`source command ownership blocks restoration after ${mode} without terminal proof`, async (t) => {
		const f = await migrationGenerationCheckout(t),
			before = migrationBytes(f.root);
		flag(f, mode);
		const result = await f.migrations();
		assert.notEqual(result.status, 0, result.output);
		assert.match(result.output, /completion is uncertain/);
		const remote = migrationBytes(f.worker);
		assert.deepEqual(migrationBytes(f.root), before);
		assert.equal(
			fs.existsSync(path.join(f.root, ".boat/source-writer.json")),
			true,
		);
		fs.unlinkSync(path.join(f.control, mode));
		for (const pending of [
			f.run("build", "PACKAGE=asset").done,
			f.generate(),
			f.migrations(),
		]) {
			const next = await pending;
			assert.notEqual(next.status, 0, next.output);
			assert.match(next.output, /completion is uncertain/);
		}
		assert.deepEqual(migrationBytes(f.worker), remote);
	});

test("transport loss leaves an independently live remote writer owned and blocks sync plus both generators", async (t) => {
	const f = await migrationGenerationCheckout(t),
		before = migrationBytes(f.root),
		writer = f.writer();
	await observed(
		() => fs.existsSync(path.join(f.control, "writer-entered")),
		"independent API writer ready",
	);
	const writerIdentity = worktreeProcesses(f.root).find(
		(record) => record.pid === writer.child.pid,
	);
	assert.ok(writerIdentity?.startTicks, "writer has an owned process identity");
	const assertWriterRunning = () => {
		assert.equal(writer.child.exitCode, null);
		assert.equal(writer.child.signalCode, null);
		assert.equal(writer.closed, false);
		assert.equal(liveOwnedProcess(f.root, writerIdentity), true);
	};
	flag(f, "stream-loss");
	const lost = await f.migrations();
	assert.notEqual(lost.status, 0, lost.output);
	assert.match(lost.output, /completion is uncertain/);
	await observed(
		() => fs.existsSync(path.join(f.control, "writer-mutated")),
		"API writer outlived failed CLI",
	);
	assertWriterRunning();
	const remote = migrationBytes(f.worker),
		ownership = f.json(".boat/source-writer.json");
	assert.match(ownership.commandId, /^cmd_/);
	assert.equal(ownership.terminal, null);
	for (const next of [
		await f.run("build", "PACKAGE=asset").done,
		await f.generate(),
		await f.migrations(),
	]) {
		assert.notEqual(next.status, 0, next.output);
		assert.match(next.output, /completion is uncertain/);
	}
	const daemon = f.daemon(),
		daemonResult = await daemon.done;
	assert.notEqual(daemonResult.status, 0, daemonResult.output);
	assert.match(daemonResult.output, /completion is uncertain/);
	assertWriterRunning();
	assert.deepEqual(migrationBytes(f.root), before);
	assert.deepEqual(migrationBytes(f.worker), remote);
	assert.equal(
		f.json(".boat/source-writer.json").commandId,
		ownership.commandId,
	);
	flag(f, "writer-release");
	const finished = await writer.done;
	assert.equal(finished.status, 0, finished.output);
	assert.equal(writer.child.signalCode, null);
	assert.equal(writer.closed, true);
	assert.equal(liveOwnedProcess(f.root, writerIdentity), false);
	const stillBlocked = await f.run("build", "PACKAGE=asset").done;
	assert.notEqual(stillBlocked.status, 0, stillBlocked.output);
	assert.match(stillBlocked.output, /completion is uncertain/);
});

for (const name of ["scripts/boat-shell.mjs", "scripts/lib/boat-shutdown.mjs"])
	test(`concurrent maintained execution wrapper ${name} edit rejects migration source acceptance`, async (t) => {
		const f = await pausedMigrations(t);
		const before = migrationBytes(f.root),
			captured = fs.readFileSync(path.join(f.root, name), "utf8"),
			edited = `${captured}\n// concurrent wrapper edit\n`;
		f.local(name, edited);
		f.release();
		const result = await f.pending;
		assert.notEqual(result.status, 0, result.output);
		assert.ok(
			result.output.includes(
				`Local generator inputs or old migration set changed: ${name}`,
			),
			result.output,
		);
		assert.deepEqual(migrationBytes(f.root), before);
		assert.equal(fs.readFileSync(path.join(f.root, name), "utf8"), edited);
		assert.equal(fs.readFileSync(path.join(f.worker, name), "utf8"), captured);
	});

// UNINTEGRATED pending-upgrade repair, awaiting parent review and sequential integration.
// The fixture copies the actual production controller and Make entry point.
function previewProbe(promise, description, ms = 1000) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(description)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

// Evidence belongs to the caller when supplied. Private fallback archives are
// released only after every scenario and the actual cleanup verify successfully.
function pendingPreviewEvidence(
	t,
	supplied = process.env.BOAT_PENDING_UPGRADE_EVIDENCE,
) {
	const owned = !supplied;
	const directory =
		supplied ||
		fs.mkdtempSync(path.join(os.tmpdir(), "boat-pending-preview-evidence-"));
	let started = false;
	let running = 0;
	let failed = false;
	return {
		directory,
		async scenario(verify) {
			started = true;
			running++;
			try {
				return await verify();
			} catch (error) {
				failed = true;
				throw error;
			} finally {
				running--;
			}
		},
		async cleanup(cleanup) {
			try {
				await cleanup();
				if (owned && started && running === 0 && !failed)
					fs.rmSync(directory, { recursive: true });
				else if (owned)
					t.diagnostic(`Pending preview evidence retained at ${directory}`);
			} catch (error) {
				t.diagnostic(`Pending preview evidence retained at ${directory}`);
				throw error;
			}
		},
	};
}

test("pending-preview evidence preserves ownership until cleanup settles", async (t) => {
	const directories = [];
	const diagnostics = [];
	const owner = { diagnostic: (text) => diagnostics.push(text) };
	// These controls own no processes. Their independent cleanup follows every
	// retention assertion and never supplies the archive helper's verdict.
	t.after(() => {
		for (const directory of directories)
			fs.rmSync(directory, { recursive: true, force: true });
	});
	const fallback = pendingPreviewEvidence(owner, "");
	directories.push(fallback.directory);
	assert.equal(
		fixtureContains(
			path.resolve(import.meta.dirname, ".."),
			fallback.directory,
		),
		false,
	);
	assert.equal(fs.statSync(fallback.directory).mode & 0o777, 0o700);
	assert.equal(
		await fallback.scenario(async () => "verified scenario"),
		"verified scenario",
	);
	const receipt = path.join(fallback.directory, "cleanup.json");
	fs.writeFileSync(receipt, "ownership before retirement");
	let release;
	const retirement = new Promise((resolve) => {
		release = resolve;
	});
	const cleaning = fallback.cleanup(async () => {
		await retirement;
		assert.equal(
			fs.readFileSync(receipt, "utf8"),
			"ownership before retirement",
		);
		fs.writeFileSync(receipt, "verified final retirement");
	});
	assert.equal(
		fs.existsSync(receipt),
		true,
		"evidence survives pending cleanup",
	);
	release();
	await cleaning;
	assert.equal(
		fs.existsSync(fallback.directory),
		false,
		"verified fallback is retired",
	);

	const failed = pendingPreviewEvidence(owner, "");
	directories.push(failed.directory);
	await failed.scenario(async () => {});
	const retained = path.join(failed.directory, "cleanup.json");
	const failure = new Error("controlled cleanup rejection");
	await assert.rejects(
		failed.cleanup(async () => {
			fs.writeFileSync(retained, "unexpected survivor receipt");
			throw failure;
		}),
		(error) => error === failure,
	);
	assert.equal(
		fs.readFileSync(retained, "utf8"),
		"unexpected survivor receipt",
	);
	assert.ok(
		diagnostics.includes(
			`Pending preview evidence retained at ${failed.directory}`,
		),
	);

	const caller = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-caller-preview-evidence-"),
	);
	directories.push(caller);
	const supplied = pendingPreviewEvidence(owner, caller);
	assert.equal(supplied.directory, caller);
	const callerReceipt = path.join(caller, "caller.json");
	fs.writeFileSync(callerReceipt, "caller-owned archive");
	await supplied.cleanup(async () => {
		assert.equal(
			fs.readFileSync(callerReceipt, "utf8"),
			"caller-owned archive",
		);
	});
	assert.equal(fs.readFileSync(callerReceipt, "utf8"), "caller-owned archive");
	await assert.rejects(
		supplied.cleanup(async () => {
			throw failure;
		}),
		(error) => error === failure,
	);
	assert.equal(fs.readFileSync(callerReceipt, "utf8"), "caller-owned archive");
});

// Contain intentional assertion failures in child test runs. Their independent
// parent safety cleanup happens only after receipt-retention assertions.
if (process.env.BOAT_PENDING_SCENARIO_CONTROL) {
	test("pending-preview intentional evidence failure", async (t) => {
		const kind = process.env.BOAT_PENDING_SCENARIO_CONTROL;
		assert.ok(["top-level", "nested"].includes(kind));
		const report = process.env.BOAT_PENDING_SCENARIO_REPORT;
		const archive = pendingPreviewEvidence(t);
		return archive.scenario(async () => {
			const f = await pendingUpgradePreview(t, "foreground", archive);
			fs.writeFileSync(
				report,
				JSON.stringify({ archive: archive.directory, fixture: f.directory }),
			);
			t.after(() =>
				fs.writeFileSync(
					`${report}.teardown`,
					JSON.stringify(f.receipts, null, 2),
				),
			);
			const assertion = async () => {
				const client = f.request("/healthy");
				const [response] = await previewProbe(
					once(client, "response"),
					"controlled protocol response missing",
				);
				response.resume();
				await previewProbe(
					once(response, "end"),
					"controlled protocol response incomplete",
				);
				f.receipts.intentionalFailure = {
					kind,
					observedStatus: response.statusCode,
					expectedStatus: 101,
				};
				f.phase(`intentional ${kind} assertion recorded before cleanup`);
				if (kind === "top-level")
					assert.fail("intentional top-level scenario assertion");
				assert.equal(
					response.statusCode,
					101,
					"intentional nested protocol status assertion",
				);
			};
			if (kind === "top-level") await assertion();
			else {
				await t.test("nested protocol assertion", () =>
					archive.scenario(assertion),
				);
				f.receipts.rootContinuedAfterNestedFailure = true;
			}
		});
	});
}

for (const kind of ["top-level", "nested"])
	test(`pending-preview evidence retains failed ${kind} scenario after successful cleanup`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-preview-retention-control-"),
		);
		const report = path.join(directory, "report.json");
		const saved =
			process.env.BOAT_PENDING_UPGRADE_EVIDENCE &&
			path.join(
				process.env.BOAT_PENDING_UPGRADE_EVIDENCE,
				`${kind}-retention-control`,
			);
		if (saved) fs.mkdirSync(saved, { recursive: true });
		let runner, runnerIdentity, done;
		t.after(async () => {
			if (runner) {
				const safety = await emergencyLockFixtureCleanup({
					runner,
					runnerIdentity,
					done,
					directory,
				});
				if (saved)
					fs.writeFileSync(
						path.join(saved, "safety.json"),
						JSON.stringify(safety, null, 2),
					);
			} else fs.rmSync(directory, { recursive: true, force: true });
		});
		runner = spawn(
			process.execPath,
			[
				"--test",
				"--test-name-pattern=^pending-preview intentional evidence failure$",
				fileURLToPath(import.meta.url),
			],
			{
				cwd: directory,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					NODE_TEST_CONTEXT: undefined,
					NODE_OPTIONS: "",
					TMPDIR: directory,
					BOAT_PENDING_UPGRADE_EVIDENCE: undefined,
					BOAT_PENDING_SCENARIO_CONTROL: kind,
					BOAT_PENDING_SCENARIO_REPORT: report,
				},
			},
		);
		runnerIdentity = fixtureProcess(runner.pid);
		const output = lockFixtureOutput();
		runner.stdout.on("data", output.capture);
		runner.stderr.on("data", output.capture);
		let closed = false;
		done = once(runner, "close").then((result) => {
			closed = true;
			return result;
		});
		await observed(
			() => closed,
			"intentional preview failure completed actual cleanup",
		);
		const [status, signal] = await done;
		const metadata = JSON.parse(fs.readFileSync(report, "utf8"));
		const teardown = JSON.parse(fs.readFileSync(`${report}.teardown`, "utf8"));
		const beforeSafety = {
			status,
			signal,
			archive: metadata.archive,
			archiveExists: fs.existsSync(metadata.archive),
			fixtureCensus: fixtureCensus(directory),
			teardown,
		};
		if (saved) {
			fs.writeFileSync(path.join(saved, "runner.log"), output.read());
			fs.writeFileSync(
				path.join(saved, "before-safety.json"),
				JSON.stringify(beforeSafety, null, 2),
			);
			if (beforeSafety.archiveExists)
				fs.cpSync(metadata.archive, path.join(saved, "retained"), {
					recursive: true,
				});
		}
		assert.equal(status, 1, output.read());
		assert.equal(signal, null, output.read());
		assert.match(
			output.read(),
			kind === "top-level"
				? /intentional top-level scenario assertion/
				: /intentional nested protocol status assertion/,
		);
		assert.equal(teardown.fixtureRemoved, true);
		assert.equal(teardown.tunnelTerminated, true);
		assert.deepEqual(teardown.survivingOwnedProcesses, []);
		assert.deepEqual(teardown.survivingCommandGroups, []);
		assert.ok(teardown.processTermination.every((record) => record.terminated));
		assert.deepEqual(
			beforeSafety.fixtureCensus,
			[],
			"real cleanup succeeded before independent safety cleanup",
		);
		if (kind === "nested")
			assert.equal(teardown.rootContinuedAfterNestedFailure, true);
		assert.equal(
			beforeSafety.archiveExists,
			true,
			"failed scenario receipts survive successful cleanup before safety teardown",
		);
		const retained = JSON.parse(
			fs.readFileSync(path.join(metadata.archive, "foreground.json"), "utf8"),
		);
		assert.deepEqual(retained, teardown, "exact final receipt retained");
		assert.deepEqual(retained.intentionalFailure, {
			kind,
			observedStatus: 200,
			expectedStatus: 101,
		});
		assert.match(
			output.read(),
			new RegExp(`Pending preview evidence retained at ${metadata.archive}`),
		);
	});

async function cleanupPendingPreview({
	f,
	cleanups,
	baseCleanup,
	receipts,
	report,
}) {
	let failure;
	for (const cleanup of cleanups.reverse()) {
		if (cleanup === baseCleanup && f) {
			const groups = new Set(f.commands.map((record) => record.child.pid));
			const keeper = f.json(".boat/state.json").daemon;
			groups.add(keeper.pid);
			if (
				fixtureCensus(f.directory).some((record) => !groups.has(record.group))
			) {
				// A detached forward could not be retired. Stop known commands and
				// keeper, but retain its ownership files and directory for diagnosis.
				try {
					await stopLockFixtureChildren(f.commands);
				} catch (error) {
					failure ??= error;
					receipts.preservationCommandCleanupError = error.message;
				}
				// Pipe closure can fail while the detached forward lives. Keeper
				// shutdown still gets its own bounded attempt and final receipt.
				try {
					if (liveOwnedProcess(f.root, keeper))
						signalFixtureGroup(
							fixtureProcess(keeper.pid),
							"SIGTERM",
							f.directory,
						);
					receipts.preservationKeeperTerminated = await fixtureStopped(
						() => !liveOwnedProcess(f.root, keeper),
					);
				} catch (error) {
					failure ??= error;
					receipts.preservationKeeperCleanupError = error.message;
				}
				failure ??= new Error(
					"Detached diagnostic process survived; fixture files retained",
				);
				continue;
			}
		}
		try {
			await cleanup();
		} catch (error) {
			failure ??= error;
		}
	}
	if (f) {
		receipts.fixtureRemoved = !fs.existsSync(f.directory);
		receipts.survivingOwnedProcesses = fixtureCensus(f.directory);
		receipts.processTermination = receipts.processes.map((before) => {
			const after = fixtureProcess(before.pid);
			return {
				...before,
				terminated: !after || after.startTicks !== before.startTicks,
			};
		});
		fs.writeFileSync(`${report}.json`, JSON.stringify(receipts, null, 2));
		assert.ok(
			receipts.processTermination.every((p) => p.terminated),
			"Owned pending-preview process survived; fixture files retained",
		);
		assert.deepEqual(receipts.survivingOwnedProcesses, []);
	}
	if (failure) throw failure;
}

test("pending-upgrade fixture preserves receipts and retires keeper when command pipes cannot close", async (t) => {
	const archive = pendingPreviewEvidence(t);
	const evidence = archive.directory;
	const cleanups = [];
	const report = path.join(evidence, "cleanup-rejection");
	let f,
		siblingDirectory,
		sibling,
		siblingClosed,
		siblingIdentity,
		keeper,
		survivor;
	// Register independent teardown before checkout acquisition can fail.
	t.after(() =>
		archive.cleanup(async () => {
			const failures = [];
			if (f) {
				const groups = new Set();
				for (const identity of fixtureCensus(f.directory)) {
					if (groups.has(identity.group)) continue;
					try {
						if (!liveOwnedProcess(f.root, identity)) continue;
						const signaled = signalFixtureGroup(
							identity,
							"SIGKILL",
							f.directory,
						);
						assert.ok(
							signaled || !liveOwnedProcess(f.root, identity),
							"Live owned group refused safety signal",
						);
						if (!signaled) continue;
						groups.add(identity.group);
						assert.equal(
							await fixtureStopped(() => !processGroupRunning(identity.group)),
							true,
						);
					} catch (error) {
						failures.push(error);
					}
				}
			}
			try {
				if (f)
					assert.deepEqual(
						fixtureCensus(f.directory),
						[],
						"Safety survivors retain ownership files",
					);
				for (const cleanup of cleanups) await cleanup();
			} catch (error) {
				failures.push(error);
			}
			try {
				if (
					siblingIdentity &&
					liveOwnedProcess(siblingDirectory, siblingIdentity)
				)
					assert.equal(
						signalFixtureGroup(siblingIdentity, "SIGTERM", siblingDirectory),
						true,
					);
				if (siblingClosed)
					await previewProbe(
						siblingClosed,
						"independent sibling teardown failed",
					);
				if (siblingDirectory)
					fs.rmSync(siblingDirectory, { recursive: true, force: true });
			} catch (error) {
				failures.push(error);
			}
			fs.writeFileSync(
				`${report}.safety.json`,
				JSON.stringify(
					{
						keeper,
						survivor,
						sibling: siblingIdentity,
						keeperRetired: !keeper || !liveOwnedProcess(f.root, keeper),
						survivorRetired: !survivor || !liveOwnedProcess(f.root, survivor),
						siblingRetired:
							!siblingIdentity ||
							!liveOwnedProcess(siblingDirectory, siblingIdentity),
						fixtureRemoved: !f || !fs.existsSync(f.directory),
						failures: failures.map((error) => error.message),
					},
					null,
					2,
				),
			);
			if (failures.length)
				throw new AggregateError(
					failures,
					"Independent safety teardown failed",
				);
		}),
	);
	return archive.scenario(async () => {
		f = await lockGenerationCheckout({ after: (fn) => cleanups.push(fn) });
		siblingDirectory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-pending-sibling-"),
		);
		sibling = spawn(
			process.execPath,
			["-e", "console.log('ready');setInterval(()=>{},1000)"],
			{
				cwd: siblingDirectory,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		siblingClosed = once(sibling, "close");
		let siblingOutput = "";
		sibling.stdout.on("data", (bytes) => {
			siblingOutput += bytes;
		});
		siblingIdentity = fixtureProcess(sibling.pid);
		keeper = f.json(".boat/state.json").daemon;
		// Independent safety teardown runs after all failure-path assertions, and
		// never supplies the verdict of the cleanup under test.

		await f.readiness.wait(
			() => siblingOutput.includes("ready"),
			"unrelated sibling ready",
		);
		assert.ok(siblingIdentity);
		f.local(
			"cleanup-holder.cjs",
			`const {spawn}=require('child_process');const fs=require('fs');
const child=spawn(process.execPath,['-e',"require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",process.argv[2]],{detached:true,stdio:['ignore',process.stdout,process.stderr]});child.unref();`,
		);
		fs.appendFileSync(
			path.join(f.root, "Makefile"),
			`\npending-cleanup-control:\n\t@${process.execPath} cleanup-holder.cjs ${path.join(f.control, "holder-ready")}\n`,
		);
		const command = f.run(
			"pending-cleanup-control",
			"BOAT_EXEC=local",
			"SHELL=/bin/sh",
			"boat_routed_goals=",
		);
		await f.readiness.wait(
			() =>
				fs.existsSync(path.join(f.control, "holder-ready")) &&
				command.terminal !== null,
			"detached pipe holder outlives command leader",
		);
		survivor = fixtureProcess(
			Number(fs.readFileSync(path.join(f.control, "holder-ready"), "utf8")),
		);
		assert.ok(survivor);
		assert.equal(
			command.closed,
			false,
			"detached child holds command pipes open",
		);
		const receipts = { processes: [fixtureProcess(keeper.pid), survivor] };
		await assert.rejects(
			cleanupPendingPreview({
				f,
				cleanups,
				baseCleanup: cleanups[0],
				receipts,
				report,
			}),
			/Owned pending-preview process survived; fixture files retained/,
		);
		const saved = JSON.parse(fs.readFileSync(`${report}.json`, "utf8"));
		assert.match(
			saved.preservationCommandCleanupError,
			/Owned lock fixture process groups did not exit/,
		);
		assert.equal(saved.preservationKeeperTerminated, true);
		assert.equal(
			liveOwnedProcess(f.root, keeper),
			false,
			"exact keeper retired despite command rejection",
		);
		assert.equal(saved.fixtureRemoved, false);
		assert.equal(fs.existsSync(path.join(f.root, ".boat/state.json")), true);
		assert.ok(
			saved.survivingOwnedProcesses.some(
				(p) => p.pid === survivor.pid && p.startTicks === survivor.startTicks,
			),
		);
		assert.equal(
			saved.processTermination.find((p) => p.pid === keeper.pid).terminated,
			true,
		);
		assert.equal(
			saved.processTermination.find((p) => p.pid === survivor.pid).terminated,
			false,
		);
		assert.equal(
			liveOwnedProcess(siblingDirectory, siblingIdentity),
			true,
			"unrelated sibling protected",
		);
	});
});

async function pendingUpgradePreview(t, mode, archive) {
	const evidence = archive.directory;
	const report = path.join(evidence, mode);
	const cleanups = [];
	const owner = t;
	let baseCleanup;
	t = {
		after: (fn) => {
			baseCleanup ??= fn;
			cleanups.push(fn);
		},
	};
	let f;
	const receipts = { mode, phases: [], processes: [] };
	owner.after(() =>
		archive.cleanup(() =>
			cleanupPendingPreview({ f, cleanups, baseCleanup, receipts, report }),
		),
	);
	f = await lockGenerationCheckout(t);
	receipts.directory = f.directory;
	delete f.env.MAKEFILES;
	delete f.env.GNUMAKEFLAGS;
	const phase = (name) => {
		receipts.phases.push({ name, at: Date.now() });
		fs.writeFileSync(`${report}.json`, JSON.stringify(receipts, null, 2));
	};
	const production = [
		"scripts/boat.mjs",
		"scripts/lib/boat.mjs",
		"Makefile",
		"scripts/boat-route.mk",
	];
	receipts.productionHashes = Object.fromEntries(
		production.map((name) => {
			const bytes = fs.readFileSync(path.join(f.root, name));
			assert.deepEqual(
				bytes,
				fs.readFileSync(path.resolve(import.meta.dirname, "..", name)),
			);
			return [name, createHash("sha256").update(bytes).digest("hex")];
		}),
	);
	const token = createHash("sha256")
		.update(`${f.directory}:${process.hrtime.bigint()}`)
		.digest("hex");
	const authorization = `Bearer ${token}`;
	const sockets = new Set();
	const pending = new Map();
	const upstream = http.createServer((req, res) => {
		if (req.headers.authorization !== authorization) {
			res.writeHead(401);
			res.end("authentication required");
			return;
		}
		if (req.url === "/http-pending") {
			req.resume();
			pending.get(req.url)?.({
				req,
				socket: req.socket,
				closed: once(res, "close"),
			});
			return;
		}
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("authenticated fixture control");
	});
	upstream.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("error", () => {});
		socket.once("close", () => sockets.delete(socket));
	});
	upstream.on("upgrade", (req, socket) => {
		assert.equal(
			req.headers.authorization === authorization,
			true,
			"upgrade authentication forwarded",
		);
		const establish = () => {
			const accept = createHash("sha1")
				.update(
					req.headers["sec-websocket-key"] +
						"258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
				)
				.digest("base64");
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: boat-diagnostic\r\n\r\n`,
			);
			let buffered = Buffer.alloc(0);
			socket.on("data", (bytes) => {
				buffered = Buffer.concat([buffered, bytes]);
				while (buffered.length >= 6) {
					const length = buffered[1] & 127;
					if (buffered.length < length + 6) return;
					assert.equal(buffered[0], 0x81);
					assert.equal(buffered[1] & 128, 128);
					const mask = buffered.subarray(2, 6);
					const payload = Buffer.from(buffered.subarray(6, length + 6));
					for (let i = 0; i < length; i++) payload[i] ^= mask[i % 4];
					buffered = buffered.subarray(length + 6);
					const reply = Buffer.from(`ack:${payload.toString()}`);
					const frame = Buffer.concat([
						Buffer.from([0x81, reply.length]),
						reply,
					]);
					if (payload.toString() === "healthy-completion") socket.end(frame);
					else socket.write(frame);
				}
			});
		};
		if (req.url.startsWith("/ws-pending") || req.url === "/ws-late") {
			// Consume raw upgraded bytes and acknowledge EOF, as qualified by the
			// retained SAME-forwarder bypass. Never manufacture closure in cleanup.
			socket.once("end", () => socket.end());
			socket.resume();
			pending.get(req.url)?.({
				req,
				socket,
				establish,
				closed: new Promise((resolve) => socket.once("close", resolve)),
			});
			return;
		}
		if (req.url === "/ws-upstream-error") {
			socket.resetAndDestroy();
			return;
		}
		establish();
	});
	t.after(async () => {
		for (const socket of sockets) socket.destroy();
		await previewProbe(
			new Promise((resolve) => upstream.close(resolve)),
			"upstream cleanup did not complete",
		);
	});
	upstream.listen(0, "127.0.0.1");
	await previewProbe(
		once(upstream, "listening"),
		"controlled upstream did not listen",
	);
	const upstreamPort = upstream.address().port;
	// Reserve an OS-selected private forward port. Its ingress pair is checked
	// once, without a fallback port or retry if anything else owns it.
	const net = await import("node:net");
	const reservation = net.createServer();
	reservation.listen(0, "127.0.0.1");
	await previewProbe(
		once(reservation, "listening"),
		"private port reservation failed",
	);
	const privatePort = reservation.address().port;
	const port = privatePort - 20000;
	assert.ok(port > 0 && port < 45536);
	await previewProbe(
		new Promise((resolve) => reservation.close(resolve)),
		"port reservation cleanup failed",
	);
	f.local(".worktree", `INGRESS_PORT=${port}\n`);
	const authority = f.json("apps/asset/.authority.json");
	authority.identityProviders.clerk.authorizedParties = [
		`http://localhost:${port}`,
		`http://127.0.0.1:${port}`,
	];
	f.local("apps/asset/.authority.json", JSON.stringify(authority));
	const transport = path.join(f.root, ".mise/boat/boat");
	fs.writeFileSync(
		transport,
		`#!${process.execPath}
const fs=require('fs'),path=require('path'),argv=process.argv.slice(2),control=process.env.FAKE_CONTROL;
fs.appendFileSync(path.join(control,'transport'),JSON.stringify(argv)+'\\n');
function shutdownHold(phase){
 if(!fs.existsSync(path.join(control,'shutdown-hang-'+phase)))return;
 const text=fs.readFileSync('/proc/'+process.pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');
 fs.writeFileSync(path.join(control,'shutdown-entered-'+phase),JSON.stringify({pid:process.pid,startTicks:fields[19],group:Number(fields[2]),session:Number(fields[3]),state:JSON.parse(fs.readFileSync('.boat/state.json'))}));
 process.on('SIGTERM',()=>{});
 while(!fs.existsSync(path.join(control,'shutdown-release-'+phase)))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
}
if(argv.includes('info'))shutdownHold(fs.existsSync(path.join(control,'stopping'))?'observation':'initial');
if(argv.includes('ssh')&&argv.at(-1).includes('sudo -n'))shutdownHold('retirement');
if(argv.includes('usage'))shutdownHold('usage');

if(!argv.includes('fake-worker'))throw Error('unexpected synthetic worker identity');
if(argv.includes('info')){console.log(JSON.stringify({state:'ready'}));process.exit(0);}
if(argv.includes('--status')){console.log(JSON.stringify({running:true,stdout:'Watch enabled'}));process.exit(0);}
if(argv.includes('--detach')){console.log(JSON.stringify({processId:557}));process.exit(0);}
if(argv.includes('forward')){
 if(argv.includes('--reverse'))throw Error('unexpected reverse forward');
 if(argv[argv.indexOf('--local')+1]!==${JSON.stringify(String(privatePort))}||argv[argv.indexOf('--remote')+1]!==${JSON.stringify(String(port))})throw Error('unexpected forward ports');
 const net=require('net'),peers=new Set();let sequence=0;
 const trace=(connection,event,detail={})=>fs.appendFileSync(path.join(control,'forward-events'),JSON.stringify({pid:process.pid,connection,event,at:Date.now(),...detail})+'\\n');
 const server=net.createServer(socket=>{const connection=++sequence;trace(connection,'downstream-connected',{remotePort:socket.remotePort});const peer=net.connect(${upstreamPort},'127.0.0.1');peer.on('connect',()=>trace(connection,'upstream-connected',{localPort:peer.localPort}));peers.add(socket);peers.add(peer);for(const [role,p] of [['downstream',socket],['upstream',peer]]){p.on('error',()=>{});p.on('end',()=>trace(connection,role+'-end'));p.on('close',()=>{trace(connection,role+'-close');peers.delete(p);socket.destroy();peer.destroy();});}socket.pipe(peer).pipe(socket);});
 server.listen(${privatePort},'127.0.0.1',()=>fs.writeFileSync(path.join(control,'forward-ready'),String(process.pid)));
 process.on('SIGTERM',()=>{for(const p of peers)p.destroy();server.close(()=>process.exit(0));});
}else if(argv.includes('ssh')){
 const command=argv.at(-1);
 const allowed=command.startsWith('mkdir -p /home/user/wallpaperdb;') || command.startsWith('cd /home/user/wallpaperdb && tar -xzf -') || command.includes('mise trust && make install BOAT_EXEC=worker') || command.includes('chmod a+rx infra/postgres/init') || command.includes('SCRIPT=boat:ready') || command.includes('--input-type=module -') || command.includes('cat > /home/user/wallpaperdb/.boat/cache.json');
 if(!allowed)throw Error('unexpected controlled SSH operation');
 // Consume source/archive bytes but never execute a supplied shell string.
 process.stdin.resume();
}else throw Error('unexpected controlled Boat operation');
`,
	);
	receipts.controlledTransportHash = createHash("sha256")
		.update(fs.readFileSync(transport))
		.digest("hex");
	fs.copyFileSync(transport, `${report}.controlled-boat.cjs`);
	// Block PATH-based external escape even if a later controller path changes.
	for (const name of ["boat", "ssh", "curl", "wget"])
		fs.writeFileSync(
			path.join(f.directory, "home/.local/bin", name),
			"#!/bin/sh\necho 'forbidden external diagnostic operation' >&2\nexit 96\n",
			{ mode: 0o755 },
		);
	if (mode === "foreground") {
		const keeper = f.json(".boat/state.json").daemon;
		f.local(
			`.boat/command-${keeper.pid}.json`,
			JSON.stringify({ ...keeper, development: true }),
		);
	}
	const command = f.run(
		"boat-preview",
		"BOAT_EXEC=local",
		"SHELL=/bin/sh",
		"boat_routed_goals=",
	);
	let tunnel;
	t.after(async () => {
		const owned = fixtureCensus(f.directory);
		receipts.processes = owned;
		receipts.transport = fs
			.readFileSync(path.join(f.control, "transport"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		if (!tunnel && fs.existsSync(path.join(f.control, "forward-ready")))
			tunnel = fixtureProcess(
				Number(fs.readFileSync(path.join(f.control, "forward-ready"), "utf8")),
			);
		if (tunnel && liveOwnedProcess(f.root, tunnel)) {
			assert.equal(signalFixtureGroup(tunnel, "SIGTERM", f.directory), true);
			assert.equal(
				await fixtureStopped(() => !liveOwnedProcess(f.root, tunnel)),
				true,
			);
		}
		const cleanup = await stopLockFixtureChildren(f.commands);
		receipts.commandCleanup = cleanup;
		receipts.controllerOutput = command.output();
		receipts.forwardEvents = fs
			.readFileSync(path.join(f.control, "forward-events"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		receipts.survivingCommandGroups = f.commands
			.filter((p) => processGroupRunning(p.child.pid))
			.map((p) => p.child.pid);
		receipts.tunnelTerminated = !tunnel || !liveOwnedProcess(f.root, tunnel);
		phase("controlled endpoints and preview commands stopped");
	});
	await f.readiness.wait(() => {
		if (command.terminal) assert.fail(command.output());
		return (
			command.output().includes("Private preview proxy") &&
			fs.existsSync(path.join(f.control, "forward-ready"))
		);
	}, "production preview and controlled forward readiness");
	tunnel = fixtureProcess(
		Number(fs.readFileSync(path.join(f.control, "forward-ready"), "utf8")),
	);
	assert.ok(tunnel);
	assert.equal(path.resolve(tunnel.cwd), f.root);
	const state = f.json(".boat/state.json");
	assert.equal(state.id, "fake-worker");
	assert.equal(state.reconciliationPending, undefined);
	assert.equal(Boolean(state.watcher), mode === "managed");
	if (mode === "foreground")
		assert.equal(
			liveOwnedProcess(f.root, f.json(".boat/state.json").daemon),
			true,
		);
	phase("production preview ready");
	const clients = new Set();
	t.after(() => {
		for (const client of clients) client.destroy();
	});
	const request = (
		url,
		authenticated = true,
		upgrade = false,
		targetPort = port,
	) => {
		const headers = authenticated ? { authorization } : {};
		if (upgrade)
			Object.assign(headers, {
				connection: "Upgrade",
				upgrade: "websocket",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				"sec-websocket-protocol": "boat-diagnostic",
			});
		const client = http.request({
			hostname: "127.0.0.1",
			port: targetPort,
			path: url,
			headers,
		});
		clients.add(client);
		client.on("error", () => {});
		client.end();
		return client;
	};
	const healthy = async (authenticated) => {
		const client = request("/healthy", authenticated);
		const [response] = await previewProbe(
			once(client, "response"),
			"healthy response missing",
		);
		let text = "";
		response.on("data", (bytes) => {
			text += bytes;
		});
		await previewProbe(once(response, "end"), "healthy response incomplete");
		assert.equal(response.statusCode, authenticated ? 200 : 401);
		assert.equal(
			text,
			authenticated
				? "authenticated fixture control"
				: "authentication required",
		);
	};
	const arrival = (url) => new Promise((resolve) => pending.set(url, resolve));
	phase("ready for controlled probes");
	return {
		...f,
		phase,
		receipts,
		healthy,
		request,
		arrival,
		clients,
		privatePort,
	};
}

async function previewFrame(socket, text) {
	const payload = Buffer.from(text);
	assert.ok(payload.length < 120);
	const mask = Buffer.from([17, 34, 51, 68]);
	const bytes = Buffer.from(payload);
	for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % 4];
	let buffered = Buffer.alloc(0);
	let onData;
	const response = new Promise((resolve, reject) => {
		onData = (chunk) => {
			buffered = Buffer.concat([buffered, chunk]);
			if (buffered.length < 2 || buffered.length < (buffered[1] & 127) + 2)
				return;
			try {
				assert.equal(buffered[0], 0x81);
				assert.equal(buffered[1] & 128, 0);
				assert.equal(buffered.subarray(2).toString(), `ack:${text}`);
				resolve();
			} catch (error) {
				reject(error);
			}
		};
		socket.on("data", onData);
	});
	socket.write(
		Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, bytes]),
	);
	try {
		await previewProbe(response, "WebSocket duplex frame missing");
	} finally {
		socket.off("data", onData);
	}
}

for (const mode of ["foreground", "managed"])
	test(`pending-upgrade diagnostic via production ${mode} preview`, async (t) => {
		const archive = pendingPreviewEvidence(t);
		return archive.scenario(async () => {
			const f = await pendingUpgradePreview(t, mode, archive);
			let sibling;
			await t.test(
				"healthy authentication and successful 101 duplex control",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						await f.healthy(false);
						await f.healthy(true);
						const client = f.request("/ws-sibling", true, true);
						const [response, socket, head] = await previewProbe(
							once(client, "upgrade"),
							"successful 101 missing",
						);
						assert.equal(response.statusCode, 101);
						assert.equal(
							response.headers["sec-websocket-protocol"],
							"boat-diagnostic",
						);
						assert.equal(
							response.headers["sec-websocket-accept"],
							"s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
						);
						assert.equal(head.length, 0);
						f.clients.add(socket);
						sibling = socket;
						await previewFrame(sibling, "before-disconnect");
						f.phase("authentication and successful 101 duplex passed");
					}),
			);
			await t.test(
				"ordinary HTTP cancellation remains healthy",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/http-pending");
						const client = f.request("/http-pending");
						const upstream = await previewProbe(
							arrived,
							"ordinary HTTP did not reach upstream",
						);
						client.destroy();
						await previewProbe(
							upstream.closed,
							"ordinary HTTP survived downstream cancellation",
						);
						await f.healthy(true);
						f.phase("ordinary HTTP cancellation and next request passed");
					}),
			);
			await t.test(
				"same forwarder cancels a pending upgrade with production proxy bypassed",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-pending");
						const client = f.request("/ws-pending", true, true, f.privatePort);
						let received101 = false;
						client.on("upgrade", () => {
							received101 = true;
						});
						const [socket] = await previewProbe(
							once(client, "socket"),
							"bypass client socket missing",
						);
						const upstream = await previewProbe(
							arrived,
							"bypass handshake did not reach same upstream",
						);
						const downstreamPort = socket.localPort;
						const upstreamPort = upstream.socket.remotePort;
						const closed = once(socket, "close");
						socket.destroy();
						await previewProbe(closed, "bypass client socket did not close");
						await previewProbe(
							upstream.closed,
							"controlled forwarder retained a bypassed pending upgrade",
						);
						assert.equal(socket.destroyed, true);
						assert.equal(upstream.socket.destroyed, true);
						assert.equal(received101, false);
						f.receipts.bypassControl = {
							downstreamPort,
							upstreamPort,
							disconnectMethod: "destroy",
							downstreamSocketDestroyed: socket.destroyed,
							upstreamSocketDestroyed: upstream.socket.destroyed,
							received101,
						};
						f.phase(
							"same controlled forwarder cancellation passed with proxy bypassed",
						);
					}),
			);
			await t.test(
				"pending upstream handshake terminates after actual downstream socket destruction",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-pending");
						const client = f.request("/ws-pending", true, true);
						let received101 = false;
						client.on("upgrade", () => {
							received101 = true;
						});
						const [socket] = await previewProbe(
							once(client, "socket"),
							"downstream socket missing",
						);
						const upstream = await previewProbe(
							arrived,
							"pending handshake did not reach upstream",
						);
						assert.equal(received101, false);
						const downstreamPort = socket.localPort;
						const upstreamPort = upstream.socket.remotePort;
						const closed = once(socket, "close");
						f.phase("upstream handshake held without 101");
						socket.destroy();
						await previewProbe(
							closed,
							"actual downstream socket did not close",
						);
						f.phase("actual downstream socket closed");
						try {
							await previewProbe(
								upstream.closed,
								"Pending upstream WebSocket handshake survived downstream socket closure for 1000ms",
							);
							assert.equal(upstream.socket.destroyed, true);
							f.receipts.pendingCancelled = {
								downstreamPort,
								upstreamPort,
								downstreamSocketDestroyed: socket.destroyed,
								upstreamSocketDestroyed: upstream.socket.destroyed,
								received101,
							};
							f.phase("pending upstream handshake cancelled");
						} catch (error) {
							f.receipts.pendingAfterDeadline = {
								downstreamPort,
								upstreamPort,
								socketDestroyed: upstream.socket.destroyed,
								requestDestroyed: upstream.req.destroyed,
								disconnectMethod: "destroy",
								downstreamSocketDestroyed: socket.destroyed,
								received101,
							};
							assert.equal(received101, false);
							f.phase("pending upstream handshake remained open at deadline");
							throw error;
						}
					}),
			);
			await t.test(
				"late 101 transition retains duplex and cancels its established peer",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-late");
						const client = f.request("/ws-late", true, true);
						const upgraded = once(client, "upgrade");
						const upstream = await previewProbe(
							arrived,
							"late handshake missing",
						);
						upstream.establish();
						const [response, socket] = await previewProbe(
							upgraded,
							"late 101 missing",
						);
						assert.equal(response.statusCode, 101);
						f.clients.add(socket);
						await previewFrame(socket, "late-transition");
						const closed = once(socket, "close");
						socket.destroy();
						await previewProbe(closed, "late downstream did not close");
						await previewProbe(
							upstream.closed,
							"late upgraded peer survived downstream close",
						);
						assert.equal(upstream.socket.destroyed, true);
						f.phase("late 101 duplex and established peer retirement passed");
					}),
			);
			await t.test(
				"upstream handshake error closes downstream and preserves sibling",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const client = f.request("/ws-upstream-error", true, true);
						const [socket] = await previewProbe(
							once(client, "socket"),
							"error downstream missing",
						);
						await previewProbe(
							once(socket, "close"),
							"upstream error did not close downstream",
						);
						assert.equal(socket.destroyed, true);
						await previewFrame(sibling, "after-upstream-error");
						await f.healthy(true);
						f.phase(
							"upstream error closes affected downstream and preserves sibling",
						);
					}),
			);
			await t.test(
				"healthy upstream completion flushes its final frame and closes downstream",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-late");
						const client = f.request("/ws-late", true, true);
						const upgraded = once(client, "upgrade");
						const upstream = await previewProbe(
							arrived,
							"completion upstream missing",
						);
						upstream.establish();
						const [, socket] = await previewProbe(
							upgraded,
							"completion 101 missing",
						);
						f.clients.add(socket);
						const closed = once(socket, "close");
						await previewFrame(socket, "healthy-completion");
						await previewProbe(
							closed,
							"healthy completion did not close downstream",
						);
						await previewProbe(
							upstream.closed,
							"healthy completion retained upstream",
						);
						await f.healthy(true);
						f.phase(
							"healthy upstream completion flushed final frame and retired sockets",
						);
					}),
			);
			await t.test(
				"pending downstream ECONNRESET retires only its own lifetime",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-pending-reset");
						const client = f.request("/ws-pending-reset", true, true);
						const [socket] = await previewProbe(
							once(client, "socket"),
							"reset downstream missing",
						);
						const upstream = await previewProbe(
							arrived,
							"reset upstream missing",
						);
						const closed = once(socket, "close");
						socket.resetAndDestroy();
						await previewProbe(closed, "reset downstream did not close");
						await previewProbe(
							upstream.closed,
							"reset pending upstream survived downstream close",
						);
						await previewFrame(sibling, "after-reset");
						await f.healthy(true);
						f.receipts.resetControl = {
							disconnectMethod: "resetAndDestroy",
							downstreamSocketDestroyed: socket.destroyed,
							upstreamSocketDestroyed: upstream.socket.destroyed,
							siblingDestroyed: sibling.destroyed,
						};
						f.phase(
							"pending reset retirement, sibling and next request passed",
						);
					}),
			);
			await t.test(
				"101 racing actual downstream closure cannot retain a peer",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						const arrived = f.arrival("/ws-late");
						const client = f.request("/ws-late", true, true);
						let received101 = false;
						client.on("upgrade", (_response, peer) => {
							received101 = true;
							f.clients.add(peer);
						});
						const [socket] = await previewProbe(
							once(client, "socket"),
							"racing downstream missing",
						);
						const upstream = await previewProbe(
							arrived,
							"racing upstream missing",
						);
						const closed = once(socket, "close");
						socket.destroy();
						await previewProbe(closed, "racing downstream did not close");
						const upstreamOpenAt101 = !upstream.socket.destroyed;
						upstream.establish();
						await previewProbe(
							upstream.closed,
							"101 race retained upstream peer",
						);
						assert.equal(received101, false);
						assert.equal(upstream.socket.destroyed, true);
						f.receipts.late101Race = {
							downstreamClosedBefore101: true,
							upstreamOpenAt101,
							received101,
							upstreamSocketDestroyed: upstream.socket.destroyed,
						};
						f.phase("101 racing downstream closure retired upstream peer");
					}),
			);
			await t.test(
				"unrelated sibling and next request survive cancellation",
				{ timeout: 3000 },
				() =>
					archive.scenario(async () => {
						assert.ok(sibling);
						assert.equal(sibling.destroyed, false);
						await previewFrame(sibling, "after-disconnect");
						await f.healthy(true);
						f.phase(
							"sibling duplex and next request passed after cancellation deadline",
						);
					}),
			);
		});
	});
