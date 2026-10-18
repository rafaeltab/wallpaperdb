import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
	copyFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const repository = new URL("../", import.meta.url).pathname;

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
			JSON.stringify({ name: `@wallpaperdb/${name}` }),
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
`,
		{ mode: 0o700 },
	);
	writeFileSync(
		join(root, "docker"),
		`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(['docker', ...args]) + '\\n');
if (args.includes('config')) console.log(fs.readFileSync('compose.json', 'utf8'));
if (args.includes('logs')) console.log('private-password sk_test_private');
if (args.includes('ps') && args.some(x => x.startsWith('label=')) && process.env.TEST_EXISTING) console.log('existing-resource');
if (args.includes('build') && process.env.TEST_BUILD_EXIT) process.exit(Number(process.env.TEST_BUILD_EXIT));
if (args.includes('run') && process.env.TEST_MOUNT_EXIT) process.exit(Number(process.env.TEST_MOUNT_EXIT));
if (args.includes('up') && process.env.TEST_UP_EXIT) process.exit(Number(process.env.TEST_UP_EXIT));
if (args.includes('down') && args.includes('infra/docker-compose.apps.yml') && process.env.TEST_CLEANUP_EXIT) process.exit(Number(process.env.TEST_CLEANUP_EXIT));
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
	for (let index = 0; index < 8; index++) {
		const reservation = createServer();
		await new Promise((resolve) => reservation.listen(0, "0.0.0.0", resolve));
		ports.push(reservation.address().port);
		await new Promise((resolve) => reservation.close(resolve));
	}
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
	f.env.E2E_READY_TIMEOUT = "1";
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
					String(data).includes("Waiting for browser readiness")
				)
					server.listen(ports[0], "0.0.0.0");
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
