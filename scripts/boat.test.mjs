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
async function lockGenerationCheckout(t) {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-lock-command-"),
	);
	const root = path.join(directory, "source");
	const worker = path.join(directory, "worker");
	const home = path.join(directory, "home");
	const bin = path.join(home, ".local/bin");
	const control = path.join(directory, "control");
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
		"scripts/lib/boat.mjs",
		"scripts/lib/boat-cache.mjs",
		"scripts/lib/boat-preparation.mjs",
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
 fs.appendFileSync(path.join(control,'calls'),'generate\\n');
 fs.writeFileSync(path.join(control,'entered'),'yes');
 (async()=>{while(fs.existsSync(path.join(control,'pause'))&&!fs.existsSync(path.join(control,'release')))await new Promise(r=>setTimeout(r,10));
 fs.writeFileSync(path.join(root,'pnpm-lock.yaml'),expected());
 if(fs.existsSync(path.join(control,'symlink'))){fs.unlinkSync(path.join(root,'pnpm-lock.yaml'));fs.symlinkSync(path.join(control,'outside'),path.join(root,'pnpm-lock.yaml'));}
 process.exit(fs.existsSync(path.join(control,'fail'))?23:0);})();
}else{if(!argv.includes('--frozen-lockfile'))throw Error('normal install is not frozen');fs.appendFileSync(path.join(control,'calls'),'frozen\\n');if(fs.readFileSync(path.join(root,'pnpm-lock.yaml'),'utf8')!==expected()){console.error('ERR_PNPM_LOCKFILE_CONFIG_MISMATCH');process.exit(17);}}
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
	put(
		path.join(root, ".mise/boat/boat"),
		`#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),path=require('path');
const argv=process.argv.slice(2),control=process.env.FAKE_CONTROL;
fs.appendFileSync(path.join(control,'transport'),JSON.stringify(argv)+'\\n');
if(argv.includes('info')){console.log(JSON.stringify({state:fs.existsSync(path.join(control,'sleep'))?'stopped':'ready'}));process.exit(0);}
if(argv.includes('resume')){fs.unlinkSync(path.join(control,'sleep'));console.log('{}');process.exit(0);}
const command=argv.at(-1).replaceAll('/home/user/wallpaperdb',process.env.FAKE_WORKER);
if(argv.includes('ssh')&&(command.startsWith('mkdir -p '+process.env.FAKE_WORKER+';')||command.includes('sudo -n')||command.includes('--input-type=module -')))process.exit(0);
if(!argv.includes('ssh')&&!argv.includes('exec'))throw Error('unexpected Boat '+argv);
const stream=argv.includes('--stream'),child=cp.spawn('bash',['-c',command],{env:process.env,stdio:['pipe',stream?'pipe':'inherit',stream?'pipe':'inherit']});
process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});
if(stream)for(const type of ['stdout','stderr'])child[type].on('data',b=>console.log(JSON.stringify({type,data:b.toString()})));
child.on('close',code=>process.exit(code??1));
`,
		0o755,
	);
	const keeper = spawn(
		process.execPath,
		["-e", "console.log('ready');setInterval(()=>{},1000)"],
		{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	await once(keeper.stdout, "data");
	t.after(async () => {
		keeper.kill();
		await once(keeper, "close");
		fs.rmSync(directory, { recursive: true, force: true });
	});
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
	const run = (...targets) => {
		const child = spawn("make", targets, {
			cwd: root,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (b) => (output += b));
		child.stderr.on("data", (b) => (output += b));
		const done = new Promise((resolve, reject) => {
			child.on("error", reject);
			child.on("close", (status) => resolve({ status, output }));
		});
		return { child, done };
	};
	return {
		directory,
		root,
		worker,
		control,
		env,
		local,
		json,
		run,
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
