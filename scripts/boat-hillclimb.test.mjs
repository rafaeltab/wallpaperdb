import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execute547Asset, makeCommand } from "./lib/boat-hillclimb.mjs";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureFiles = path.join(repository, "scripts/test-fixtures");
const mono = () => Number(process.hrtime.bigint()) / 1e9;
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function fixture(t, prefix = "boat-547-") {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.symlinkSync(path.join(repository, "scripts"), path.join(root, "scripts"));
	// Real repository recipes; only downstream tool execution is controlled.
	fs.writeFileSync(
		path.join(root, "Makefile"),
		`include ${repository}/Makefile\noverride SHELL := /bin/sh\noverride TURBO := /bin/true\n`,
	);
	fs.writeFileSync(
		path.join(root, ".worktree"),
		"WORKTREE_SLOT=276\nCOMPOSE_PROJECT_NAME=wallpaperdb-control\nINGRESS_PORT=10760\n",
	);
	fs.mkdirSync(path.join(root, "bin"));
	fs.mkdirSync(path.join(root, "apps/asset"), { recursive: true });
	fs.writeFileSync(path.join(root, "apps/asset/package.json"), "{}");
	fs.writeFileSync(
		path.join(root, "bin/pnpm"),
		`#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.CONTROL_ARGV, JSON.stringify(process.argv.slice(2)));
process.stdout.write(fs.readFileSync(process.env.CONTROL_STDOUT));
process.stderr.write(fs.readFileSync(process.env.CONTROL_STDERR));
process.exitCode = 1;
`,
		{ mode: 0o700 },
	);
	const stdout = path.join(root, "tool.stdout");
	const stderr = path.join(root, "tool.stderr");
	fs.copyFileSync(path.join(fixtureFiles, "547-asset.stdout.txt"), stdout);
	fs.copyFileSync(path.join(fixtureFiles, "547-asset.stderr.txt"), stderr);
	const env = {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		PATH: `${root}/bin:${process.env.PATH}`,
		CONTROL_STDOUT: stdout,
		CONTROL_STDERR: stderr,
		CONTROL_ARGV: path.join(root, "tool-argv.json"),
	};
	const config = {
		worktree: root,
		round: "control-current",
		evidence: path.join(root, "evidence"),
		coldDeadline: mono() + 25,
	};
	return {
		root,
		stdout,
		stderr,
		env,
		config,
		run: (extra = {}) =>
			execute547Asset(config, {
				make: (argv, options) => makeCommand(argv, { ...options, env }),
				...extra,
			}),
	};
}

test("547 actual Make/capture/assessment publishes before returning", async (t) => {
	const f = fixture(t);
	const result = await f.run();
	assert.equal(result.status, "PASS");
	assert.equal(result.scope, "LOCAL_CONTROL");
	assert.deepEqual(result.outcome, {
		files: 6,
		collected: 18,
		failed: 16,
		passed: 2,
	});
	assert.equal(result.owner.ingress, 10760);
	const dir = path.join(f.config.evidence, "red-asset");
	assert.equal(json(path.join(dir, "command/receipt.json")).terminal.code, 2);
	assert.equal(json(path.join(dir, "command/disposal.json")).pipesClosed, true);
	assert.deepEqual(json(path.join(dir, "result.json")), result);
	assert.ok(
		json(path.join(dir, "manifest.json")).files.some(
			(x) => x.name === "command/stdout.raw",
		),
	);
	assert.ok(result.acceptedAt < result.deadline);
	assert.deepEqual(json(f.env.CONTROL_ARGV), [
		"--filter",
		"@wallpaperdb/asset",
		"exec",
		"vitest",
		"run",
		"--maxWorkers=1",
		"--no-file-parallelism",
		"--config",
		"vitest.integration.config.ts",
		"test/broker-acquisition",
	]);
});

test("547 Make argv transport handles paths with spaces and shell characters", async (t) => {
	const f = fixture(t, "boat 547 '$-");
	assert.equal((await f.run()).status, "PASS");
});

test("547 the public Make entry uses the same local composition", (t) => {
	const f = fixture(t);
	const config = path.join(f.root, "config.json");
	fs.writeFileSync(config, JSON.stringify(f.config));
	const r = spawnSync("make", ["boat-hillclimb-547"], {
		cwd: f.root,
		env: { ...f.env, BOAT_HILLCLIMB_CONFIG: config },
		encoding: "utf8",
		timeout: 15000,
	});
	assert.equal(r.error, undefined);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).status,
		"PASS",
	);
});

test("547 ANSI changes only the parsing view", async (t) => {
	const f = fixture(t);
	fs.writeFileSync(
		f.stderr,
		`\x1b[31m${fs.readFileSync(f.stderr, "utf8")}\x1b[0m`,
	);
	const result = await f.run();
	assert.equal(result.status, "PASS");
	assert.ok(
		fs
			.readFileSync(
				path.join(f.config.evidence, "red-asset/command/stderr.raw"),
			)
			.includes(Buffer.from("\x1b[31m")),
	);
});

for (const [name, change] of [
	[
		"setup failure cannot substitute for Make2",
		(f) => fs.writeFileSync(f.stderr, "Cannot find package vitest\n"),
	],
	[
		"a missing case cannot satisfy the summary",
		(f) =>
			fs.writeFileSync(
				f.stdout,
				fs
					.readFileSync(f.stdout, "utf8")
					.replace(
						/^.*×.*closes the native silent-peer socket after timeout.*\n/m,
						"",
					),
			),
	],
	[
		"a changed healthy neighbor is refused",
		(f) =>
			fs.writeFileSync(
				f.stdout,
				fs
					.readFileSync(f.stdout, "utf8")
					.replace(
						/✓([^\n]*preserves healthy authenticated acquisition)/,
						"×$1",
					),
			),
	],
])
	test(`547 ${name}`, async (t) => {
		const f = fixture(t);
		change(f);
		await assert.rejects(f.run());
		assert.equal(
			json(path.join(f.config.evidence, "red-asset/result.json")).status,
			"FAIL",
		);
	});

test("547 equal-length captured raw drift is refused", async (t) => {
	const f = fixture(t);
	await assert.rejects(
		f.run({
			make: async (argv, options) => {
				const r = await makeCommand(argv, { ...options, env: f.env });
				const file = path.join(options.directory, "stdout.raw");
				const b = fs.readFileSync(file);
				b[0] ^= 1;
				fs.writeFileSync(file, b);
				return r;
			},
		}),
		/integrity/,
	);
});

test("547 early command completion cannot excuse delayed acceptance", async (t) => {
	const f = fixture(t);
	let offset = 0;
	await assert.rejects(
		f.run({
			clock: () => mono() + offset,
			make: async (argv, options) => {
				const r = await makeCommand(argv, { ...options, env: f.env });
				offset = 30;
				return r;
			},
		}),
		/deadline/,
	);
	const r = json(path.join(f.config.evidence, "red-asset/result.json"));
	assert.equal(r.status, "FAIL");
	assert.ok(
		json(path.join(f.config.evidence, "red-asset/command/receipt.json")).ended
			.monotonic < r.deadline,
	);
});

test("547 final publication delay cannot leave a passing result", async (t) => {
	const f = fixture(t);
	let offset = 0;
	await assert.rejects(
		f.run({
			clock: () => mono() + offset,
			publication: (file, value) => {
				fs.writeFileSync(file, JSON.stringify(value));
				offset = 30;
			},
		}),
		/deadline/,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).status,
		"FAIL",
	);
});

test("547 input mutation during publication is refused", async (t) => {
	const f = fixture(t);
	await assert.rejects(
		f.run({
			publication: (file, value) => {
				fs.writeFileSync(file, JSON.stringify(value));
				fs.appendFileSync(
					path.join(f.root, ".worktree"),
					"\n# concurrent change\n",
				);
			},
		}),
		/source or owner changed/,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).status,
		"FAIL",
	);
});

function publishControlledOwner(f, predecessor) {
	const key = createHash("sha256").update(f.root).digest("hex").slice(0, 12);
	fs.mkdirSync(path.join(f.root, ".boat"));
	fs.writeFileSync(
		path.join(f.root, ".boat/enrollment.json"),
		JSON.stringify({
			root: f.root,
			key,
			size: "large",
			mode: "development",
			lifecycle: "fresh-after-stop",
		}),
	);
	fs.writeFileSync(
		path.join(f.root, ".boat/state.json"),
		JSON.stringify({
			id: "controlled-worker",
			runningSince: 1,
			admission: {
				status: "published",
				token: "controlled-admission",
				owner: { root: f.root, key },
				candidate: {
					id: "controlled-worker",
					size: "large",
					name: "controlled",
				},
				name: "controlled",
				previousWorkerId: predecessor,
			},
		}),
	);
	const workload = json(
		path.join(repository, "scripts/boat-workloads/547.json"),
	);
	for (const input of [
		...workload.inputs.tests,
		workload.inputs.initialLock,
		workload.inputs.unchangedProtectedControl,
	]) {
		const p = path.join(f.root, input.path);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		const b = spawnSync("git", ["cat-file", "blob", input.gitBlob], {
			cwd: repository,
			maxBuffer: 2 * 1024 * 1024,
		});
		assert.equal(b.status, 0);
		fs.writeFileSync(p, b.stdout);
	}
	for (const input of workload.inputs.repair.filter((x) =>
		x.path.startsWith("apps/asset/"),
	)) {
		const p = path.join(f.root, input.path);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		const b = spawnSync(
			"git",
			["show", `${workload.productBase}:${input.path}`],
			{ cwd: repository },
		);
		assert.equal(b.status, 0);
		fs.writeFileSync(p, b.stdout);
	}
	// Only frozen object bytes are copied; no provider or Git checkout is created.
	f.env.BOAT_EXEC = "local";
}

for (const predecessor of [undefined, null])
	test(`547 published owner accepts optional predecessor ${predecessor}`, async (t) => {
		const f = fixture(t);
		publishControlledOwner(f, predecessor);
		const result = await f.run();
		assert.equal(result.owner.worker, "controlled-worker");
		assert.equal(result.status, "PASS");
	});

for (const providerCompleted of [true, false])
	test(`547 failure stops once and retains provider completion ${providerCompleted}`, async (t) => {
		const f = fixture(t);
		publishControlledOwner(f);
		fs.writeFileSync(f.stderr, "Cannot find package vitest\n");
		// External lifecycle effect is controlled; Make/capture/result handling stays real.
		fs.appendFileSync(
			path.join(f.root, "Makefile"),
			"\nboat-stop:\n\t@node stop-control.cjs\n",
		);
		fs.writeFileSync(
			path.join(f.root, "stop-control.cjs"),
			`const fs = require('node:fs');
const p = '.boat/state.json', state = JSON.parse(fs.readFileSync(p));
fs.appendFileSync('stop-calls', 'one\\n');
state.runningSince = null;
state.shutdownAttempt = {workerId:state.id, status:'completed-observed', accountingAppliedAt:'2026-11-03T00:00:01Z', completion:{provider:{stop:{id:'controlled-stop', status:${JSON.stringify(providerCompleted ? "completed" : "pending")}, forced:false, error:null, endedAt:${JSON.stringify(providerCompleted ? "2026-11-03T00:00:00Z" : null)}}}}};
fs.writeFileSync(p, JSON.stringify(state));`,
		);
		await assert.rejects(f.run(), /SETUP_OR_COLLECTION/);
		assert.equal(
			fs.readFileSync(path.join(f.root, "stop-calls"), "utf8"),
			"one\n",
		);
		const r = json(path.join(f.config.evidence, "red-asset/result.json"));
		assert.equal(r.status, "FAIL");
		assert.equal(
			r.cleanup.status,
			providerCompleted
				? "STOPPED_ACCOUNTED"
				: "STOPPED_ACCOUNTED_OPERATION_UNVERIFIED",
		);
	});

test("547 changed owner forbids stopping another worker", async (t) => {
	const f = fixture(t);
	publishControlledOwner(f);
	await assert.rejects(
		f.run({
			make: async (argv, options) => {
				assert.equal(
					argv[1],
					"test-focused",
					"no competing stop after owner changes",
				);
				const r = await makeCommand(argv, { ...options, env: f.env });
				const file = path.join(f.root, ".boat/state.json"),
					s = json(file);
				s.id = "different-worker";
				s.admission.candidate.id = s.id;
				fs.writeFileSync(file, JSON.stringify(s));
				return r;
			},
		}),
		/owner changed/,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).cleanup.status,
		"UNRESOLVED",
	);
});
