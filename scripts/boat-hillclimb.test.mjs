import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execute547Asset, makeCommand } from "./lib/boat-hillclimb.mjs";
import { objects547 } from "./test-fixtures/547-inputs.mjs";

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
	[
		"a different assertion cannot satisfy the case counts",
		(f) =>
			fs.writeFileSync(
				f.stderr,
				fs
					.readFileSync(f.stderr, "utf8")
					.replace("expected 1 to be +0", "expected 2 to be +0"),
			),
	],
	[
		"an unrelated assertion source cannot satisfy native closure",
		(f) =>
			fs.writeFileSync(
				f.stderr,
				fs
					.readFileSync(f.stderr, "utf8")
					.replaceAll("broker-acquisition.ts", "unrelated-source.ts"),
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
			cohort: "c",
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
		fs.writeFileSync(p, objects547.readBlob(input.gitBlob));
	}
	for (const input of workload.inputs.repair.filter((x) =>
		x.path.startsWith("apps/asset/"),
	)) {
		const p = path.join(f.root, input.path);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(
			p,
			objects547.readBlob(objects547.baselineBlob(input.path)),
		);
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

function installControlledStop(f, providerCompleted = true) {
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
state.shutdownAttempt = {workerId:state.id, status:'completed-observed', accountingAppliedAt:'2026-11-03T00:00:01Z', completion:{workerId:state.id, provider:{id:state.id, stop:{id:'controlled-stop', status:${JSON.stringify(providerCompleted ? "completed" : "pending")}, forced:false, error:null, endedAt:${JSON.stringify(providerCompleted ? "2026-11-03T00:00:00Z" : null)}}}}};
fs.writeFileSync(p, JSON.stringify(state));`,
	);
}

for (const providerCompleted of [true, false])
	test(`547 failure stops once and retains provider completion ${providerCompleted}`, async (t) => {
		const f = fixture(t);
		publishControlledOwner(f);
		fs.writeFileSync(f.stderr, "Cannot find package vitest\n");
		installControlledStop(f, providerCompleted);
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

for (const file of [
	"pnpm-lock.yaml",
	"apps/asset/test/broker-acquisition-events.integration.test.ts",
	"apps/asset/src/adapters/cleanup/worker.ts",
])
	test(`547 frozen byte drift refuses ${file} before native work`, async (t) => {
		const f = fixture(t);
		publishControlledOwner(f);
		installControlledStop(f);
		fs.appendFileSync(path.join(f.root, file), "\n# changed\n");
		await assert.rejects(f.run(), /Frozen workload input changed/);
		assert.equal(fs.existsSync(f.env.CONTROL_ARGV), false);
		assert.equal(
			fs.readFileSync(path.join(f.root, "stop-calls"), "utf8"),
			"one\n",
		);
	});

test("547 frozen input mutation during final publication cannot pass", async (t) => {
	const f = fixture(t);
	publishControlledOwner(f);
	installControlledStop(f);
	await assert.rejects(
		f.run({
			publication: (file, value) => {
				fs.writeFileSync(file, JSON.stringify(value));
				fs.appendFileSync(
					path.join(f.root, "pnpm-lock.yaml"),
					"\n# concurrent change\n",
				);
			},
		}),
		/Phase source or owner changed/,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).status,
		"FAIL",
	);
	assert.match(
		fs.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8"),
		/concurrent change/,
	);
});

for (const [transition, guarded] of [
	["published-worker", false],
	["published-worker", true],
	["pending-candidate", false],
	["pending-candidate", true],
	["unchanged", true],
	["admission-token", true],
])
	test(`547 controller lifecycle-lock ${transition} with bound stop ${guarded}`, async (t) => {
		const f = fixture(t);
		publishControlledOwner(f);
		f.env.HOME = path.join(f.root, "home");
		fs.mkdirSync(f.env.HOME);
		const enrollment = path.join(f.root, ".boat/enrollment.json"),
			e = json(enrollment);
		// Allow a second 500ms lifecycle-lock poll within a tightened ordinary stop budget.
		e.shutdownBudgetMs = 30000;
		fs.writeFileSync(enrollment, JSON.stringify(e));
		const lock = path.join(f.root, ".boat/lifecycle.lock");
		fs.mkdirSync(lock);
		fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
		t.after(() => {
			if (fs.existsSync(lock)) fs.rmSync(lock, { recursive: true });
		});
		fs.writeFileSync(f.stderr, "Cannot find package vitest\n");
		fs.mkdirSync(path.join(f.root, ".mise/boat"), { recursive: true });
		fs.writeFileSync(
			path.join(f.root, ".mise/boat/boat"),
			`#!/usr/bin/env node
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync('provider-calls', JSON.stringify(args)+'\\n');
const state = JSON.parse(fs.readFileSync('.boat/state.json')), a = state.admission;
if(args.includes('new-candidate') && args.includes('info')) {
 const stopped = fs.existsSync('candidate-stopped');
 console.log(JSON.stringify({sandbox:{id:'new-candidate',name:a.name,type:a.size,state:stopped?'stopped':'ready',stop:stopped?{id:'controlled-stop',status:'completed',forced:false,error:null,endedAt:'2026-11-03T00:00:00Z'}:undefined}}));
} else if(args.includes('new-candidate') && args.includes('stop')) {
 fs.writeFileSync('candidate-stopped','yes'); console.log('{}');
} else if(args.includes('ssh')) {
 // Controlled watcher retirement has no external effect.
} else if(args.includes('usage')) console.log('{}');
else process.exitCode = 1;
`,
			{ mode: 0o700 },
		);
		await assert.rejects(
			f.run({
				make: async (argv, options) => {
					// The false neighbor reproduces the former unqualified Make call.
					const selected = guarded
						? argv
						: argv.filter((arg) => !arg.startsWith("BOAT_EXPECTED_"));
					const pending = makeCommand(selected, { ...options, env: f.env });
					if (argv[1] === "boat-stop") {
						assert.equal(argv[2], "BOAT_EXPECTED_WORKER_ID=controlled-worker");
						assert.equal(
							argv[3],
							"BOAT_EXPECTED_ADMISSION=controlled-admission",
						);
						const end = mono() + 2;
						while (
							!fs.existsSync(
								path.join(f.root, ".boat/shutdown-processes.jsonl"),
							)
						) {
							if (mono() >= end) {
								fs.rmSync(lock, { recursive: true });
								await pending;
								throw new Error("Controller did not enter shutdown");
							}
							await new Promise((resolve) => setTimeout(resolve, 10));
						}
						const statePath = path.join(f.root, ".boat/state.json"),
							state = json(statePath);
						if (transition === "published-worker") {
							state.id = "new-owner";
							state.admission.candidate.id = state.id;
						} else if (transition === "pending-candidate") {
							const token = "11111111-2222-4333-8444-555555555555";
							const name = `wallpaperdb-557-${e.cohort}-${e.key}-${token}`;
							state.admission = {
								status: "candidate-owned",
								owner: { root: f.root, key: e.key },
								token,
								name,
								size: e.size,
								previousWorkerId: state.id,
								runningSince: Date.now(),
								candidate: { id: "new-candidate", name, size: e.size },
							};
						} else if (transition === "admission-token") {
							state.admission.token = "another-admission";
						}
						fs.writeFileSync(statePath, JSON.stringify(state));
						fs.rmSync(lock, { recursive: true });
					}
					return pending;
				},
			}),
			/SETUP_OR_COLLECTION/,
		);
		const state = json(path.join(f.root, ".boat/state.json"));
		assert.equal(
			state.id,
			transition === "published-worker" ? "new-owner" : "controlled-worker",
		);
		assert.equal(state.runningSince, 1);
		if (guarded && transition !== "unchanged") {
			assert.equal(state.shutdownAttempt, undefined);
			assert.equal(fs.existsSync(path.join(f.root, "provider-calls")), false);
			assert.match(
				fs.readFileSync(
					path.join(f.config.evidence, "owning-stop/stderr.raw"),
					"utf8",
				),
				/Expected stop ownership changed/,
			);
		} else {
			if (transition === "published-worker" || transition === "unchanged")
				assert.equal(
					state.shutdownAttempt.workerId,
					state.id,
					"unqualified stop reaches the wrong synthetic owner",
				);
			else {
				const calls = fs
					.readFileSync(path.join(f.root, "provider-calls"), "utf8")
					.trim()
					.split("\n")
					.map(JSON.parse);
				assert.ok(
					calls.some(
						(args) => args.includes("stop") && args.includes("new-candidate"),
					),
					"unqualified cleanup must reach candidate B stop at the controlled provider seam",
				);
			}
			assert.equal(
				fs.existsSync(path.join(f.root, "provider-calls")),
				true,
				"counterexample must reach the controlled provider seam",
			);
		}
		assert.equal(
			json(path.join(f.config.evidence, "red-asset/result.json")).cleanup
				.status,
			"UNRESOLVED",
		);
	});

test("547 a missing mandatory worker cannot become local-control success", async (t) => {
	const f = fixture(t);
	publishControlledOwner(f);
	const file = path.join(f.root, ".boat/state.json"),
		state = json(file);
	delete state.id;
	delete state.admission.candidate.id;
	fs.writeFileSync(file, JSON.stringify(state));
	await assert.rejects(f.run(), /Owned published worker/);
	assert.equal(fs.existsSync(f.env.CONTROL_ARGV), false);
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

test("547 an active Make command is retired at the original execution cutoff", async (t) => {
	let finishSafety = () => {};
	t.after(() => finishSafety()); // Retire before the fixture directory is removed.
	const f = fixture(t);
	f.config.coldDeadline = mono() + 6;
	const owned = `${f.env.CONTROL_ARGV}.owner.json`;
	let safetyUsed = false;
	const safety = () => {
		if (!fs.existsSync(owned)) return;
		const record = json(owned);
		try {
			const stat = fs.readFileSync(`/proc/${record.pid}/stat`, "utf8");
			const birth = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
			if (
				birth === record.birth &&
				fs.readlinkSync(`/proc/${record.pid}/cwd`) === f.root
			) {
				safetyUsed = true;
				process.kill(record.pid, "SIGTERM");
			}
		} catch (error) {
			if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
		}
	};
	const independent = setTimeout(safety, 3000);
	finishSafety = () => {
		clearTimeout(independent);
		safety();
	};
	fs.writeFileSync(
		path.join(f.root, "bin/pnpm"),
		`#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.CONTROL_ARGV, JSON.stringify(process.argv.slice(2)));
const stat = fs.readFileSync('/proc/self/stat', 'utf8');
fs.writeFileSync(process.env.CONTROL_ARGV+'.owner.json', JSON.stringify({pid:process.pid,birth:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]}));
setInterval(() => {}, 1000);
`,
		{ mode: 0o700 },
	);
	await assert.rejects(
		f.run(),
		/terminal or drainage|completion or original deadline/,
	);
	const directory = path.join(f.config.evidence, "red-asset/command");
	const receipt = json(path.join(directory, "receipt.json"));
	assert.match(receipt.failure, /deadline exceeded/);
	assert.equal(receipt.captureComplete, false);
	assert.equal(
		safetyUsed,
		false,
		"capture must retire the command before independent safety",
	);
	assert.ok(
		fs.existsSync(f.env.CONTROL_ARGV),
		"actual command reached the external seam before cancellation",
	);
	assert.equal(json(path.join(directory, "disposal.json")).pipesClosed, true);
	assert.deepEqual(json(path.join(directory, "disposal.json")).unresolved, []);
	assert.equal(
		json(path.join(f.config.evidence, "red-asset/result.json")).status,
		"FAIL",
	);
});
