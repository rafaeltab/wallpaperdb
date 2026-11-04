import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import * as runner from "./lib/boat-hillclimb.mjs";
import { captureServingCommand } from "./lib/boat-capture.mjs";
import { preparationFixture } from "./test-fixtures/547-preparation.mjs";

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mono = () => Number(process.hrtime.bigint()) / 1e9;


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
		"chromium-install",
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

async function stoppedWantedDevelopment(f) {
	f.config.cacheNamespace = "reused-fixture";
	f.env.CONTROL_REQUIRE_RECONCILIATION_PREPARATION = "1";
	await f.make(["make", "boat-enroll", "BOAT_CACHE_NAMESPACE=reused-fixture"], {
		cwd: f.root,
		directory: path.join(f.root, "enrollment-setup"),
		deadline: mono() + 10,
	});
	fs.writeFileSync(
		path.join(f.root, ".boat/state.json"),
		JSON.stringify({
			id: "stopped-predecessor",
			runningSince: null,
			developmentWanted: true,
			reconciliationPending: true,
		}),
	);
	return f;
}

test("547 reused wanted development prepares workspace and images before its first ordinary command", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	await stoppedWantedDevelopment(f);
	const inputs = json(
		path.join(repository, "scripts/boat-workloads/547.json"),
	).inputs;
	const expectedSources = Object.fromEntries([
		...inputs.tests.map((input) => [input.path, input.sha256]),
		...inputs.repair.map((input) => {
			const file = path.join(f.root, input.path);
			return [
				input.path,
				fs.existsSync(file)
					? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
					: null,
			];
		}),
	]);
	const outcome = await f.run().then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
	try {
		if (outcome.error) {
			const file = path.join(f.config.evidence, "red-user/command/stderr.raw");
			assert.fail(
				outcome.error.message +
					(fs.existsSync(file) ? "\n" + fs.readFileSync(file, "utf8") : ""),
			);
		}
		assert.equal(outcome.value.status, "PASS_STARTUP_READY");
		assert.deepEqual(
			json(path.join(f.root, "source-at-app-image-preparation.json")),
			expectedSources,
			"Prepare images with all exact baseline tests and unrepaired product inputs",
		);
		assert.deepEqual(
			json(path.join(f.root, "source-at-first-ordinary.json")),
			expectedSources,
			"First ordinary command must reuse the prepared source inputs",
		);
		assert.deepEqual(json(path.join(f.root, "intent-at-first-ordinary.json")), {
			wanted: true,
			pending: true,
		});
		const commands = jsonLines(path.join(f.root, "commands.jsonl"));
		const firstUser = commands.findIndex(
			(a) => a[1] === "test-focused" && a.includes("PACKAGE=user"),
		);
		assert.deepEqual(
			commands.slice(1, firstUser).map((a) => a[1]),
			[
				"boat-prepare-toolchain",
				"boat-prepare-workspace",
				"boat-prepare-chromium",
				"boat-prepare-infra-images",
				"boat-prepare-app-images",
			],
		);
		assert.equal(
			commands.filter((a) => a[1] === "boat-prepare-infra-images").length,
			2,
		);
		const prep = json(path.join(f.config.evidence, "preparation-result.json"));
		assert.equal(prep.coldDeadline - prep.coldStarted, 1200);
		assert.ok(prep.phases.every((p) => p.deadline <= prep.coldDeadline));
	} finally {
		if (outcome.value) await outcome.value.serving.stop();
	}
});

test("547 failed early Chromium preparation stops before images and ordinary restoration", async (t) => {
	const f = preparationFixture(t);
	await stoppedWantedDevelopment(f);
	f.env.CONTROL_FAIL = "chromium-install";
	await assert.rejects(f.run());
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
	const commands = jsonLines(path.join(f.root, "commands.jsonl"));
	assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
	assert.equal(
		commands.some((a) =>
			[
				"boat-prepare-infra-images",
				"boat-prepare-app-images",
				"test-focused",
			].includes(a[1]),
		),
		false,
	);
	assert.equal(
		fs.existsSync(path.join(f.root, "patches/nats-2.29.3.patch")),
		false,
	);
});

test("547 failed wanted app-image preparation stops its worker before any ordinary baseline", async (t) => {
	const f = preparationFixture(t);
	await stoppedWantedDevelopment(f);
	f.env.CONTROL_FAIL = "boat-prepare-app-images";
	await assert.rejects(f.run());
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
	assert.equal(json(path.join(f.root, ".boat/state.json")).runningSince, null);
	const commands = jsonLines(path.join(f.root, "commands.jsonl"));
	assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
	assert.equal(
		commands.some((a) => a[1] === "test-focused"),
		false,
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

test("547 startup awaits serial owned image preparation before launching Watch", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	f.env.CONTROL_REQUIRE_APP_IMAGES = "1";
	f.env.CONTROL_APP_IMAGE_GATE = path.join(f.root, "release-app-build");
	let outcome;
	const operation = f.run().then(
		(value) => (outcome = { value }),
		(error) => (outcome = { error }),
	);
	try {
		const until = mono() + 10;
		while (!fs.existsSync(path.join(f.root, "app-build-entered"))) {
			if (outcome?.error) throw outcome.error;
			assert.ok(mono() < until, "Application image build was not launched");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(
			fs.existsSync(path.join(f.root, "serving-commands.jsonl")),
			false,
		);
		for (const name of ["dev", "preview"])
			assert.equal(
				fs.existsSync(
					path.join(f.config.evidence, "startup", name, "invocation.json"),
				),
				false,
			);
		assert.equal(
			fs.existsSync(
				path.join(f.config.evidence, "startup/apps-build/result.json"),
			),
			false,
		);
		fs.writeFileSync(f.env.CONTROL_APP_IMAGE_GATE, "release");
		const completed = await operation;
		assert.ifError(completed.error);
		assert.equal(completed.value.status, "PASS_STARTUP_READY");
		assert.equal(completed.value.deadline - completed.value.started, 600);
		assert.equal(
			json(path.join(f.config.evidence, "startup/apps-build/result.json"))
				.status,
			"PASS",
		);
		assert.equal(
			jsonLines(path.join(f.root, "commands.jsonl")).filter(
				(argv) => argv[1] === "boat-prepare-app-images",
			).length,
			1,
		);
		assert.equal(
			jsonLines(path.join(f.root, "commands.jsonl")).some(
				(argv) => argv[1] === "apps-build",
			),
			false,
			"Startup must use the existing serial owned image preparation",
		);
	} finally {
		fs.writeFileSync(f.env.CONTROL_APP_IMAGE_GATE, "release");
		const completed = await operation;
		if (completed.value) await completed.value.serving.stop();
	}
});

test("547 startup image provisioning can exceed180 while retaining the original600 deadline", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	let offset = 0;
	let result;
	try {
		result = await f.run({
			clock: () => mono() + offset,
			make: async (argv, options) => {
				const receipt = await f.make(argv, options);
				if (options.directory.includes("/startup/apps-build/")) offset = 181;
				return receipt;
			},
		});
		assert.equal(result.status, "PASS_STARTUP_READY");
		assert.equal(result.deadline - result.started, 600);
		const image = json(
			path.join(f.config.evidence, "startup/apps-build/result.json"),
		);
		assert.equal(image.deadline, result.deadline);
		assert.equal(
			json(
				path.join(
					f.config.evidence,
					"startup/apps-build/command/invocation.json",
				),
			).deadline,
			result.deadline,
			"Native capture must use the same original startup deadline",
		);
		assert.ok(image.acceptedAt - image.started > 180);
		assert.ok(image.acceptedAt < result.deadline);
		const infra = json(
			path.join(f.config.evidence, "startup/infra-start/result.json"),
		);
		assert.equal(
			infra.deadline,
			Math.min(infra.started + 180, result.deadline),
		);
	} finally {
		if (result) await result.serving.stop();
	}
});

test("547 startup image provisioning refuses completion after the original600 without starting Watch", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	let offset = 0;
	await assert.rejects(
		f.run({
			clock: () => mono() + offset,
			make: async (argv, options) => {
				const receipt = await f.make(argv, options);
				if (options.directory.includes("/startup/apps-build/")) offset = 601;
				return receipt;
			},
		}),
		/deadline/,
	);
	const result = json(path.join(f.config.evidence, "startup/result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.deadline - result.started, 600);
	assert.equal(result.cleanup.compute.status, "STOPPED_ACCOUNTED");
	assert.equal(
		fs.existsSync(path.join(f.config.evidence, "startup/dev/invocation.json")),
		false,
	);
	assert.equal(
		jsonLines(path.join(f.root, "commands.jsonl")).filter(
			(argv) => argv[1] === "boat-stop",
		).length,
		1,
	);
});

test("547 startup app image failure never launches Watch and stops its owner once", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	f.env.CONTROL_FAIL = "apps-build";
	const outcome = await f.run().then(
		(value) => ({ value }),
		(error) => ({ error }),
	);
	try {
		assert.match(
			outcome.error?.message ?? "",
			/Native Make terminal or drainage failed/,
		);
		assert.equal(
			fs.existsSync(path.join(f.root, "serving-commands.jsonl")),
			false,
		);
		for (const name of ["dev", "preview"])
			assert.equal(
				fs.existsSync(
					path.join(f.config.evidence, "startup", name, "invocation.json"),
				),
				false,
			);
		const result = json(path.join(f.config.evidence, "startup/result.json"));
		assert.equal(result.status, "FAIL");
		assert.equal(result.cleanup.compute.status, "STOPPED_ACCOUNTED");
		assert.equal(
			json(path.join(f.root, ".boat/state.json")).runningSince,
			null,
		);
		assert.equal(
			jsonLines(path.join(f.root, "commands.jsonl")).filter(
				(argv) => argv[1] === "boat-stop",
			).length,
			1,
		);
	} finally {
		if (outcome.value) await outcome.value.serving.stop();
	}
});

test("547 replacement hands the owned serving lifetime to one new ordinary preview", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	const result = await f.run();
	const old = structuredClone(result.preview);
	try {
		const changed = await result.serving.replacePreview({
			action: "replace-preview",
			worker: result.owner.worker,
			admission: result.owner.admission,
			generation: old.generation,
		});
		assert.equal(changed.status, "PASS_PREVIEW_REPLACEMENT");
		assert.equal(changed.deadline - changed.started, 600);
		assert.ok(changed.acceptedAt < changed.deadline);
		assert.notEqual(changed.preview.generation, old.generation);
		assert.notEqual(changed.preview.pid, old.pid);
		assert.deepEqual(changed.containers, changed.before.containers);
		assert.equal(changed.dev.pid, result.dev.pid);
		assert.equal(changed.retired.closed, true);
		assert.equal(changed.oldCapture.captureComplete, true);
		assert.equal(changed.oldDisposal.pipesClosed, true);
		assert.deepEqual(changed.oldDisposal.unresolved, []);
		assert.equal(changed.routes.length, 8);
		assert.equal(
			json(path.join(f.root, ".boat/state.json")).runningSince !== null,
			true,
		);
		assert.equal(
			jsonLines(path.join(f.root, "commands.jsonl")).filter(
				(a) => a[1] === "boat-stop",
			).length,
			0,
		);
		const commands = jsonLines(path.join(f.root, "serving-commands.jsonl"));
		assert.deepEqual(commands, ["dev", "preview", "preview"]);
		await assert.rejects(
			result.serving.replacePreview({
				action: "replace-preview",
				worker: result.owner.worker,
				admission: result.owner.admission,
				generation: changed.preview.generation,
			}),
			/already consumed/,
		);
	} finally {
		await result.serving.stop();
	}
});

for (const failure of ["terminal", "receipt-rejection"]) {
	test(`547 replacement ${failure} automatically retires serving and accounts compute`, async (t) => {
		const f = preparationFixture(t);
		f.config.until = "ready";
		let preview;
		const result = await f.run({
			make: async (argv, options) => {
				const capture = await f.make(argv, options);
				if (options.directory.endsWith("/replacement-preview"))
					preview = capture;
				return capture;
			},
		});
		let timer;
		try {
			const changed = await result.serving.replacePreview({
				action: "replace-preview",
				worker: result.owner.worker,
				admission: result.owner.admission,
				generation: result.preview.generation,
			});
			assert.equal(changed.status, "PASS_PREVIEW_REPLACEMENT");
			assert.ok(preview);
			if (failure === "receipt-rejection") {
				fs.mkdirSync(path.join(preview.checkpointDirectory, "receipt.json"));
				await assert.rejects(preview.stop(), /EEXIST/);
			} else await preview.stop();
			// End the replacement capture independently; the serving owner must notice
			// and clean up without an explicit serving.stop() from this control.
			const cleanup = await Promise.race([
				result.serving.done,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Replacement completion was not observed")),
						10000,
					);
				}),
			]);
			const expected =
				failure === "receipt-rejection"
					? "CAPTURE_FINALIZATION_FAILED"
					: "STOPPED_ACCOUNTED";
			assert.equal(cleanup.status, expected);
			assert.equal(cleanup.compute.status, "STOPPED_ACCOUNTED");
			const ended = json(path.join(f.config.evidence, "startup/result.json"));
			assert.equal(ended.status, "SERVING_ENDED");
			assert.equal(ended.next, undefined);
			assert.equal(ended.acceptedAt, undefined);
			assert.equal(ended.cleanup.status, expected);
			assert.equal(ended.cleanup.compute.status, "STOPPED_ACCOUNTED");
			if (failure === "receipt-rejection")
				assert.ok(
					cleanup.transports.some((capture) => /EEXIST/.test(capture.failure)),
				);
			assert.equal(
				json(path.join(f.root, ".boat/state.json")).runningSince,
				null,
			);
			assert.equal(
				jsonLines(path.join(f.root, "commands.jsonl")).filter(
					(argv) => argv[1] === "boat-stop",
				).length,
				1,
			);
			for (const name of ["dev", "preview", "replacement-preview"]) {
				const disposal = json(
					path.join(f.config.evidence, `startup/${name}/disposal.json`),
				);
				assert.equal(disposal.pipesClosed, true);
				assert.deepEqual(disposal.unresolved, []);
			}
		} finally {
			clearTimeout(timer);
			await result.serving.stop();
		}
	});
}

test("547 replacement refuses stale input before any runtime effect", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	const result = await f.run();
	try {
		const before = fs.readFileSync(path.join(f.root, "commands.jsonl"), "utf8");
		await assert.rejects(
			result.serving.replacePreview({
				action: "replace-preview",
				worker: result.owner.worker,
				admission: result.owner.admission,
				generation: "stale-generation",
			}),
			/Stale or invalid/,
		);
		assert.equal(
			fs.readFileSync(path.join(f.root, "commands.jsonl"), "utf8"),
			before,
		);
		assert.deepEqual(jsonLines(path.join(f.root, "serving-commands.jsonl")), [
			"dev",
			"preview",
		]);
		assert.equal(
			json(path.join(f.root, ".boat/preview-process.json")).generation,
			result.preview.generation,
		);
		assert.notEqual(
			json(path.join(f.root, ".boat/state.json")).runningSince,
			null,
		);
	} finally {
		await result.serving.stop();
	}
});

for (const fault of ["source", "containers-before", "containers", "late"]) {
	test(`547 replacement ${fault} failure preserves evidence and stops the same owner once`, async (t) => {
		const f = preparationFixture(t);
		f.config.until = "ready";
		let now = mono();
		let stopBarrierArmed = false;
		const entered = Promise.withResolvers(),
			release = Promise.withResolvers();
		const result = await f.run(
			fault === "late"
				? {
						clock: () => now,
						publication(file, value) {
							fs.writeFileSync(file, JSON.stringify(value));
							if (
								file.endsWith("preview-replacement.json") &&
								value.status === "PASS_PREVIEW_REPLACEMENT"
							)
								now += 601;
						},
						make: async (argv, options) => {
							if (stopBarrierArmed && argv[1] === "boat-stop") {
								entered.resolve();
								await release.promise;
							}
							return f.make(argv, options);
						},
					}
				: {},
		);
		try {
			stopBarrierArmed = true;
			if (fault === "source")
				fs.appendFileSync(
					path.join(f.root, "apps/user/src/boat-live-547.ts"),
					"\n// unexpected input\n",
				);
			if (fault.startsWith("containers"))
				f.env.CONTROL_CONTAINER_CHANGED =
					fault === "containers-before" ? "before" : "1";
			const rejected = assert.rejects(
				result.serving.replacePreview({
					action: "replace-preview",
					worker: result.owner.worker,
					admission: result.owner.admission,
					generation: result.preview.generation,
				}),
				fault === "source"
					? /Frozen workload changed/
					: fault.startsWith("containers")
						? /Application identities changed/
						: /Original startup deadline/,
			);
			let timer;
			try {
				if (fault === "late") {
					await Promise.race([
						entered.promise,
						new Promise((_, reject) => {
							timer = setTimeout(
								() => reject(new Error("Owning stop was not reached")),
								10000,
							);
						}),
					]);
					const replacement = json(
						path.join(f.config.evidence, "startup/preview-replacement.json"),
					);
					assert.equal(replacement.status, "FAIL");
					assert.equal(replacement.acceptedAt, undefined);
					const pending = json(
						path.join(f.config.evidence, "startup/result.json"),
					);
					assert.equal(pending.status, "FAIL");
					assert.equal(pending.next, undefined);
					assert.equal(pending.acceptedAt, undefined);
					assert.equal(pending.cleanup.status, "PENDING_OWNING_STOP");
					assert.notEqual(
						json(path.join(f.root, ".boat/state.json")).runningSince,
						null,
					);
				}
			} finally {
				clearTimeout(timer);
				release.resolve();
				await rejected;
			}
			await result.serving.done;
			assert.equal(
				json(path.join(f.config.evidence, "startup/preview-replacement.json"))
					.status,
				"FAIL",
			);
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
			if (["source", "containers-before"].includes(fault)) {
				assert.deepEqual(
					jsonLines(path.join(f.root, "serving-commands.jsonl")),
					["dev", "preview"],
				);
				if (fault === "source")
					assert.match(
						fs.readFileSync(
							path.join(f.root, "apps/user/src/boat-live-547.ts"),
							"utf8",
						),
						/unexpected input/,
					);
			} else {
				const disposal = json(
					path.join(
						f.config.evidence,
						"startup/replacement-preview/disposal.json",
					),
				);
				assert.equal(disposal.pipesClosed, true);
				assert.deepEqual(disposal.unresolved, []);
			}
		} finally {
			release.resolve();
			await result.serving.stop();
		}
	});
}

test("547 serving receipt I/O rejection retires the other capture and stops once", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	let dev;
	const result = await f.run({
		make: async (argv, options) => {
			const capture = await f.make(argv, options);
			if (options.serving && argv[1] === "dev") dev = capture;
			return capture;
		},
	});
	const done = result.serving.done.then(
		(value) => ({ status: "fulfilled", value }),
		(error) => ({ status: "rejected", error }),
	);
	// A real final receipt write, after terminal/drain, now fails at the filesystem.
	fs.mkdirSync(path.join(f.config.evidence, "startup/dev/receipt.json"));
	await assert.rejects(dev.stop(), /EEXIST/);
	const ended = await done;
	try {
		assert.equal(ended.status, "fulfilled", ended.error?.message);
		assert.equal(ended.value.status, "CAPTURE_FINALIZATION_FAILED");
		assert.equal(ended.value.compute.status, "STOPPED_ACCOUNTED");
		assert.equal(
			ended.value.transports.some((capture) => /EEXIST/.test(capture.failure)),
			true,
		);
		const persisted = json(
			path.join(f.config.evidence, "startup/cleanup.json"),
		);
		assert.equal(persisted.status, "CAPTURE_FINALIZATION_FAILED");
		assert.equal(persisted.compute.status, "STOPPED_ACCOUNTED");
		assert.equal(
			persisted.transports.some((capture) => /EEXIST/.test(capture.failure)),
			true,
		);
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
		const other = json(
			path.join(f.config.evidence, "startup/preview/disposal.json"),
		);
		assert.equal(other.pipesClosed, true);
		assert.deepEqual(other.unresolved, []);
	} finally {
		await result.serving.stop();
	}
});

test("547 startup revokes late readiness while the owning stop is still pending", {
	timeout: 15000,
}, async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	const entered = Promise.withResolvers(),
		release = Promise.withResolvers();
	let now = mono();
	const operation = f.run({
		clock: () => now,
		publication(file, value) {
			fs.writeFileSync(file, JSON.stringify(value));
			if (file.endsWith("startup/result.json")) now += 601;
		},
		make: async (argv, options) => {
			if (argv[1] === "boat-stop") {
				entered.resolve();
				await release.promise;
			}
			return f.make(argv, options);
		},
	});
	const ended = assert.rejects(operation, /Original startup deadline/);
	try {
		await entered.promise;
		const pending = json(path.join(f.config.evidence, "startup/result.json"));
		assert.equal(pending.status, "FAIL");
		assert.equal(pending.next, undefined);
		assert.equal(pending.acceptedAt, undefined);
		assert.equal(pending.cleanup.status, "PENDING_OWNING_STOP");
		assert.notEqual(
			json(path.join(f.root, ".boat/state.json")).runningSince,
			null,
		);
	} finally {
		release.resolve();
		await ended;
	}
});

test("547 serving receipt rejection before readiness is handled and stopped", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	f.env.CONTROL_DEV_EXIT_BEFORE_READY = "1";
	await assert.rejects(
		f.run({
			make: async (argv, options) => {
				const capture = await f.make(argv, options);
				if (options.serving && argv[1] === "dev")
					fs.mkdirSync(path.join(options.directory, "receipt.json"));
				return capture;
			},
		}),
		/Serving Make capture ended|EEXIST/,
	);
	const result = json(path.join(f.config.evidence, "startup/result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "CAPTURE_FINALIZATION_FAILED");
	assert.equal(result.cleanup.compute.status, "STOPPED_ACCOUNTED");
	assert.equal(
		result.cleanup.transports.some((capture) => /EEXIST/.test(capture.failure)),
		true,
	);
	assert.equal(json(path.join(f.root, ".boat/state.json")).runningSince, null);
	assert.equal(
		jsonLines(path.join(f.root, "commands.jsonl")).filter(
			(a) => a[1] === "boat-stop",
		).length,
		1,
	);
});

test("547 startup revocation survives cleanup evidence I/O failure", async (t) => {
	const f = preparationFixture(t);
	f.config.until = "ready";
	let now = mono();
	await assert.rejects(
		f.run({
			clock: () => now,
			publication(file, value) {
				fs.writeFileSync(file, JSON.stringify(value));
				if (file.endsWith("startup/result.json")) {
					fs.mkdirSync(path.join(f.config.evidence, "startup/cleanup.json"));
					now += 601;
				}
			},
		}),
		/Original startup deadline/,
	);
	const result = json(path.join(f.config.evidence, "startup/result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.next, undefined);
	assert.equal(result.cleanup.compute.status, "STOPPED_ACCOUNTED");
	assert.match(result.cleanup.publicationError, /EISDIR/);
});

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
	for (const fault of [
		"none",
		"runtime-hash",
		"unrelated-source",
		"array-source",
		"array-expected",
	])
		test(`547 public source observation uses the current runtime adapter and owns cleanup, fault=${fault}`, {
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
			fs.writeFileSync(
				path.join(f.root, "bin/docker"),
				`#!/bin/sh\nexec node ${repository}/scripts/test-fixtures/547-docker-effect.cjs "$@"\n`,
				{ mode: 0o700 },
			);
			if (fault === "runtime-hash") f.env.CONTROL_SOURCE_HASH_DRIFT = "1";
			const config = path.join(f.root, "current-inputs.json");
			fs.writeFileSync(config, JSON.stringify(f.config));
			const make = execFileSync("which", ["make"], { encoding: "utf8" }).trim();
			const capture = captureServingCommand({
				argv: [make, "boat-hillclimb-547", `BOAT_HILLCLIMB_CONFIG=${config}`],
				cwd: f.root,
				directory: path.join(f.root, "public-source-capture"),
				env: f.env,
				input: true,
			});
			const until = mono() + 20;
			const wait = async (file, predicate) => {
				while (!fs.existsSync(file) || !predicate(json(file))) {
					assert.ok(
						mono() < until,
						`Public source result not published: ${file}`,
					);
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				return json(file);
			};
			const send = async (request) => {
				const files = ["stdout", "stderr"].map((stream) =>
					path.join(f.root, `public-source-capture/${stream}.raw`),
				);
				const offsets = files.map((file) => fs.statSync(file).size);
				capture.writeInput(JSON.stringify(request) + "\n");
				for (;;) {
					const replies = files.flatMap((file, i) => {
						const text = fs.readFileSync(file).subarray(offsets[i]).toString();
						return text
							.slice(0, text.lastIndexOf("\n") + 1)
							.split("\n")
							.filter((line) => line.startsWith("{"))
							.map(JSON.parse);
					});
					const reply = replies.find((r) =>
						["PASS", "FAIL", "REFUSED"].includes(r.status),
					);
					if (reply) return reply;
					capture.assertRunning();
					assert.ok(
						mono() < until,
						"Managed action acknowledgement was not delivered",
					);
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
			};
			try {
				const ready = await wait(
					path.join(f.config.evidence, "startup/result.json"),
					(r) => r.status === "PASS_STARTUP_READY",
				);
				// The CLI announces readiness only after its final publication checks
				// and before it starts accepting coordinated source observations.
				while (
					!fs
						.readFileSync(
							path.join(f.root, "public-source-capture/stdout.raw"),
							"utf8",
						)
						.includes('"status":"PASS_STARTUP_READY"')
				) {
					capture.assertRunning();
					assert.ok(
						mono() < until,
						"Public ready announcement was not delivered",
					);
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				const request = {
					action: "observe-source",
					id: "txt-create-1",
					source: "presence",
					expected: "present",
					worker: ready.owner.worker,
					admission: ready.owner.admission,
					generation: ready.preview.generation,
				};
				assert.equal(
					(await send({ ...request, admission: "stale-admission" })).status,
					"REFUSED",
				);
				assert.equal(
					fs.existsSync(path.join(f.root, "native-source-invocations.jsonl")),
					false,
				);
				assert.ok(json(path.join(f.root, ".boat/state.json")).runningSince);
				const payload = path.join(f.root, "apps/web/src/boat-547-presence.txt");
				fs.writeFileSync(payload, "BOAT-547-PRESENCE\n", {
					flag: "wx",
					mode: 0o600,
				});
				if (fault.startsWith("array-")) {
					const malformed =
						fault === "array-source"
							? { source: ["presence"] }
							: { expected: ["present"] };
					const reply = await send({ ...request, ...malformed });
					assert.equal(
						reply.status,
						"REFUSED",
						"Malformed selectors must be refused before execution",
					);
					assert.equal(
						fs.existsSync(path.join(f.root, "native-source-invocations.jsonl")),
						false,
					);
					assert.equal(
						fs.existsSync(
							path.join(f.config.evidence, "startup/source-txt-create-1"),
						),
						false,
					);
					assert.equal(
						jsonLines(path.join(f.root, "commands.jsonl")).filter(
							(c) => c[1] === "boat-stop",
						).length,
						0,
					);
					assert.ok(json(path.join(f.root, ".boat/state.json")).runningSince);
					assert.equal(fs.readFileSync(payload, "utf8"), "BOAT-547-PRESENCE\n");
				} else {
					if (fault === "unrelated-source")
						fs.appendFileSync(
							path.join(f.root, "apps/web/vite.config.ts"),
							"\n// unrelated test input\n",
						);
					const acknowledgement = await send(request);
					const file = path.join(
						f.config.evidence,
						"startup/source-txt-create-1/result.json",
					);
					const result = await wait(file, (r) =>
						["PASS", "FAIL"].includes(r.status),
					);
					if (fault !== "none") {
						assert.equal(acknowledgement.status, "FAIL");
						assert.equal(result.status, "FAIL");
						assert.match(
							result.error,
							fault === "runtime-hash"
								? /Runtime source bytes/
								: /Frozen workload changed/,
						);
						await wait(
							path.join(f.config.evidence, "startup/cleanup.json"),
							(r) => r.compute?.status === "STOPPED_ACCOUNTED",
						);
						assert.equal(
							json(path.join(f.config.evidence, "startup/result.json")).next,
							undefined,
						);
						assert.equal(
							fs.readFileSync(payload, "utf8"),
							"BOAT-547-PRESENCE\n",
						);
					} else {
						assert.equal(acknowledgement.status, "PASS");
						assert.equal(acknowledgement.phase, "source-txt-create-1");
						assert.equal(result.status, "PASS", JSON.stringify(result));
						assert.equal(result.outcome.runtime.bytes, 18);
						assert.deepEqual(
							result.outcome.runtime.byteValues,
							[
								66, 79, 65, 84, 45, 53, 52, 55, 45, 80, 82, 69, 83, 69, 78, 67,
								69, 10,
							],
						);
						assert.equal(
							result.outcome.runtime.sha256,
							"afb7b0e339d3a9151d191aa48982db28838c8b85e50b7787535f21623c6744ab",
						);
						assert.ok(result.acceptedAt < result.deadline);
						assert.ok(json(path.join(f.root, ".boat/state.json")).runningSince);
						assert.equal(
							json(
								path.join(
									f.config.evidence,
									"startup/source-txt-create-1/command/receipt.json",
								),
							).captureComplete,
							true,
						);
						fs.unlinkSync(payload);
						const deletion = await send({
							...request,
							id: "txt-delete-1",
							expected: "absent",
						});
						assert.equal(deletion.status, "PASS");
						assert.equal(deletion.phase, "source-txt-delete-1");
						const absent = await wait(
							path.join(
								f.config.evidence,
								"startup/source-txt-delete-1/result.json",
							),
							(r) => ["PASS", "FAIL"].includes(r.status),
						);
						assert.equal(absent.status, "PASS", JSON.stringify(absent));
						assert.equal(absent.outcome.runtime.lstat, "ENOENT");
						const heading = path.join(f.root, "apps/web/src/routes/upload.tsx"),
							original = fs.readFileSync(heading);
						try {
							for (const state of ["B", "A"]) {
								fs.writeFileSync(
									heading,
									state === "A"
										? original
										: original
												.toString()
												.replace(
													"Upload Wallpapers",
													"Upload Wallpapers [Boat 547 HMR]",
												),
								);
								const headingReply = await send({
									...request,
									id: `heading-${state}`,
									source: "heading",
									expected: state,
								});
								assert.equal(headingReply.status, "PASS");
								assert.equal(headingReply.phase, `source-heading-${state}`);
								const observed = await wait(
									path.join(
										f.config.evidence,
										`startup/source-heading-${state}/result.json`,
									),
									(r) => ["PASS", "FAIL"].includes(r.status),
								);
								assert.equal(observed.status, "PASS", JSON.stringify(observed));
								assert.equal(
									observed.outcome.runtime.sha256,
									state === "A"
										? "d3f4063d7b34435ba0e1a913c3975cfffe5c9ae7d2bc69b9416868966b876170"
										: "d66f5a18bc16b5ca7282fb67a4dee9ccb547545f6195f5bfcc7a37808cd03ab5",
								);
							}
						} finally {
							fs.writeFileSync(heading, original);
						}
					}
					const native = path.join(f.root, "native-source-invocations.jsonl");
					const calls = fs.existsSync(native) ? jsonLines(native) : [];
					assert.equal(
						calls.length,
						fault === "unrelated-source" ? 0 : fault === "runtime-hash" ? 1 : 4,
					);
					assert.ok(
						calls.every(
							(c) =>
								c.project === "wallpaperdb-control" &&
								["presence", "heading"].includes(c.source),
						),
					);
					if (fault !== "unrelated-source")
						assert.ok(
							jsonLines(path.join(f.root, "commands.jsonl")).some(
								(c) =>
									c[1] === "docker-run" &&
									c[2] ===
										"ARGS=node scripts/boat-workloads/547-runtime.cjs source-observe wallpaperdb-control presence",
							),
						);
				}
			} finally {
				await capture.stop();
			}
			assert.equal(
				json(path.join(f.root, ".boat/state.json")).runningSince,
				null,
			);
			assert.equal(
				jsonLines(path.join(f.root, "commands.jsonl")).filter(
					(c) => c[1] === "boat-stop",
				).length,
				1,
			);
			assert.deepEqual(
				json(path.join(f.root, "public-source-capture/disposal.json"))
					.unresolved,
				[],
			);
		});

	for (const extra of [false, true])
		test(`547 public Make config assignment crosses the real enrolled generator route, explicitExtra=${extra}`, (t) => {
			const f = preparationFixture(t, true);
			fs.writeFileSync(
				path.join(f.root, "Makefile"),
				`override SHELL := /bin/sh\ninclude ${repository}/Makefile\n`,
			);
			fs.symlinkSync(
				path.join(repository, "scripts"),
				path.join(f.root, "scripts"),
			);
			fs.mkdirSync(path.join(f.root, ".mise/boat"), { recursive: true });
			fs.copyFileSync(
				process.env.BOAT_547_QUALIFIED_CLI,
				path.join(f.root, ".mise/boat/boat"),
			);
			const config = path.join(f.root, "config.json");
			fs.writeFileSync(config, JSON.stringify(f.config));
			const make = execFileSync("which", ["make"], { encoding: "utf8" }).trim();
			// Keep all commands in real Make. The generation command additionally
			// crosses the enrolled repository route before controlled downstream work.
			fs.writeFileSync(
				path.join(f.root, "bin/make"),
				`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
const generation=args.includes('SCRIPT=dependencies:lock');
if(generation)fs.appendFileSync('make-entry.jsonl',JSON.stringify({args,flags:process.env.MAKEFLAGS,overrides:process.env.MAKEOVERRIDES,mflags:process.env.MFLAGS,level:process.env.MAKELEVEL,gnu:process.env.GNUMAKEFLAGS})+'\\n');
if(generation&&process.env.CONTROL_EXPLICIT_GENERATOR_EXTRA==='1')args.push('ARGS=--name=unsupported');
const r=cp.spawnSync(${JSON.stringify(make)},[...(!generation?['-f','controlled.mk']:[]),...args],{stdio:'inherit',env:{...process.env,CONTROL_MAKE_ARGV:JSON.stringify(['make',...args])}});process.exitCode=r.status??1;
`,
				{ mode: 0o700 },
			);
			fs.writeFileSync(
				path.join(f.root, "bin/node"),
				`#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);
(async()=>{
 if(args[0]==='scripts/boat.mjs'&&args[1]==='command'){
  const targets=args.slice(args.indexOf('--')+1).filter(a=>!a.startsWith('BOAT_EXEC='));
  fs.appendFileSync('routed-generators.jsonl',JSON.stringify({targets,project:process.env.COMPOSE_PROJECT_NAME,custom:process.env.CONTROL_PRESERVED_ENV,config:process.env.BOAT_HILLCLIMB_CONFIG})+'\\n');
  const {sourceGeneration}=await import(${JSON.stringify(path.join(repository, "scripts/lib/boat-source-generation.mjs"))});
  if(sourceGeneration(targets)!=='lock')throw Error('Wrong maintained generator selected');
  const r=cp.spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(path.join(repository, "scripts/test-fixtures/547-make-effect.cjs"))}],{stdio:'inherit',env:{...process.env,CONTROL_MAKE_ARGV:JSON.stringify(['make',...targets])}});process.exitCode=r.status??1;
 }else{const r=cp.spawnSync(${JSON.stringify(process.execPath)},args,{stdio:'inherit',env:process.env});process.exitCode=r.status??1;}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
`,
				{ mode: 0o700 },
			);
			fs.writeFileSync(
				path.join(f.root, "bin/pnpm"),
				`#!${process.execPath}\nconsole.error('Enrolled source route was bypassed');process.exitCode=91;\n`,
				{ mode: 0o700 },
			);
			const outerEnv = {
				...f.env,
				BOAT_EXEC: "",
				MAKELEVEL: "0",
				CONTROL_EXPLICIT_GENERATOR_EXTRA: extra ? "1" : "0",
				CONTROL_PRESERVED_ENV: "worktree $ and ' bytes",
			};
			for (const name of [
				"MAKEFLAGS",
				"MAKEOVERRIDES",
				"MFLAGS",
				"GNUMAKEFLAGS",
			])
				delete outerEnv[name];
			const result = spawnSync(
				make,
				["boat-hillclimb-547", `BOAT_HILLCLIMB_CONFIG=${config}`],
				{
					cwd: f.root,
					env: outerEnv,
					encoding: "utf8",
					timeout: 20000,
				},
			);
			assert.equal(result.error, undefined);
			if (!fs.existsSync(path.join(f.root, "routed-generators.jsonl"))) {
				for (const name of fs.readdirSync(f.config.evidence)) {
					const dir = path.join(f.config.evidence, name, "command");
					if (
						fs.existsSync(path.join(dir, "receipt.json")) &&
						!name.startsWith("red-")
					) {
						const receipt = json(path.join(dir, "receipt.json"));
						if (receipt.terminal.code !== 0)
							t.diagnostic(
								JSON.stringify({
									name,
									terminal: receipt.terminal,
									stderr: fs.readFileSync(path.join(dir, "stderr.raw"), "utf8"),
								}),
							);
					}
				}
			}
			assert.ok(
				fs.existsSync(path.join(f.root, "routed-generators.jsonl")),
				result.stdout + result.stderr,
			);
			const routed = jsonLines(path.join(f.root, "routed-generators.jsonl"));
			t.diagnostic(
				JSON.stringify({
					explicitExtra: extra,
					routed,
					entries: jsonLines(path.join(f.root, "make-entry.jsonl")),
				}),
			);
			if (extra) {
				assert.equal(result.status, 2, result.stdout + result.stderr);
				const raw = fs.readFileSync(
					path.join(f.config.evidence, "generate/command/stderr.raw"),
					"utf8",
				);
				assert.match(raw, /extra arguments are unsupported/);
				assert.equal(routed.length, 1);
				assert.ok(routed[0].targets.includes("ARGS=--name=unsupported"));
				assert.equal(
					jsonLines(path.join(f.root, "commands.jsonl")).some((a) =>
						a.includes("SCRIPT=dependencies:lock"),
					),
					false,
				);
				assert.equal(
					json(path.join(f.config.evidence, "preparation-result.json")).cleanup
						.status,
					"STOPPED_ACCOUNTED",
				);
			} else {
				assert.equal(result.status, 0, result.stdout + result.stderr);
				assert.equal(
					json(path.join(f.config.evidence, "preparation-result.json")).status,
					"PASS_PREDEV_THROUGH_IMAGES",
				);
				assert.equal(routed.length, 2);
			}
			for (const entry of routed) {
				assert.deepEqual(entry.targets, [
					"run",
					...(extra ? ["ARGS=--name=unsupported"] : []),
					"PACKAGE=scripts",
					"SCRIPT=dependencies:lock",
				]);
				assert.equal(entry.project, "wallpaperdb-control");
				assert.equal(entry.custom, "worktree $ and ' bytes");
				assert.equal(entry.config, config);
			}
			for (const entry of jsonLines(path.join(f.root, "make-entry.jsonl"))) {
				for (const field of ["flags", "overrides", "mflags", "gnu"])
					assert.equal(entry[field] ?? "", "", field);
				assert.equal(entry.level, "0");
			}
		});

	for (const wanted of [false, true])
		test(`547 qualified public ready entry owns preparation, stdin replacement and cleanup, previousWanted=${wanted}`, {
			timeout: 30000,
		}, async (t) => {
			const f = preparationFixture(t, true);
			f.config.until = "ready";
			if (wanted) await stoppedWantedDevelopment(f);
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
				input: true,
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
				assert.equal(
					result.status,
					"PASS_STARTUP_READY",
					JSON.stringify(result),
				);
				assert.equal(result.containers.length, 10);
				assert.equal(result.routes.length, 8);
				assert.ok(result.acceptedAt < result.deadline);
				if (wanted) {
					assert.deepEqual(
						json(path.join(f.root, "intent-at-first-ordinary.json")),
						{ wanted: true, pending: true },
					);
					const prep = json(
						path.join(f.config.evidence, "preparation-result.json"),
					);
					for (const name of [
						"prepare-workspace",
						"prepare-images-before-restoration",
						"prepare-app-images-before-restoration",
						"prepare-infra-images",
					])
						assert.equal(
							prep.phases.find((p) => p.phase === name)?.status,
							"PASS",
						);
				}
				capture.writeInput(
					`${JSON.stringify({ action: "replace-preview", worker: result.owner.worker, admission: result.owner.admission, generation: result.preview.generation })}\n`,
				);
				const changedFile = path.join(
					f.config.evidence,
					"startup/preview-replacement.json",
				);
				while (
					!fs.existsSync(changedFile) ||
					json(changedFile).status === "RUNNING"
				) {
					capture.assertRunning();
					assert.ok(
						mono() < deadline,
						"Public replacement must finish inside control deadline",
					);
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				const changed = json(changedFile);
				assert.equal(
					changed.status,
					"PASS_PREVIEW_REPLACEMENT",
					JSON.stringify(changed),
				);
				assert.notEqual(changed.preview.generation, result.preview.generation);
				assert.equal(changed.next, "ROOT_ORIGINAL_DOCUMENT_CHECK_FIRST");
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

test("547 explicit cold provisioning shares one aggregate without extending workload commands", async (t) => {
	const f = preparationFixture(t);
	await stoppedWantedDevelopment(f);
	const captures = new Map();
	const result = await f.run({
		make: async (argv, options) => {
			const receipt = await f.make(argv, options);
			captures.set(path.basename(path.dirname(options.directory)), {
				deadline: options.deadline,
				began: receipt.began.monotonic,
			});
			return receipt;
		},
	});
	assert.equal(result.coldDeadline - result.coldStarted, 1200);
	const provisioning = new Set([
		"prepare-toolchain",
		"prepare-workspace",
		"prepare-images-before-restoration",
		"prepare-app-images-before-restoration",
		"chromium-install",
		"prepare-infra-images",
	]);
	for (const p of result.phases) {
		const expectedDeadline = provisioning.has(p.phase)
			? result.coldStarted + 1200
			: p.started + 180;
		assert.equal(p.deadline, expectedDeadline, p.phase);
		const expected = expectedDeadline - p.started;
		const invocation = captures.get(p.phase);
		assert.equal(invocation.deadline, p.deadline, p.phase);
		assert.ok(
			invocation.deadline - invocation.began <= expected &&
				invocation.deadline - invocation.began > expected - 5,
			p.phase,
		);
	}
	assert.equal(result.scheduleVersion, "547-v7-early-chromium-serial-startup");
});

test("547 Chromium provisioning accepted after its old private cap retains the original cold clock", async (t) => {
	const f = preparationFixture(t);
	let offset = 0;
	const result = await f.run({
		clock: () => mono() + offset,
		make: async (argv, options) => {
			const receipt = await f.make(argv, options);
			if (argv[1] === "boat-prepare-chromium") offset = 181;
			return receipt;
		},
	});
	const install = result.phases.find((p) => p.phase === "chromium-install");
	const launch = result.phases.find((p) => p.phase === "chromium-launch");
	assert.equal(result.status, "PASS_PREDEV_THROUGH_IMAGES");
	assert.equal(result.coldDeadline - result.coldStarted, 1200);
	assert.equal(install.deadline, result.coldDeadline);
	assert.ok(install.acceptedAt - install.started > 180);
	assert.ok(install.acceptedAt < result.coldDeadline);
	assert.equal(
		launch.deadline,
		Math.min(launch.started + 180, result.coldDeadline),
	);
	assert.equal(launch.status, "PASS");
});

test("547 Chromium provisioning cannot accept after the original aggregate or launch later work", async (t) => {
	const f = preparationFixture(t);
	let offset = 0;
	await assert.rejects(
		f.run({
			clock: () => mono() + offset,
			make: async (argv, options) => {
				const receipt = await f.make(argv, options);
				if (argv[1] === "boat-prepare-chromium") offset = 1201;
				return receipt;
			},
		}),
		/deadline/,
	);
	const result = json(path.join(f.config.evidence, "preparation-result.json"));
	assert.equal(result.status, "FAIL");
	assert.equal(result.cleanup.status, "STOPPED_ACCOUNTED");
	const commands = jsonLines(path.join(f.root, "commands.jsonl"));
	assert.equal(commands.filter((a) => a[1] === "boat-stop").length, 1);
	assert.equal(
		commands.some((a) =>
			a.includes("ARGS=node scripts/boat-workloads/547-runtime.cjs chromium"),
		),
		false,
	);
});

test("547 image allocation is clamped to the original remaining cold budget", async (t) => {
	const f = preparationFixture(t);
	let now = mono();
	const result = await f.run({
		clock: () => now,
		make: async (argv, options) => {
			const r = await f.make(argv, options);
			now += 50;
			return r;
		},
	});
	const image = result.phases.findLast(
		(p) => p.phase === "prepare-infra-images",
	);
	assert.equal(result.coldDeadline - result.coldStarted, 1200);
	assert.equal(image.deadline, result.coldDeadline);
	assert.ok(image.deadline - image.started < 1200);
	assert.ok(image.acceptedAt < result.coldDeadline);
});

test("547 image acceptance after 300 seconds can use remaining original cold time", async (t) => {
	const f = preparationFixture(t);
	await stoppedWantedDevelopment(f);
	let offset = 0;
	const result = await f.run({
		clock: () => mono() + offset,
		make: async (argv, options) => {
			const r = await f.make(argv, options);
			if (options.directory.includes("/prepare-images-before-restoration/"))
				offset = 301;
			return r;
		},
	});
	const image = result.phases.find(
		(p) => p.phase === "prepare-images-before-restoration",
	);
	assert.equal(result.status, "PASS_PREDEV_THROUGH_IMAGES");
	assert.equal(result.coldDeadline - result.coldStarted, 1200);
	assert.equal(image.deadline, result.coldDeadline);
	assert.ok(image.acceptedAt - image.started > 300);
	assert.ok(image.acceptedAt < result.coldDeadline);
	assert.equal(
		jsonLines(path.join(f.root, "commands.jsonl")).some(
			(a) => a[1] === "boat-stop",
		),
		false,
	);
});

test("547 image acceptance after the original cold deadline fails before later work and stops once", async (t) => {
	const f = preparationFixture(t);
	await stoppedWantedDevelopment(f);
	let offset = 0;
	await assert.rejects(
		f.run({
			clock: () => mono() + offset,
			make: async (argv, options) => {
				const r = await f.make(argv, options);
				if (options.directory.includes("/prepare-images-before-restoration/"))
					offset = 1201;
				return r;
			},
		}),
		/Original phase\/cold deadline exceeded/,
	);
	const p = json(
		path.join(
			f.config.evidence,
			"prepare-images-before-restoration/result.json",
		),
	);
	assert.equal(p.status, "FAIL");
	assert.equal(
		p.deadline,
		json(path.join(f.config.evidence, "preparation-result.json")).coldDeadline,
	);
	assert.equal(p.cleanup.status, "STOPPED_ACCOUNTED");
	assert.equal(
		fs.existsSync(
			path.join(f.config.evidence, "prepare-app-images-before-restoration"),
		),
		false,
	);
	assert.equal(
		jsonLines(path.join(f.root, "commands.jsonl")).filter(
			(a) => a[1] === "boat-stop",
		).length,
		1,
	);
});

for (const delay of [181, 1201])
	test(`547 cold acceptance remains bounded after native completion delayed ${delay}`, async (t) => {
		const f = preparationFixture(t);
		let offset = 0;
		await assert.rejects(
			() =>
				f.run({
					observeCli: f.observeCli,
					clock: () => mono() + offset,
					make: async (argv, options) => {
						const result = await f.make(argv, options);
						if (argv.includes("PACKAGE=user")) offset = delay;
						return result;
					},
				}),
			/Original phase\/cold deadline exceeded/,
		);
		assert.equal(
			json(path.join(f.config.evidence, "red-user/command/receipt.json"))
				.terminal.code,
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
