import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
	copyFileSync,
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readSync,
	readFileSync,
	statSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repository = new URL("../", import.meta.url).pathname;

test("Make passes browser credentials only to the browser E2E package", (t) => {
	const f = fixture(t);
	const manifest = JSON.parse(
		readFileSync(join(repository, "package.json"), "utf8"),
	);
	writeFileSync(
		join(f.root, "package.json"),
		JSON.stringify({
			name: "e2e-environment-fixture",
			private: true,
			packageManager: manifest.packageManager,
		}),
	);
	for (const name of ["turbo.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"])
		copyFileSync(join(repository, name), join(f.root, name));
	const browserConfig = "apps/web-e2e/turbo.json";
	if (existsSync(join(repository, browserConfig)))
		copyFileSync(join(repository, browserConfig), join(f.root, browserConfig));
	writeFileSync(
		join(f.root, "probe.mjs"),
		`import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./environment.jsonl', import.meta.url), JSON.stringify({
  package: process.env.npm_package_name,
  credentials: Object.fromEntries(['CLERK_SECRET_KEY', 'E2E_BASE_TEST_EMAIL', 'E2E_BASE_TEST_PASSWORD'].map(key => [key, process.env[key] ?? null]))
}) + '\\n');`,
	);
	for (const name of ["web-e2e", "test-utils", "testcontainers"]) {
		const directory = join(
			f.root,
			name === "web-e2e" ? "apps" : "packages",
			name,
		);
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({
				name: `@wallpaperdb/${name}`,
				scripts: { "test:e2e": "node ../../probe.mjs" },
			}),
		);
	}
	const credentials = {
		CLERK_SECRET_KEY: "sk_test_fixture_secret",
		E2E_BASE_TEST_EMAIL: "fixture@example.test",
		E2E_BASE_TEST_PASSWORD: "fixture-password",
	};
	const result = spawnSync(
		"make",
		[
			"--no-print-directory",
			"test-e2e",
			"GITHUB_ACTIONS=true",
			`TURBO=${join(repository, "node_modules/.bin/turbo")}`,
		],
		{
			cwd: f.root,
			env: { ...f.env, ...credentials },
			encoding: "utf8",
			timeout: 15_000,
		},
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const observed = readFileSync(join(f.root, "environment.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(observed.length, 3);
	for (const entry of observed)
		assert.deepEqual(
			entry.credentials,
			entry.package === "@wallpaperdb/web-e2e"
				? credentials
				: Object.fromEntries(
						Object.keys(credentials).map((key) => [key, null]),
					),
		);
});

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-local-e2e-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "scripts"));
	copyFileSync(join(repository, "Makefile"), join(root, "Makefile"));
	for (const file of ["local-e2e.sh", "local-e2e.mjs"]) {
		try {
			copyFileSync(
				join(repository, "scripts", file),
				join(root, "scripts", file),
			);
		} catch {
			/* Red before implementation. */
		}
	}
	for (const name of ["test-utils", "testcontainers", "web-e2e"]) {
		const directory = join(
			root,
			name === "web-e2e" ? "apps" : "packages",
			name,
		);
		mkdirSync(directory, { recursive: true });
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: `@wallpaperdb/${name}`, type: "module" }),
		);
	}
	const source = join(root, "apps/web-e2e/src");
	mkdirSync(source, { recursive: true });
	copyFileSync(
		join(repository, "apps/web-e2e/src/environment-contract.ts"),
		join(source, "environment-contract.ts"),
	);
	writeFileSync(
		join(root, "turbo"),
		`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(['turbo', ...args]) + '\\n');
if (args.includes('--dry=json')) {
  const selected = args.filter(x => x.startsWith('--filter=@')).map(x => x.slice(9));
  console.log(JSON.stringify({ tasks: (selected.length ? selected : ['@wallpaperdb/web-e2e', '@wallpaperdb/test-utils', '@wallpaperdb/testcontainers']).map(name => ({package: name, task: 'test:e2e', command: 'test'})) }));
} else if (args.includes('--filter=@wallpaperdb/web-e2e')) {
  fs.mkdirSync('apps/web-e2e/test-results', {recursive: true});
  fs.writeFileSync('apps/web-e2e/test-results/trace.zip', 'retained browser artifact');
  if (process.env.TEST_HOLD) { console.log('Browser fixture running'); setInterval(() => {}, 1000); }
  else if (process.env.TEST_BROWSER_EXIT) { console.error('private-password sk_test_private'); process.exit(Number(process.env.TEST_BROWSER_EXIT)); }
}
if (!args.includes('--dry=json') && args.includes('--filter=!@wallpaperdb/web-e2e') && process.env.TEST_CONTAINER_EXIT) process.exit(Number(process.env.TEST_CONTAINER_EXIT));
if (!args.includes('--dry=json') && args.includes('--filter=' + process.env.TEST_FAILED_PACKAGE)) process.exit(27);
if (!args.includes('--dry=json') && process.env.TEST_CHILD_SIGNAL) process.kill(process.pid, process.env.TEST_CHILD_SIGNAL);
if (!args.includes('--dry=json') && process.env.TEST_VERBOSE_OUTPUT) {
  (async () => {
    const chunk = 'v '.repeat(32767) + 'v\\n';
    for (let index = 0; index < 1024; index++) {
      const destination = index % 2 ? process.stderr : process.stdout;
      if (!destination.write(chunk)) await new Promise(resolve => destination.once('drain', resolve));
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
`,
		{ mode: 0o700 },
	);
	writeFileSync(
		join(root, "docker"),
		`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(['docker', ...args]) + '\\n');
if (args.includes('info') && process.env.TEST_INFO_EXIT) process.exit(Number(process.env.TEST_INFO_EXIT));
if (args.includes('config')) console.log(fs.readFileSync('compose.json', 'utf8'));
if (args.includes('logs')) console.log('private-password sk_test_private');
if (args.includes('ps') && args.some(x => x.startsWith('label=')) && process.env.TEST_EXISTING) console.log('existing-resource');
if (args.includes('build') && process.env.TEST_BUILD_EXIT) process.exit(Number(process.env.TEST_BUILD_EXIT));
if (args.includes('run') && process.env.TEST_MOUNT_EXIT) process.exit(Number(process.env.TEST_MOUNT_EXIT));
if (args.includes('up') && process.env.TEST_UP_EXIT) process.exit(Number(process.env.TEST_UP_EXIT));
if (args.includes('up') && args.includes('infra/docker-compose.apps.yml') && process.env.TEST_BROWSER_FIXTURE) {
  const start = () => {
    console.log('Application fixture starting');
    const watcher = fs.watch('.', () => { if (fs.existsSync('fixture-server-ready')) { watcher.close(); clearTimeout(timer); } });
    const timer = setTimeout(() => { console.error('Fixture server did not start'); process.exit(1); }, 5000);
    if (fs.existsSync('fixture-server-ready')) { watcher.close(); clearTimeout(timer); }
  };
  if (process.env.TEST_UP_DELAY) setTimeout(start, Number(process.env.TEST_UP_DELAY));
  else start();
}
if (args.includes('down') && args.includes('infra/docker-compose.apps.yml') && process.env.TEST_CLEANUP_EXIT) process.exit(Number(process.env.TEST_CLEANUP_EXIT));
if (args.includes('down') && args.includes('infra/docker-compose.apps.yml') && process.env.TEST_HOLD_CLEANUP) { console.log('Cleanup fixture running'); setTimeout(() => {}, 100); }
`,
		{ mode: 0o700 },
	);
	const env = {
		...process.env,
		PATH: `${root}:${process.env.PATH}`,
		MAKEFLAGS: "",
		MFLAGS: "",
		MAKELEVEL: "0",
		GITHUB_ACTIONS: "",
		E2E_LOCK_FILE: join(root, "host.lock"),
		TMPDIR: root,
	};
	for (const key of [
		"PACKAGE",
		"ARGS",
		"FORCE",
		"TURBO_FLAGS",
		"COMPOSE_PROJECT_NAME",
	])
		delete env[key];
	const args = [
		"--no-print-directory",
		"test-e2e",
		`TURBO=${join(root, "turbo")}`,
	];
	return {
		root,
		env,
		args,
		run: (...extra) =>
			spawnSync("make", [...args, ...extra], {
				cwd: root,
				env,
				encoding: "utf8",
				timeout: 15_000,
			}),
		calls: () =>
			readFileSync(join(root, "calls.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
	};
}

for (const packageName of ["test-utils", "testcontainers"]) {
	test(`Docker preflight failure preserves the ${packageName} focused rerun`, (t) => {
		const f = fixture(t);
		f.env.TEST_INFO_EXIT = "39";
		const result = f.run(
			`PACKAGE=${packageName}`,
			"ARGS=selected.test.ts",
			"FORCE=1",
		);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /phase "Docker preflight" failed, exit 39/);
		assert.match(
			result.stderr,
			new RegExp(
				`Focused rerun: make test-e2e PACKAGE=${packageName}.*selected.test.ts.*FORCE=1`,
			),
		);
		assert.ok(
			!f.calls().some((call) => call.includes("build") || call.includes("up")),
		);
	});
}

async function browserFixture(t, ready = true) {
	const f = fixture(t);
	const server = createServer((_req, res) => {
		if (ready === "hang") return;
		res.writeHead(ready ? 200 : 503);
		res.end(ready ? "ok" : "gateway dependency unavailable");
	});
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	// Reserve another eight ports independently; startup itself is controlled by the Docker adapter.
	const ports = [];
	const reservations = [];
	for (let index = 0; index < 8; index++) {
		const reservation = createServer();
		await new Promise((resolve) => reservation.listen(0, "0.0.0.0", resolve));
		ports.push(reservation.address().port);
		reservations.push(reservation);
	}
	for (const reservation of reservations)
		await new Promise((resolve) => reservation.close(resolve));
	const keys = [
		"INGRESS_PORT",
		"POSTGRES_HOST_PORT",
		"S3_API_HOST_PORT",
		"NATS_HOST_PORT",
		"REDIS_HOST_PORT",
		"OPENSEARCH_HOST_PORT",
		"OTEL_HTTP_HOST_PORT",
		"OTEL_GRPC_HOST_PORT",
	];
	writeFileSync(
		join(f.root, ".worktree"),
		`COMPOSE_PROJECT_NAME=development\n${keys.map((key, index) => `${key}=${ports[index]}`).join("\n")}\n`,
	);
	const init = join(f.root, "infra/postgres/init");
	mkdirSync(init, { recursive: true, mode: 0o755 });
	writeFileSync(join(init, "00.sql"), "-- public initialization", {
		mode: 0o644,
	});
	chmodSync(init, 0o755);
	chmodSync(join(init, "00.sql"), 0o644);
	const environment = {
		CLERK_SECRET_KEY: "sk_test_private",
		CLERK_PUBLISHABLE_KEY: "pk_test_public",
		VITE_CLERK_PUBLISHABLE_KEY: "pk_test_public",
		CLERK_DOMAIN: "https://example.clerk.accounts.dev",
		CURSOR_SECRET: "private-cursor-secret-with-32-characters",
		USER_MEDIA_SERVICE_TOKEN: "private-service-token",
	};
	writeFileSync(
		join(f.root, "compose.json"),
		JSON.stringify({
			services: Object.fromEntries(
				[
					"web",
					"user",
					"ingestor",
					"gateway",
					"media",
					"tags",
					"variant-generator",
					"color-extractor",
				].map((name) => [name, { environment }]),
			),
		}),
	);
	writeFileSync(
		join(f.root, "apps/web-e2e/.env"),
		"E2E_BASE_TEST_EMAIL=private@example.com\nE2E_BASE_TEST_PASSWORD=private-password\n",
	);
	f.env.E2E_READY_TIMEOUT = ready === "hang" ? "1" : ready ? "10" : "3";
	f.env.TEST_BROWSER_FIXTURE = "1";
	const playwright = join(f.root, "apps/web-e2e/node_modules/@playwright/test");
	mkdirSync(playwright, { recursive: true });
	writeFileSync(
		join(playwright, "index.js"),
		"exports.chromium = { executablePath: () => process.execPath };",
	);
	f.runAsync = (...extra) =>
		new Promise((resolve, reject) => {
			const child = spawn("make", [...f.args, ...extra], {
				cwd: f.root,
				env: f.env,
				detached: true,
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (data) => {
				stdout += data;
				if (
					!server.listening &&
					String(data).includes("Application fixture starting")
				)
					server.listen(ports[0], () =>
						writeFileSync(join(f.root, "fixture-server-ready"), "ready"),
					);
				f.onOutput?.(String(data), child);
			});
			child.stderr.on("data", (data) => {
				stderr += data;
			});
			child.on("error", reject);
			child.on("close", (status) => resolve({ status, stdout, stderr }));
		});
	return f;
}

test("complete explicit E2E builds current images and releases its owned browser stack before container suites", async (t) => {
	const f = await browserFixture(t);
	const result = await f.runAsync();
	assert.equal(result.status, 0, result.stderr);
	const calls = f.calls();
	const build = calls.findIndex(
		(call) =>
			call.includes("build") && call.includes("infra/docker-compose.apps.yml"),
	);
	const browser = calls.findIndex(
		(call) =>
			call[0] === "turbo" &&
			!call.includes("--dry=json") &&
			call.includes("--filter=@wallpaperdb/web-e2e"),
	);
	const cleanup = calls.findIndex(
		(call) =>
			call.includes("down") && call.includes("infra/docker-compose.yml"),
	);
	const containers = calls.findIndex(
		(call) =>
			call[0] === "turbo" &&
			!call.includes("--dry=json") &&
			call.includes("--filter=@wallpaperdb/test-utils"),
	);
	assert.ok(
		build >= 0 && browser > build && cleanup > browser && containers > cleanup,
	);
	const compose = calls.filter(
		(call) =>
			call.includes("compose") &&
			call.includes("-p") &&
			!call.includes("config"),
	);
	assert.ok(
		compose.every((call) =>
			/^development-e2e-/.test(call[call.indexOf("-p") + 1]),
		),
	);
	assert.ok(
		compose
			.filter((call) => call.includes("down"))
			.every((call) => call.includes("--volumes")),
	);
	assert.match(result.stdout, /All requested E2E phases and cleanup passed/);
});

test("browser command fixtures await observable startup even when startup takes over one second", async (t) => {
	const f = await browserFixture(t);
	f.env.TEST_UP_DELAY = "1100";
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.equal(result.status, 0, result.stderr);
	assert.ok(
		f
			.calls()
			.some((call) => call[0] === "turbo" && !call.includes("--dry=json")),
	);
});

for (const value of ["invalid", "0", "-1"]) {
	test(`invalid readiness timeout ${value} fails before building application images`, async (t) => {
		const f = await browserFixture(t);
		f.env.E2E_READY_TIMEOUT = value;
		const result = await f.runAsync("PACKAGE=web-e2e");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /E2E_READY_TIMEOUT must be a positive number/);
		assert.ok(
			!f.calls().some((call) => call.includes("build") || call.includes("up")),
		);
	});
}

for (const browser of [false, true]) {
	test(`successful ${browser ? "browser" : "container-only"} runs remove their temporary diagnostics`, async (t) => {
		const f = browser ? await browserFixture(t) : fixture(t);
		const result = browser
			? await f.runAsync("PACKAGE=web-e2e")
			: f.run("PACKAGE=test-utils");
		assert.equal(result.status, 0, result.stderr);
		const directory = result.stdout.match(
			/E2E diagnostics retained at (\S+)\./,
		)[1];
		assert.ok(
			!existsSync(directory),
			"successful runs must remove private temporary diagnostics",
		);
	});
}

for (const buildFailure of [false, true]) {
	test(`owned application images are removed after ${buildFailure ? "a failed build" : "successful browser tests"} while pulled images are preserved`, async (t) => {
		const f = await browserFixture(t);
		if (buildFailure) f.env.TEST_BUILD_EXIT = "37";
		const result = await f.runAsync("PACKAGE=web-e2e");
		assert.equal(result.status === 0, !buildFailure, result.stderr);
		const teardown = f.calls().filter((call) => call.includes("down"));
		assert.equal(teardown.length, 2);
		const apps = teardown.find((call) =>
			call.includes("infra/docker-compose.apps.yml"),
		);
		assert.equal(apps[apps.indexOf("--rmi") + 1], "local");
		assert.ok(
			!teardown
				.find((call) => call.includes("infra/docker-compose.yml"))
				.includes("--rmi"),
		);
	});
}

test("readiness failure identifies affected services and endpoints, retains diagnostics, and cleans up without running tests", async (t) => {
	const f = await browserFixture(t, false);
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /browser readiness.*exit 124/);
	assert.match(
		result.stderr,
		/gateway readiness: http:\/\/localhost:\d+\/gateway\/ready -> HTTP 503/,
	);
	assert.match(result.stderr, /gateway dependency unavailable/);
	assert.ok(
		!f
			.calls()
			.some((call) => call[0] === "turbo" && !call.includes("--dry=json")),
	);
	assert.equal(f.calls().filter((call) => call.includes("down")).length, 2);
	const directory = result.stdout.match(
		/E2E diagnostics retained at (\S+)\./,
	)[1];
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	assert.match(
		readFileSync(join(directory, "run.log"), "utf8"),
		/gateway readiness/,
	);
	assert.doesNotMatch(
		readFileSync(join(directory, "apps.log"), "utf8"),
		/private-password|sk_test_private/,
	);
});

test("readiness deadline cancels hanging HTTP probes and still cleans up", async (t) => {
	const f = await browserFixture(t, "hang");
	const start = Date.now();
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /browser readiness.*exit 124/);
	assert.ok(Date.now() - start < 8000);
	assert.equal(f.calls().filter((call) => call.includes("down")).length, 2);
});

test("failures before browser tests preserve old reports without copying them into new diagnostics", async (t) => {
	const f = await browserFixture(t);
	f.env.TEST_BUILD_EXIT = "23";
	for (const name of ["test-results", "playwright-report"]) {
		const directory = join(f.root, "apps/web-e2e", name);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "old.txt"), "previous browser run");
	}
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.match(result.stderr, /image build.*exit 23/);
	const diagnostics = result.stdout.match(
		/E2E diagnostics retained at (\S+)\./,
	)[1];
	for (const name of ["test-results", "playwright-report"]) {
		assert.ok(!existsSync(join(diagnostics, name)));
		assert.equal(
			readFileSync(join(f.root, "apps/web-e2e", name, "old.txt"), "utf8"),
			"previous browser run",
		);
	}
});

for (const [name, settings, expectedPhase, status] of [
	[
		"build failure",
		{ TEST_BUILD_EXIT: "23" },
		"current-checkout image build",
		23,
	],
	["startup failure", { TEST_UP_EXIT: "24" }, "infrastructure startup", 24],
	["mount restriction", { TEST_MOUNT_EXIT: "25" }, "browser preflight", 25],
	["browser failure", { TEST_BROWSER_EXIT: "26" }, "browser tests", 26],
	["cleanup failure", { TEST_CLEANUP_EXIT: "29" }, "browser cleanup", 29],
	[
		"browser and cleanup failure",
		{ TEST_BROWSER_EXIT: "26", TEST_CLEANUP_EXIT: "29" },
		"browser tests",
		26,
	],
]) {
	test(`${name} preserves phase and status and attempts both cleanup steps`, async (t) => {
		const f = await browserFixture(t);
		Object.assign(f.env, settings);
		const result = await f.runAsync();
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			new RegExp(`phase "${expectedPhase}" failed, exit ${status}`),
		);
		assert.equal(f.calls().filter((call) => call.includes("down")).length, 2);
		assert.ok(
			!f
				.calls()
				.some(
					(call) =>
						call[0] === "turbo" &&
						!call.includes("--dry=json") &&
						call.includes("--filter=@wallpaperdb/test-utils"),
				),
		);
		assert.doesNotMatch(
			result.stdout + result.stderr,
			/All requested E2E phases and cleanup passed|private-password|sk_test_private/,
		);
		if (settings.TEST_CLEANUP_EXIT)
			assert.match(result.stderr, /Cleanup failed for apps, exit 29/);
		const directory = result.stdout.match(
			/E2E diagnostics retained at (\S+)\./,
		)[1];
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		if (settings.TEST_BROWSER_EXIT)
			assert.equal(
				readFileSync(join(directory, "test-results/trace.zip"), "utf8"),
				"retained browser artifact",
			);
		// The command releases shared ownership even after a failure.
		assert.equal(
			spawnSync("flock", ["-n", f.env.E2E_LOCK_FILE, "true"]).status,
			0,
		);
	});
}

for (const kind of [
	"credentials",
	"Chromium",
	"public init directory",
	"public init file",
	"existing project",
]) {
	test(`preflight rejects ${kind} before any image build or stack startup`, async (t) => {
		const f = await browserFixture(t);
		if (kind === "credentials")
			writeFileSync(join(f.root, "apps/web-e2e/.env"), "");
		if (kind === "Chromium")
			writeFileSync(
				join(f.root, "apps/web-e2e/node_modules/@playwright/test/index.js"),
				'exports.chromium = { executablePath: () => "/missing-chromium" };',
			);
		if (kind === "public init directory")
			chmodSync(join(f.root, "infra/postgres/init"), 0o700);
		if (kind === "public init file")
			chmodSync(join(f.root, "infra/postgres/init/00.sql"), 0o600);
		if (kind === "existing project") f.env.TEST_EXISTING = "1";
		const result = await f.runAsync("PACKAGE=web-e2e");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /browser preflight/);
		assert.ok(
			!f
				.calls()
				.some(
					(call) =>
						call.includes("build") ||
						call.includes("up") ||
						call.includes("down"),
				),
		);
	});
}

for (const [service, key, value] of [
	["ingestor", "CLERK_PUBLISHABLE_KEY", "pk_live_other"],
	["user", "CLERK_PUBLISHABLE_KEY", "pk_live_other"],
	["web", "VITE_CLERK_PUBLISHABLE_KEY", "pk_live_other"],
	["user", "CLERK_PUBLISHABLE_KEY", "pk_test_other_instance"],
	["web", "VITE_CLERK_PUBLISHABLE_KEY", "pk_test_other_instance"],
]) {
	test(`Clerk preflight rejects incompatible ${service} ${key} before building`, async (t) => {
		const f = await browserFixture(t);
		const path = join(f.root, "compose.json");
		const config = JSON.parse(readFileSync(path, "utf8"));
		config.services[service].environment[key] = value;
		writeFileSync(path, JSON.stringify(config));
		const result = await f.runAsync("PACKAGE=web-e2e");
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /browser preflight/);
		assert.match(
			result.stderr,
			/development pk_test_|publishable keys must match/,
		);
		assert.ok(
			!f
				.calls()
				.some(
					(call) =>
						call[0] === "docker" &&
						(call.includes("build") ||
							call.includes("up") ||
							call.includes("run")),
				),
		);
		assert.doesNotMatch(
			result.stdout + result.stderr,
			/pk_live_other|pk_test_other_instance/,
		);
	});
}

test("interruption cleans its owned stack and releases the lock", async (t) => {
	const f = await browserFixture(t);
	f.env.TEST_HOLD = "1";
	f.onOutput = (output, child) => {
		if (output.includes("Browser fixture running"))
			process.kill(-child.pid, "SIGTERM");
	};
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /browser tests.*exit 143/);
	assert.equal(f.calls().filter((call) => call.includes("down")).length, 2);
	assert.equal(
		spawnSync("flock", ["-n", f.env.E2E_LOCK_FILE, "true"]).status,
		0,
	);
});

test("interruption during successful browser cleanup finishes teardown and reports the cleanup phase", async (t) => {
	const f = await browserFixture(t);
	f.env.TEST_HOLD_CLEANUP = "1";
	f.onOutput = (output, child) => {
		if (output.includes("Cleanup fixture running"))
			process.kill(-child.pid, "SIGTERM");
	};
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.match(result.stderr, /phase "browser cleanup" failed, exit 143/);
	assert.equal(f.calls().filter((call) => call.includes("down")).length, 2);
	assert.equal(
		spawnSync("flock", ["-n", f.env.E2E_LOCK_FILE, "true"]).status,
		0,
	);
	assert.doesNotMatch(
		result.stdout,
		/All requested E2E phases and cleanup passed/,
	);
});

test("concurrent worktrees wait visibly within a deadline and cannot overlap owned Docker work", async (t) => {
	const owner = await browserFixture(t);
	const contender = fixture(t);
	contender.env.E2E_LOCK_FILE = owner.env.E2E_LOCK_FILE;
	contender.env.E2E_LOCK_TIMEOUT = "1";
	owner.env.TEST_HOLD = "1";
	let waiting;
	owner.onOutput = (output, child) => {
		if (!output.includes("Browser fixture running")) return;
		waiting = contender.run("PACKAGE=test-utils");
		process.kill(-child.pid, "SIGTERM");
	};
	await owner.runAsync("PACKAGE=web-e2e");
	assert.notEqual(waiting.status, 0);
	assert.match(waiting.stdout, /Docker host lock busy/);
	assert.match(waiting.stderr, /lock timed out/);
	assert.ok(!existsSync(join(contender.root, "calls.jsonl")));
	assert.equal(contender.run("PACKAGE=test-utils").status, 0);
});

test("test-runner dry flags cannot bypass a lock held by another worktree", async (t) => {
	const owner = await browserFixture(t);
	const contender = fixture(t);
	contender.env.E2E_LOCK_FILE = owner.env.E2E_LOCK_FILE;
	contender.env.E2E_LOCK_TIMEOUT = "1";
	owner.env.TEST_HOLD = "1";
	let waiting;
	owner.onOutput = (output, child) => {
		if (!output.includes("Browser fixture running")) return;
		waiting = contender.run("PACKAGE=test-utils", "ARGS=--dry-run");
		process.kill(-child.pid, "SIGTERM");
	};
	await owner.runAsync("PACKAGE=web-e2e");
	assert.notEqual(waiting.status, 0);
	assert.match(waiting.stderr, /lock timed out/);
	assert.ok(!existsSync(join(contender.root, "calls.jsonl")));
	const inspection = contender.run("TURBO_FLAGS=--dry=json");
	assert.equal(inspection.status, 0, inspection.stderr);
	assert.ok(JSON.parse(inspection.stdout).tasks.length > 0);
	assert.ok(!contender.calls().some((call) => call[0] === "docker"));
});

test("occupied worktree ingress fails early without altering the existing listener or any stack", async (t) => {
	const f = await browserFixture(t);
	const listener = createServer();
	await new Promise((resolve) => listener.listen(0, "0.0.0.0", resolve));
	t.after(() => listener.close());
	const worktree = join(f.root, ".worktree");
	writeFileSync(
		worktree,
		readFileSync(worktree, "utf8").replace(
			/INGRESS_PORT=\d+/,
			`INGRESS_PORT=${listener.address().port}`,
		),
	);
	const result = await f.runAsync("PACKAGE=web-e2e");
	assert.notEqual(result.status, 0);
	assert.match(
		result.stderr,
		/INGRESS_PORT=.*unavailable.*Preserve the existing stack/,
	);
	assert.ok(listener.listening);
	assert.ok(
		!f
			.calls()
			.some(
				(call) =>
					call.includes("build") ||
					call.includes("up") ||
					call.includes("down"),
			),
	);
});

test("hosted browser and container selections enforce failures using their externally managed dependencies", (t) => {
	const f = fixture(t);
	f.env.GITHUB_ACTIONS = "true";
	f.env.TEST_BROWSER_EXIT = "26";
	f.env.TEST_CONTAINER_EXIT = "27";
	const browser = f.run("PACKAGE=web-e2e");
	const containers = f.run("TURBO_FLAGS=--filter=!@wallpaperdb/web-e2e");
	assert.notEqual(browser.status, 0);
	assert.notEqual(containers.status, 0);
	assert.match(browser.stderr, /Error 26/);
	assert.match(containers.stderr, /Error 27/);
	assert.ok(!f.calls().some((call) => call[0] === "docker"));
	const workflow = readFileSync(
		join(repository, ".github/workflows/e2e.yml"),
		"utf8",
	);
	assert.match(workflow, /pull_request:/);
	assert.match(workflow, /run: make test-e2e PACKAGE=web-e2e/);
	assert.match(
		workflow,
		/run: make test-e2e TURBO_FLAGS='--filter=!@wallpaperdb\/web-e2e'/,
	);
	assert.doesNotMatch(workflow, /continue-on-error/);
});

test("explicit container-only selection preserves test arguments and FORCE without starting Compose", (t) => {
	const f = fixture(t);
	const result = f.run(
		"PACKAGE=test-utils",
		"ARGS=test/storage.test.ts",
		"FORCE=1",
	);
	assert.equal(result.status, 0, result.stderr);
	const calls = f.calls();
	assert.ok(
		calls.some(
			(call) =>
				call.includes("--filter=@wallpaperdb/test-utils") &&
				call.includes("test/storage.test.ts") &&
				call.includes("--force"),
		),
	);
	assert.ok(calls.some((call) => call[0] === "docker" && call[1] === "info"));
	assert.ok(!calls.some((call) => call.includes("compose")));
	assert.match(result.stdout, /Container E2E/);
});

for (const [signal, status] of [
	["SIGKILL", 137],
	["SIGUSR2", 140],
]) {
	test(`a child terminated by ${signal} retains exit status ${status}`, (t) => {
		const f = fixture(t);
		f.env.TEST_CHILD_SIGNAL = signal;
		const result = f.run("PACKAGE=test-utils");
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			new RegExp(`phase "container tests" failed, exit ${status}`),
		);
		assert.equal(
			spawnSync("flock", ["-n", f.env.E2E_LOCK_FILE, "true"]).status,
			0,
		);
	});
}

test("verbose stdout and stderr remain streamed under a bounded runner heap", (t) => {
	const f = fixture(t);
	f.env.TEST_VERBOSE_OUTPUT = "1";
	f.env.NODE_OPTIONS = "--max-old-space-size=32";
	const output = openSync(join(f.root, "output.log"), "w+");
	try {
		const result = spawnSync(
			"bash",
			[
				"-c",
				'ulimit -c 0; exec "$@"',
				"bounded-output",
				"make",
				...f.args,
				"PACKAGE=test-utils",
			],
			{
				cwd: f.root,
				env: f.env,
				stdio: ["ignore", output, output],
				timeout: 30_000,
			},
		);
		const header = Buffer.alloc(4096);
		readSync(output, header, 0, header.length, 0);
		const tail = Buffer.alloc(4096);
		readSync(
			output,
			tail,
			0,
			tail.length,
			Math.max(0, statSync(join(f.root, "output.log")).size - tail.length),
		);
		assert.equal(result.status, 0, result.error?.message ?? tail.toString());
		const directory = header
			.toString()
			.match(/E2E diagnostics retained at (\S+)\./)[1];
		assert.ok(statSync(join(f.root, "output.log")).size >= 64 * 1024 * 1024);
		assert.ok(!existsSync(directory));
		assert.equal(
			spawnSync("flock", ["-n", f.env.E2E_LOCK_FILE, "true"]).status,
			0,
		);
	} finally {
		closeSync(output);
	}
});

test("a complete run suggests the container suite that actually failed", async (t) => {
	const f = await browserFixture(t);
	f.env.TEST_FAILED_PACKAGE = "@wallpaperdb/testcontainers";
	const result = await f.runAsync();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /phase "container tests" failed, exit 27/);
	assert.match(
		result.stderr,
		/Focused rerun: make test-e2e PACKAGE=testcontainers/,
	);
	const executions = f
		.calls()
		.filter((call) => call[0] === "turbo" && !call.includes("--dry=json"));
	assert.deepEqual(
		executions.map((call) => call.filter((arg) => arg.startsWith("--filter="))),
		[
			["--filter=@wallpaperdb/web-e2e"],
			["--filter=@wallpaperdb/test-utils"],
			["--filter=@wallpaperdb/testcontainers"],
		],
	);
});
