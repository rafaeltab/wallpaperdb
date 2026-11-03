import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import * as runner from "./lib/boat-hillclimb.mjs";
import { captureServingCommand } from "./lib/boat-capture.mjs";
import { objects547 } from "./test-fixtures/547-inputs.mjs";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mono = () => Number(process.hrtime.bigint()) / 1e9;

async function servingPorts(t) {
	const leases = path.join(os.tmpdir(), "wallpaperdb-547-test-ports");
	fs.mkdirSync(leases, { recursive: true, mode: 0o700 });
	const until = mono() + 5;
	while (mono() < until) {
		const sockets = [net.createServer(), net.createServer()],
			claimed = [];
		const release = async () =>
			Promise.all(
				sockets.map((server) =>
					server.listening
						? new Promise((resolve, reject) =>
								server.close((error) => (error ? reject(error) : resolve())),
							)
						: undefined,
				),
			);
		const remove = () => {
			for (const file of claimed) fs.unlinkSync(file);
		};
		try {
			const listen = (server, port) =>
				new Promise((resolve, reject) => {
					server.once("error", reject);
					server.listen(port, "127.0.0.1", resolve);
				});
			await listen(sockets[0], 0);
			const ingress = sockets[0].address().port;
			if (ingress + 20000 > 65535) {
				await release();
				continue;
			}
			// Keep a cooperative lease through the listener handoff. Other fixture
			// processes cannot choose these ports between reservation and startup.
			for (const port of [ingress, ingress + 20000]) {
				const file = path.join(leases, String(port));
				const fd = fs.openSync(file, "wx", 0o600);
				fs.closeSync(fd);
				claimed.push(file);
			}
			await listen(sockets[1], ingress + 20000);
			t.after(async () => {
				await release();
				remove();
			});
			return { ingress, release };
		} catch (error) {
			await release();
			remove();
			if (!["EADDRINUSE", "EEXIST"].includes(error.code)) throw error;
		}
	}
	throw new Error("No isolated #547 serving port pair available");
}

function preparationFixture(t, nativeObjects = false) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-preparation-"));
	fs.writeFileSync(
		path.join(root, "Makefile"),
		`include ${repository}/Makefile\noverride SHELL := /bin/sh\n`,
	);
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const workload = json(
		path.join(repository, "scripts/boat-workloads/547.json"),
	);
	if (nativeObjects) {
		const appArchive = execFileSync(
			"git",
			["archive", workload.productBase, "apps"],
			{ cwd: repository, maxBuffer: 32 * 1024 * 1024 },
		);
		assert.equal(
			spawnSync("tar", ["xf", "-"], { cwd: root, input: appArchive }).status,
			0,
		);
		for (const [file, blob] of [
			["pnpm-lock.yaml", workload.inputs.initialLock.gitBlob],
			[
				"pnpm-workspace.yaml",
				workload.resolutionDiagnostic.baselineWorkspaceBlob,
			],
		])
			fs.writeFileSync(
				path.join(root, file),
				execFileSync("git", ["cat-file", "blob", blob], { cwd: repository }),
			);
	} else {
		for (const item of objects547.baselineApps()) {
			const file = path.join(root, item.path);
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, objects547.readBlob(item.blob), {
				mode: item.mode === "100755" ? 0o755 : 0o644,
			});
		}
		fs.writeFileSync(
			path.join(root, "pnpm-lock.yaml"),
			objects547.readBlob(workload.inputs.initialLock.gitBlob),
		);
		fs.writeFileSync(
			path.join(root, "pnpm-workspace.yaml"),
			objects547.readBlob(workload.resolutionDiagnostic.baselineWorkspaceBlob),
		);
	}
	fs.writeFileSync(
		path.join(root, ".worktree"),
		"WORKTREE_SLOT=276\nCOMPOSE_PROJECT_NAME=wallpaperdb-control\nINGRESS_PORT=10760\n",
	);
	fs.mkdirSync(path.join(root, "bin"));
	const nativeMake = execFileSync("which", ["make"], {
		encoding: "utf8",
	}).trim();
	fs.writeFileSync(
		path.join(root, "bin/make"),
		`#!/usr/bin/env node
const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(nativeMake)},['-f','controlled.mk',...args],{stdio:'inherit',env:{...process.env,CONTROL_MAKE_ARGV:JSON.stringify(['make',...args])}});process.exitCode=r.status??1;
`,
		{ mode: 0o700 },
	);
	fs.writeFileSync(
		path.join(root, "controlled.mk"),
		`.PHONY: boat-enroll boat-prepare-toolchain test-focused toolchain run build check docker-run boat-prepare-infra-images boat-stop infra-start dev boat-preview\nboat-enroll boat-prepare-toolchain test-focused toolchain run build check docker-run boat-prepare-infra-images boat-stop infra-start:\n\t@node ${repository}/scripts/test-fixtures/547-make-effect.cjs\ndev boat-preview:\n\t@node ${repository}/scripts/test-fixtures/547-serving-effect.mjs $(if $(filter dev,$@),dev,preview)\n`,
	);
	const env = {
		...process.env,
		MAKEFLAGS: "",
		MFLAGS: "",
		PATH: `${root}/bin:${process.env.PATH}`,
		CONTROL_REPOSITORY: repository,
		CONTROL_PROJECT: "wallpaperdb-control",
	};
	const config = {
		worktree: root,
		round: "fresh-stable",
		evidence: path.join(root, "evidence"),
	};
	const observeCli = (file) => ({
		path: file,
		sha256: json(
			path.join(repository, "scripts/boat-workloads/547-preparation.json"),
		).cliSha256,
	});
	let portPromise;
	const f = {
		root,
		config,
		env,
		observeCli,
		servingPorts: () =>
			(portPromise ??= servingPorts(t).then((ports) => {
				const file = path.join(root, ".worktree");
				fs.writeFileSync(
					file,
					fs
						.readFileSync(file, "utf8")
						.replace(/^INGRESS_PORT=10760$/m, `INGRESS_PORT=${ports.ingress}`),
				);
				return ports;
			})),
		make: async (argv, options) => {
			if (options.serving && argv[1] === "boat-preview")
				await (await f.servingPorts()).release();
			return runner.makeCommand(argv, {
				...options,
				env: { ...env, CONTROL_MAKE_ARGV: JSON.stringify(argv) },
			});
		},
	};
	f.run = async (extra = {}) => {
		if (config.until === "ready") await f.servingPorts();
		return runner.execute547Preparation(config, {
			make: f.make,
			observeCli,
			objects: nativeObjects ? undefined : objects547,
			...extra,
		});
	};
	return f;
}

test("547 complete preparation reuses Make capture and publishes each phase before returning", async (t) => {
	const f = preparationFixture(t);
	const result = await f.run({
		make: f.make,
		observeCli: f.observeCli,
	});
	assert.equal(result.status, "PASS_PREDEV_THROUGH_IMAGES");
	assert.equal(result.next, "HOLD_BEFORE_SDK8");
	assert.equal(result.owner.worker, "controlled-worker");
	assert.equal(result.coldDeadline - result.coldStarted, 1200);
	const wanted = [
		"enroll",
		"prepare-toolchain",
		"red-user",
		"red-wallpaper",
		"red-asset",
		"red-auth",
		"toolchain",
		"generate",
		"frozen",
		"noop",
		"green-user",
		"green-wallpaper",
		"green-asset",
		"green-auth",
		"check-user",
		"check-wallpaper",
		"check-asset",
		"metadata",
		"chromium-install",
		"chromium-launch",
		"prepare-infra-images",
	];
	assert.deepEqual(
		result.phases.map((p) => p.phase),
		wanted,
	);
	for (const phase of result.phases) {
		const directory = path.join(f.config.evidence, phase.phase);
		assert.equal(json(path.join(directory, "result.json")).status, "PASS");
		assert.ok(phase.acceptedAt < phase.deadline);
		assert.ok(
			phase.deadline <=
				(phase.phase === "enroll" ? Infinity : result.coldDeadline),
		);
		assert.equal(
			json(path.join(directory, "command/disposal.json")).pipesClosed,
			true,
		);
		assert.deepEqual(
			json(path.join(directory, "command/disposal.json")).unresolved,
			[],
		);
	}
	assert.equal(
		json(path.join(f.config.evidence, "preparation-result.json")).status,
		result.status,
	);
	assert.equal(
		fs.existsSync(path.join(f.root, "apps/user/src/boat-live-547.ts")),
		false,
	);
	assert.equal(
		result.phases.find((p) => p.phase === "generate").outcome.approvedChanges[
			"peer-context"
		],
		3,
	);
});

test("547 ready fixtures run concurrently with independent native listeners", async (t) => {
	const fixtures = [preparationFixture(t), preparationFixture(t)];
	for (const f of fixtures) f.config.until = "ready";
	const outcomes = await Promise.allSettled(fixtures.map((f) => f.run()));
	try {
		assert.deepEqual(
			outcomes.map((r) => r.status),
			["fulfilled", "fulfilled"],
			JSON.stringify(
				outcomes.map((r) =>
					r.status === "rejected" ? r.reason.message : r.value.url,
				),
			),
		);
		assert.notEqual(outcomes[0].value.url, outcomes[1].value.url);
		for (const r of outcomes)
			assert.equal(r.value.status, "PASS_STARTUP_READY");
	} finally {
		await Promise.all(
			outcomes
				.filter((r) => r.status === "fulfilled")
				.map((r) => r.value.serving.stop()),
		);
	}
});

test("547 ready milestone owns real Make serving captures and publishes readiness before returning", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	const result = await f.run();
	t.after(() => result.serving.stop());
	assert.equal(result.status, "PASS_STARTUP_READY");
	assert.equal(result.owner.worker, "controlled-worker");
	assert.equal(result.deadline - result.started, 600);
	assert.equal(result.containers.length, 10);
	assert.deepEqual(result.containers.map((x) => x.service).sort(), [
		"asset",
		"caddy",
		"color-extractor",
		"gateway",
		"ingestor",
		"tags",
		"user",
		"variant-generator",
		"wallpaper",
		"web",
	]);
	assert.deepEqual(
		result.routes.map((r) => r.path).sort(),
		[
			"/web/",
			"/ingestor/ready",
			"/asset/ready",
			"/wallpaper/ready",
			"/gateway/ready",
			"/variant-generator/ready",
			"/color-extractor/ready",
			"/user/ready",
		].sort(),
	);
	assert.equal(result.preview.ready, true);
	assert.equal(
		result.ownership.capturedObservations.some((x) => x.status === "absent"),
		true,
	);
	assert.equal(
		json(path.join(f.config.evidence, "startup/result.json")).status,
		result.status,
	);
	assert.equal(result.acceptedAt < result.deadline, true);
	assert.equal(
		Object.keys(json(path.join(f.root, "sdk8-observed-before-infra.json")))
			.length,
		8,
	);
	assert.equal(
		fs.existsSync(path.join(f.config.evidence, "startup/dev/receipt.json")),
		false,
	);
	assert.deepEqual(
		jsonLines(path.join(f.root, "routes-observed.jsonl")).sort(),
		result.routes.map((r) => r.path).sort(),
	);
	const proof = json(path.join(f.config.evidence, "startup/manifest.json"));
	assert.equal(
		proof.files.some((r) => r.name === "dev/stdout.raw"),
		false,
	);
	assert.equal(
		proof.files.some((r) => r.name === "dev/stdout.ready.raw"),
		true,
	);
	await result.serving.stop();
	assert.equal(
		json(path.join(f.config.evidence, "startup/cleanup.json")).status,
		"STOPPED_ACCOUNTED",
	);
	for (const name of ["dev", "preview"])
		assert.equal(
			json(path.join(f.config.evidence, `startup/${name}/disposal.json`))
				.pipesClosed,
			true,
		);
});

const jsonLines = (file) =>
	fs.readFileSync(file, "utf8").trim().split("\n").map(JSON.parse);

test("547 startup inventory crosses real Make queue and worker observation with controlled Docker", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	fs.symlinkSync(
		path.join(repository, "scripts"),
		path.join(f.root, "scripts"),
	);
	fs.writeFileSync(
		path.join(f.root, "bin/docker"),
		`#!/bin/sh\nexec node ${repository}/scripts/test-fixtures/547-docker-effect.cjs "$@"\n`,
		{ mode: 0o700 },
	);
	const makeDirectory = path.dirname(
		execFileSync("which", ["make"], { encoding: "utf8" }).trim(),
	);
	const result = await f.run({
		make: (argv, options) =>
			argv.some((arg) => arg.includes("application-"))
				? runner.makeCommand(argv, {
						...options,
						env: {
							...f.env,
							PATH: `${makeDirectory}:${f.env.PATH}`,
							BOAT_EXEC: "local",
							DOCKER_VALIDATION_LOCK_FILE: path.join(f.root, "docker.lock"),
						},
					})
				: f.make(argv, options),
	});
	try {
		assert.equal(result.containers.length, 10);
		const output = fs.readFileSync(
			path.join(f.config.evidence, "startup/app-inventory/command/stdout.raw"),
			"utf8",
		);
		assert.match(output, /Docker validation waited/);
		assert.match(output, /BOAT547_APPLICATION/);
	} finally {
		await result.serving.stop();
	}
});

test("547 startup cannot leave held compute open when its evidence directory cannot be acquired", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	await assert.rejects(
		f.run({
			publication(file, value) {
				fs.writeFileSync(file, JSON.stringify(value));
				if (file.endsWith("preparation-result.json")) {
					fs.mkdirSync(path.join(f.config.evidence, "startup"));
					fs.writeFileSync(
						path.join(f.config.evidence, "startup/prior"),
						"preserve",
					);
				}
			},
		}),
		/EEXIST/,
	);
	assert.equal(json(path.join(f.root, ".boat/state.json")).runningSince, null);
	assert.equal(
		fs.readFileSync(path.join(f.config.evidence, "startup/prior"), "utf8"),
		"preserve",
	);
	assert.equal(
		jsonLines(path.join(f.root, "commands.jsonl")).filter(
			(a) => a[1] === "boat-stop",
		).length,
		1,
	);
});

for (const scenario of ["route", "service", "late-publication"]) {
	test(`547 startup refuses ${scenario} and retires serving captures before one owning stop`, async (t) => {
		const f = preparationFixture(t);
		f.config.until = "ready";
		if (scenario === "route") f.env.CONTROL_BAD_ROUTE = "/asset/ready";
		if (scenario === "service") f.env.CONTROL_MISSING_SERVICE = "1";
		let now = mono();
		const options =
			scenario === "late-publication"
				? {
						clock: () => now,
						publication(file, result) {
							fs.writeFileSync(file, JSON.stringify(result));
							if (file.endsWith("startup/result.json")) now += 601;
						},
					}
				: {};
		await assert.rejects(
			f.run(options),
			scenario === "route"
				? /Readiness route failed/
				: scenario === "service"
					? /Required ten/
					: /Original startup deadline/,
		);
		const result = json(path.join(f.config.evidence, "startup/result.json"));
		assert.equal(result.status, "FAIL");
		assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
		assert.equal(result.next, undefined);
		assert.deepEqual(
			Object.keys(
				json(path.join(f.root, "retirement-observed-before-stop.json")),
			).sort(),
			["dev", "preview"],
		);
		const commands = jsonLines(path.join(f.root, "commands.jsonl"));
		assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
		if (scenario === "service")
			assert.equal(
				commands.some((a) => a.some((x) => x.includes("application-inspect"))),
				false,
			);
		for (const name of ["dev", "preview"]) {
			const disposal = json(
				path.join(f.config.evidence, `startup/${name}/disposal.json`),
			);
			assert.equal(disposal.pipesClosed, true);
			assert.deepEqual(disposal.unresolved, []);
		}
	});
}

function publicEntry(f) {
	fs.symlinkSync(
		path.join(repository, "scripts"),
		path.join(f.root, "scripts"),
	);
	fs.writeFileSync(
		path.join(f.root, "Makefile"),
		`include ${repository}/Makefile\noverride SHELL := /bin/sh\n`,
	);
	const file = path.join(f.root, "config.json");
	fs.writeFileSync(file, JSON.stringify(f.config));
	const make = execFileSync("which", ["make"], { encoding: "utf8" }).trim();
	return spawnSync(make, ["boat-hillclimb-547"], {
		cwd: f.root,
		env: { ...f.env, BOAT_HILLCLIMB_CONFIG: file },
		encoding: "utf8",
		timeout: 15000,
	});
}

if (process.env.BOAT_547_QUALIFIED_CLI) {
	test("547 qualified public ready entry owns preparation through serving and signal cleanup", {
		timeout: 30000,
	}, async (t) => {
		const f = preparationFixture(t, true);
		f.config.until = "ready";
		await (await f.servingPorts()).release();
		fs.symlinkSync(
			path.join(repository, "scripts"),
			path.join(f.root, "scripts"),
		);
		fs.mkdirSync(path.join(f.root, ".mise/boat"), { recursive: true });
		fs.copyFileSync(
			process.env.BOAT_547_QUALIFIED_CLI,
			path.join(f.root, ".mise/boat/boat"),
		);
		const file = path.join(f.root, "config.json");
		fs.writeFileSync(file, JSON.stringify(f.config));
		const make = execFileSync("which", ["make"], { encoding: "utf8" }).trim();
		const capture = captureServingCommand({
			argv: [make, "boat-hillclimb-547"],
			directory: path.join(f.root, "entry-capture"),
			cwd: f.root,
			env: { ...f.env, BOAT_HILLCLIMB_CONFIG: file },
		});
		try {
			const deadline = mono() + 15;
			const resultFile = path.join(f.config.evidence, "startup/result.json");
			while (!fs.existsSync(resultFile)) {
				capture.assertRunning();
				assert.ok(
					mono() < deadline,
					"Public ready entry must publish inside control deadline",
				);
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			const result = json(resultFile);
			assert.equal(result.status, "PASS_STARTUP_READY", JSON.stringify(result));
			assert.equal(result.containers.length, 10);
			assert.equal(result.routes.length, 8);
			assert.ok(result.acceptedAt < result.deadline);
		} finally {
			await capture.stop();
		}
		assert.equal(
			json(path.join(f.root, ".boat/state.json")).runningSince,
			null,
		);
		assert.equal(
			jsonLines(path.join(f.root, "commands.jsonl")).filter(
				(a) => a[1] === "boat-stop",
			).length,
			1,
		);
		assert.equal(
			json(path.join(f.root, "entry-capture/disposal.json")).pipesClosed,
			true,
		);
		assert.deepEqual(
			json(path.join(f.root, "entry-capture/disposal.json")).unresolved,
			[],
		);
	});

	test("547 qualified public missing artifact refuses missing post-bootstrap artifact before compute", (t) => {
		const f = preparationFixture(t, true);
		const r = publicEntry(f);
		assert.equal(r.status, 2);
		assert.match(r.stderr, /ENOENT/);
		assert.equal(
			json(path.join(f.config.evidence, "enroll/command/receipt.json")).terminal
				.code,
			0,
		);
		assert.equal(
			json(path.join(f.config.evidence, "preparation-result.json")).status,
			"FAIL",
		);
		assert.equal(fs.existsSync(path.join(f.root, ".boat/state.json")), false);
	});

	// Optional explicit composition qualification after ordinary local boat-bootstrap.
	// Default tests stay offline. The installed CLI is read and hashed, never used for provider work.
	test("547 qualified public entry completes the full controlled Make preparation", (t) => {
		const f = preparationFixture(t, true);
		fs.mkdirSync(path.join(f.root, ".mise/boat"), { recursive: true });
		fs.copyFileSync(
			process.env.BOAT_547_QUALIFIED_CLI,
			path.join(f.root, ".mise/boat/boat"),
		);
		const r = publicEntry(f);
		assert.equal(r.error, undefined);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.equal(
			json(path.join(f.config.evidence, "preparation-result.json")).status,
			"PASS_PREDEV_THROUGH_IMAGES",
		);
	});
}

test("547 preparation publishes failure and stops once without advancing the fixed sequence", async (t) => {
	const f = preparationFixture(t);
	f.env.CONTROL_FAIL = "red-wallpaper";
	await assert.rejects(() =>
		f.run({
			make: f.make,
			observeCli: f.observeCli,
		}),
	);
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
	const commands = fs
		.readFileSync(path.join(f.root, "commands.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
	assert.equal(commands.filter((a) => a.includes("PACKAGE=asset")).length, 0);
});

test("547 runner discovers and retires a candidate after prepublication preparation failure", async (t) => {
	const f = preparationFixture(t);
	fs.symlinkSync(
		path.join(repository, "scripts"),
		path.join(f.root, "scripts"),
	);
	f.env.CONTROL_PENDING_CANDIDATE = "yes";
	installPendingCli(f.root);
	const stops = [];
	await assert.rejects(
		() =>
			f.run({
				make: async (argv, options) => {
					if (argv[1] !== "boat-stop") return f.make(argv, options);
					stops.push(argv);
					// The runner calls the real repository stop/controller; only its provider is controlled.
					return runner.makeCommand(argv, {
						...options,
						env: {
							...f.env,
							PATH: process.env.PATH,
							HOME: path.join(f.root, "home"),
							BOAT_SHUTDOWN_BUDGET_MS: "30000",
							BOAT_EXEC: "local",
						},
					});
				},
			}),
		/Native Make terminal or drainage failed/,
	);
	assert.deepEqual(stops, [
		[
			"make",
			"boat-stop",
			"BOAT_EXPECTED_ADMISSION=11111111-2222-4333-8444-555555555555",
		],
	]);
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(
		result.cleanup.status,
		"STOPPED_ACCOUNTED",
		JSON.stringify({
			cleanup: result.cleanup,
			stderr: fs.readFileSync(
				path.join(f.config.evidence, "owning-stop/stderr.raw"),
				"utf8",
			),
		}),
	);
	assert.equal(result.cleanup.worker, "controlled-candidate");
	const state = json(path.join(f.root, ".boat/state.json"));
	assert.equal(state.id, null);
	assert.equal(state.admission.runningSince, null);
	assert.ok(state.admission.shutdownAttempt.accountingAppliedAt);
	const calls = fs
		.readFileSync(path.join(f.root, "provider-calls"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(calls.filter((args) => args.includes("stop")).length, 1);
	assert.equal(fs.existsSync(path.join(f.config.evidence, "red-user")), false);
});

test("547 every native baseline failure must be the expected closure assertion", async (t) => {
	const f = preparationFixture(t);
	f.env.CONTROL_ERROR_CASE = "user-non-assertion";
	await assert.rejects(
		() =>
			f.run({
				make: f.make,
				observeCli: f.observeCli,
			}),
		/ASSERTION/,
	);
	assert.equal(
		fs.existsSync(path.join(f.config.evidence, "red-wallpaper")),
		false,
	);
});

test("547 unrelated pnpm failure cannot borrow valid native baseline output", async (t) => {
	const f = preparationFixture(t);
	f.env.CONTROL_ERROR_CASE = "unrelated-wrapper";
	await assert.rejects(
		() =>
			f.run({
				make: f.make,
				observeCli: f.observeCli,
			}),
		/SETUP_OR_COLLECTION/,
	);
});

test("547 generated lock refuses and preserves unrelated bytes before frozen build", async (t) => {
	const f = preparationFixture(t);
	f.env.CONTROL_LOCK_DRIFT = "yes";
	await assert.rejects(
		() =>
			f.run({
				make: f.make,
				observeCli: f.observeCli,
			}),
		/Complete generated lock differs/,
	);
	assert.ok(
		fs
			.readFileSync(path.join(f.root, "pnpm-lock.yaml"), "utf8")
			.endsWith("# unrelated native output\n"),
	);
	assert.equal(fs.existsSync(path.join(f.config.evidence, "frozen")), false);
	assert.equal(
		json(path.join(f.config.evidence, "preparation-result.json")).cleanup
			.status,
		"STOPPED_ACCOUNTED",
	);
});

test("547 a new label and generated identity use unchanged preparation code", async (t) => {
	const f = preparationFixture(t);
	f.config.round = "next-fresh-round";
	f.env.CONTROL_PROJECT = "wallpaperdb-another";
	fs.writeFileSync(
		path.join(f.root, ".worktree"),
		"WORKTREE_SLOT=301\nCOMPOSE_PROJECT_NAME=wallpaperdb-another\nINGRESS_PORT=11010\n",
	);
	const result = await f.run({
		make: f.make,
		observeCli: f.observeCli,
	});
	assert.equal(result.round, "next-fresh-round");
	assert.equal(result.owner.project, "wallpaperdb-another");
	assert.equal(result.owner.ingress, 11010);
	assert.equal(result.phases.at(-1).outcome.project, result.owner.project);
});

test("547 cold acceptance remains bounded after native completion", async (t) => {
	const f = preparationFixture(t);
	let offset = 0;
	await assert.rejects(
		() =>
			f.run({
				observeCli: f.observeCli,
				clock: () => mono() + offset,
				make: async (argv, options) => {
					const result = await f.make(argv, options);
					if (argv.includes("PACKAGE=user")) offset = 1201;
					return result;
				},
			}),
		/Original phase\/cold deadline exceeded/,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-user/command/receipt.json")).terminal
			.code,
		2,
	);
	assert.equal(
		json(path.join(f.config.evidence, "red-user/result.json")).status,
		"FAIL",
	);
	assert.equal(
		json(path.join(f.config.evidence, "preparation-result.json")).cleanup
			.status,
		"STOPPED_ACCOUNTED",
	);
	assert.equal(
		fs.existsSync(path.join(f.config.evidence, "red-wallpaper")),
		false,
	);
});

test("547 final cold publication cannot leave a late passing result", async (t) => {
	const f = preparationFixture(t);
	let offset = 0;
	await assert.rejects(
		() =>
			f.run({
				make: f.make,
				observeCli: f.observeCli,
				clock: () => mono() + offset,
				publication: (file, result) => {
					fs.writeFileSync(file, JSON.stringify(result));
					if (
						path.basename(file) === "preparation-result.json" &&
						result.status === "PASS_PREDEV_THROUGH_IMAGES"
					)
						offset = 1201;
				},
			}),
		/Original cold deadline exceeded/,
	);
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
	assert.equal(result.compute, "STOPPED_ACCOUNTED");
	assert.equal(result.next, undefined);
});

test("547 post-bootstrap hash refusal occurs before worker selection", async (t) => {
	const f = preparationFixture(t);
	await assert.rejects(
		() =>
			f.run({
				make: f.make,
				observeCli: () => ({ sha256: "0".repeat(64) }),
			}),
		/Post-enrollment CLI identity mismatch/,
	);
	assert.equal(fs.existsSync(path.join(f.root, ".boat/state.json")), false);
	assert.equal(
		fs
			.readFileSync(path.join(f.root, "commands.jsonl"), "utf8")
			.trim()
			.split("\n").length,
		1,
	);
});

test("547 unrelated product bytes and dangling later-phase paths are preserved before any Make command", async (t) => {
	for (const kind of ["product-drift", "dangling-txt"]) {
		const f = preparationFixture(t);
		const file = path.join(
			f.root,
			kind === "product-drift"
				? "apps/user/src/adapters/picture-attachments/index.ts"
				: "apps/web/src/boat-547-presence.txt",
		);
		if (kind === "product-drift")
			fs.appendFileSync(file, "\n// unrelated edit\n");
		else {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.symlinkSync("missing-owned-target", file);
		}
		let commands = 0;
		await assert.rejects(() =>
			f.run({
				observeCli: f.observeCli,
				make: async () => {
					commands++;
					throw new Error("must not run");
				},
			}),
		);
		assert.equal(commands, 0);
		if (kind === "product-drift")
			assert.ok(fs.readFileSync(file, "utf8").endsWith("// unrelated edit\n"));
		else assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
	}
});

test("547 preparation owns its cold origin and rejects caller clock calculations", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-prefix-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	let commands = 0;
	await assert.rejects(
		() =>
			runner.execute547Preparation(
				{
					worktree: root,
					round: "current",
					evidence: path.join(root, "evidence"),
					coldDeadline: 1,
				},
				{
					make: async () => {
						commands++;
						throw new Error("must not launch");
					},
				},
			),
		/Preparation configuration accepts only/,
	);
	assert.equal(commands, 0);
});

function installPendingCli(root) {
	fs.mkdirSync(path.join(root, ".mise/boat"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".mise/boat/boat"),
		`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync('provider-calls',JSON.stringify(args)+'\\n');
if(args.includes('info')){const a=JSON.parse(fs.readFileSync('.boat/state.json')).admission,stopped=fs.existsSync('stopped');console.log(JSON.stringify({sandbox:{id:a.candidate.id,name:a.name,type:'large',state:stopped?'stopped':'ready',stop:stopped?{id:'controlled-stop',status:'completed',forced:false,error:null,endedAt:'2026-11-03T00:00:00Z'}:undefined}}));}
else if(args.includes('stop')){fs.writeFileSync('stopped','yes');console.log('{}');}
else if(args.includes('usage'))console.log('{}');
`,
		{ mode: 0o700 },
	);
}

for (const [matches, otherLive] of [
	[true, false],
	[false, false],
	[true, true],
])
	test(`547 prepublication cleanup admission match ${matches}, other live worker ${otherLive}`, async (t) => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "boat-pending-"));
		t.after(() => fs.rmSync(root, { recursive: true, force: true }));
		const repository = path.dirname(
			path.dirname(fileURLToPath(import.meta.url)),
		);
		fs.symlinkSync(
			path.join(repository, "scripts"),
			path.join(root, "scripts"),
		);
		fs.writeFileSync(
			path.join(root, "Makefile"),
			`include ${repository}/Makefile\noverride SHELL := /bin/sh\n`,
		);
		fs.writeFileSync(
			path.join(root, ".worktree"),
			"COMPOSE_PROJECT_NAME=control\nINGRESS_PORT=10760\n",
		);
		fs.mkdirSync(path.join(root, ".boat"));
		const key = createHash("sha256").update(root).digest("hex").slice(0, 12);
		const token = "11111111-2222-4333-8444-555555555555";
		const name = `wallpaperdb-557-c-${key}-${token}`;
		fs.writeFileSync(
			path.join(root, ".boat/enrollment.json"),
			JSON.stringify({
				root,
				key,
				size: "large",
				mode: "development",
				cohort: "c",
				lifecycle: "fresh-after-stop",
				cacheNamespace: "control",
			}),
		);
		fs.writeFileSync(
			path.join(root, ".boat/state.json"),
			JSON.stringify({
				id: otherLive ? "unrelated-current" : null,
				runningSince: otherLive ? Date.now() : null,
				admission: {
					status: "candidate-owned",
					owner: { root, key },
					token,
					name,
					size: "large",
					previousWorkerId: null,
					runningSince: Date.now(),
					candidate: { id: "controlled-candidate", name, size: "large" },
				},
			}),
		);
		installPendingCli(root);
		fs.mkdirSync(path.join(root, "evidence"));
		const r = await runner.makeCommand(
			[
				"make",
				"boat-stop",
				`BOAT_EXPECTED_ADMISSION=${matches ? token : "another-token"}`,
			],
			{
				cwd: root,
				directory: path.join(root, "evidence/stop"),
				deadline: Number(process.hrtime.bigint()) / 1e9 + 30,
				env: {
					...process.env,
					HOME: path.join(root, "home"),
					BOAT_SHUTDOWN_BUDGET_MS: "30000",
					MAKEFLAGS: "",
					MFLAGS: "",
				},
			},
		);
		const state = JSON.parse(
			fs.readFileSync(path.join(root, ".boat/state.json")),
		);
		if (matches && !otherLive) {
			assert.equal(
				r.terminal.code,
				0,
				fs.readFileSync(path.join(root, "evidence/stop/stderr.raw"), "utf8"),
			);
			assert.equal(state.admission.runningSince, null);
			assert.equal(
				state.admission.shutdownAttempt.completion.provider.stop.status,
				"completed",
			);
			assert.ok(state.admission.shutdownAttempt.accountingAppliedAt);
		} else {
			assert.equal(r.terminal.code, 2);
			assert.equal(fs.existsSync(path.join(root, "provider-calls")), false);
		}
	});
