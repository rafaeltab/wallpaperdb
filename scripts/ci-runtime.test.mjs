import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const script = new URL("./ci-runtime.mjs", import.meta.url).pathname;

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "wallpaperdb-ci-runtime-"));
	t.after(() => {
		for (const kind of ["stats", "events", "command", "descendant"]) {
			try {
				process.kill(
					Number(readFileSync(join(root, `${kind}.ready`), "utf8")),
					"SIGKILL",
				);
			} catch {
				/* The fixture process may already have exited. */
			}
		}
		rmSync(root, { recursive: true, force: true });
	});
	writeFileSync(join(root, "docker"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
	return {
		root,
		env: {
			...process.env,
			PATH: `${root}:${process.env.PATH}`,
			GITHUB_STEP_SUMMARY: join(root, "summary.md"),
		},
	};
}

function run(f, source, args = []) {
	return spawnSync(
		process.execPath,
		[script, "integration", "--", process.execPath, "-e", source, ...args],
		{
			cwd: f.root,
			env: f.env,
			encoding: "utf8",
			timeout: 10_000,
		},
	);
}

function records(f) {
	const directory = join(f.root, "test-results/ci-runtime");
	const name = readdirSync(directory).find((entry) => entry.endsWith(".jsonl"));
	return readFileSync(join(directory, name), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
}

test("runtime evidence preserves command output and arguments and records host timing", (t) => {
	const f = fixture(t);
	const literal = "literal ; $(false) ' argument";
	const result = run(
		f,
		"console.log(process.argv[1]); console.error('child stderr')",
		[literal],
	);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), literal);
	assert.match(result.stderr, /child stderr/);
	const evidence = records(f);
	const start = evidence.find((entry) => entry.type === "start");
	assert.equal(start.phase, "integration");
	assert.ok(start.host.availableParallelism >= 1);
	assert.ok(start.host.totalMemoryBytes > 0);
	assert.equal(start.host.loadAverage.length, 3);
	const finish = evidence.find((entry) => entry.type === "finish");
	assert.equal(finish.exitCode, 0);
	assert.ok(finish.durationMs > 0);
	assert.ok(finish.observerResourceUsage.maxRSS > 0);
	assert.match(
		readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8"),
		/integration.*exit 0/,
	);
});

function installDockerObserver(f) {
	writeFileSync(
		join(f.root, "docker"),
		`#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
const kind = process.argv[2];
writeFileSync(kind + '.ready', String(process.pid));
process.stdout.write((kind === 'stats' ? String.fromCharCode(27) + '[2J' + String.fromCharCode(27) + '[1;1H' : '') + JSON.stringify({ kind, sample: 'observed' }) + '\\n');
process.on('SIGTERM', () => {
  appendFileSync('stopped.jsonl', JSON.stringify({kind}) + '\\n');
  process.exit(0);
});
setInterval(() => {}, 1000);
`,
		{ mode: 0o700 },
	);
}

test("runtime evidence decodes ANSI Docker stats, stops observers, and preserves a failed status", (t) => {
	const f = fixture(t);
	installDockerObserver(f);
	const result = run(
		f,
		`
const { existsSync } = require('node:fs');
const deadline = Date.now() + 3000;
const ready = setInterval(() => {
  if (existsSync('stats.ready') && existsSync('events.ready')) process.exit(23);
  if (Date.now() > deadline) process.exit(99);
}, 10);
`,
	);
	assert.equal(result.status, 23, result.stderr);
	const stopped = readFileSync(join(f.root, "stopped.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.deepEqual(stopped.map((entry) => entry.kind).sort(), [
		"events",
		"stats",
	]);
	const evidence = records(f);
	assert.equal(evidence.find((entry) => entry.type === "finish").exitCode, 23);
	for (const kind of ["stats", "events"]) {
		assert.ok(
			evidence.some(
				(entry) =>
					entry.type === `docker-${kind}` && entry.data.sample === "observed",
			),
		);
		const pid = Number(readFileSync(join(f.root, `${kind}.ready`), "utf8"));
		assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	}
});

test("evidence and summary write failures preserve command status and observer cleanup", (t) => {
	const f = fixture(t);
	installDockerObserver(f);
	f.env.GITHUB_STEP_SUMMARY = join(f.root, "missing/summary.md");
	const result = run(
		f,
		`
const { existsSync, rmSync } = require('node:fs');
const deadline = Date.now() + 3000;
setInterval(() => {
  if (existsSync('stats.ready') && existsSync('events.ready')) {
    rmSync('test-results/ci-runtime', {recursive: true});
    process.exit(23);
  }
  if (Date.now() > deadline) process.exit(99);
}, 10);
`,
	);
	assert.equal(result.status, 23, result.stderr);
	assert.equal(
		(result.stderr.match(/ci-runtime: evidence write failed/g) ?? []).length,
		1,
	);
	assert.match(result.stderr, /ci-runtime: summary write failed/);
	const stopped = readFileSync(join(f.root, "stopped.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.deepEqual(stopped.map((entry) => entry.kind).sort(), [
		"events",
		"stats",
	]);
	for (const kind of ["stats", "events"]) {
		assert.throws(
			() =>
				process.kill(
					Number(readFileSync(join(f.root, `${kind}.ready`), "utf8")),
					0,
				),
			{ code: "ESRCH" },
		);
	}
});

test("runtime evidence retains command-not-found status and diagnostics", (t) => {
	const f = fixture(t);
	const result = spawnSync(
		process.execPath,
		[script, "missing", "--", join(f.root, "absent")],
		{
			cwd: f.root,
			env: f.env,
			encoding: "utf8",
			timeout: 5000,
		},
	);
	assert.equal(result.status, 127, result.stderr);
	assert.match(result.stderr, /ENOENT/);
	assert.equal(
		records(f).find((entry) => entry.type === "finish").exitCode,
		127,
	);
});

for (const [signal, status] of [
	["SIGHUP", 129],
	["SIGINT", 130],
	["SIGTERM", 143],
]) {
	test(
		`runtime evidence forwards ${signal} to the command process group`,
		{ timeout: 5000 },
		async (t) => {
			const f = fixture(t);
			const program = join(f.root, "command.mjs");
			writeFileSync(
				program,
				`
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const role = process.argv[2];
process.on('${signal}', () => {
  appendFileSync('signals.jsonl', JSON.stringify({role}) + '\\n');
  process.exit(0);
});
if (role === 'command') spawn(process.execPath, [new URL(import.meta.url).pathname, 'descendant'], {stdio: 'inherit'});
writeFileSync(role + '.ready', String(process.pid));
setInterval(() => {}, 1000);
`,
			);
			const child = spawn(
				process.execPath,
				[script, "signal", "--", process.execPath, program, "command"],
				{
					cwd: f.root,
					env: f.env,
					stdio: "ignore",
				},
			);
			t.after(() => {
				child.kill("SIGKILL");
				for (const role of ["command", "descendant"]) {
					try {
						process.kill(
							Number(readFileSync(join(f.root, `${role}.ready`), "utf8")),
							"SIGKILL",
						);
					} catch {
						/* Already exited. */
					}
				}
			});
			const closed = new Promise((resolve) =>
				child.once("close", (code) => resolve(code)),
			);
			const deadline = Date.now() + 3000;
			while (!existsSync(join(f.root, "descendant.ready"))) {
				assert.ok(
					Date.now() < deadline,
					"command process group did not become ready",
				);
				await delay(10);
			}
			child.kill(signal);
			assert.equal(await closed, status);
			const observed = readFileSync(join(f.root, "signals.jsonl"), "utf8")
				.trim()
				.split("\n")
				.map(JSON.parse);
			assert.deepEqual(observed.map((entry) => entry.role).sort(), [
				"command",
				"descendant",
			]);
			const finish = records(f).find((entry) => entry.type === "finish");
			assert.equal(finish.signal, signal);
			assert.equal(finish.exitCode, status);
		},
	);
}
