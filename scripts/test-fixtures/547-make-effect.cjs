// Controlled external Make effects for the preparation composition tests.
// Native application output is retained fixture data, never a new measurement.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const read = (p) => JSON.parse(fs.readFileSync(p));
const save = (p, v) => fs.writeFileSync(p, JSON.stringify(v));
const args = JSON.parse(process.env.CONTROL_MAKE_ARGV);
const repository = process.env.CONTROL_REPOSITORY;
const data = read(
	path.join(repository, "scripts/test-fixtures/547-preparation.json"),
);
const root = process.cwd();
const preparationSources = () => {
	const workload = read(
		path.join(repository, "scripts/boat-workloads/547.json"),
	);
	return Object.fromEntries(
		[...workload.inputs.tests, ...workload.inputs.repair].map(
			({ path: file }) => [
				file,
				fs.existsSync(file)
					? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
					: null,
			],
		),
	);
};
const key = createHash("sha256").update(root).digest("hex").slice(0, 12);
const target = args[1];
const services = [
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
];
const id = (index) => (index + 1).toString(16).padStart(64, "0");
const value = (name) =>
	args.find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1);
const event = (kind) =>
	fs.appendFileSync(
		".boat/events.jsonl",
		JSON.stringify({
			at: new Date().toISOString(),
			kind,
			workerId: "controlled-worker",
			completed: true,
		}) + "\n",
	);
fs.appendFileSync("commands.jsonl", JSON.stringify(args) + "\n");
let phase = target;
if (target === "apps-build") {
	fs.writeFileSync("app-build-entered", "entered");
	console.log("Application images prepared");
	const gate = process.env.CONTROL_APP_IMAGE_GATE;
	const until = Date.now() + 10000;
	while (gate && !fs.existsSync(gate)) {
		assert.ok(Date.now() < until, "Controlled app image build gate expired");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
	}
	save("application-images-prepared.json", { completed: true });
}
if (target === "infra-start") {
	// Independent destinations/hashes from the frozen SDK8 workload contract.
	// This check runs before the controlled infrastructure side effect.
	const expected = {
		"apps/user/src/boat-live-547.ts":
			"0b3163257ffa0f393227470c98cf157d2dc0d394c2c9f6fe9b49651172b0f877",
		"apps/wallpaper/src/boat-live-547.ts":
			"0329aa9616c5b2f0cc690661a5ceb8609939f02317362bc871c90f2f594d2d45",
		"apps/asset/src/boat-live-547.ts":
			"aa6eb023541d9aa06acf3855c9461c6df55cbaae5806360f8d77ec8c55348906",
		"apps/asset/test/fixtures/remediation-live.mjs":
			"9ac9113325ea854434df5f5bd7a2623e042d78efc0772c00be27e3904c147f6e",
		"apps/asset/test/fixtures/remediation-sdk-proof.ts":
			"d7e434e4ee1fe447bbc42c83666f880627f13f6415c35acb9e0b467a90d9df70",
		"apps/user/src/boat-sdk-proof-547.ts":
			"d7e434e4ee1fe447bbc42c83666f880627f13f6415c35acb9e0b467a90d9df70",
		"apps/wallpaper/src/boat-sdk-proof-547.ts":
			"d7e434e4ee1fe447bbc42c83666f880627f13f6415c35acb9e0b467a90d9df70",
		"apps/asset/src/boat-sdk-proof-547.ts":
			"d7e434e4ee1fe447bbc42c83666f880627f13f6415c35acb9e0b467a90d9df70",
	};
	for (const [file, hash] of Object.entries(expected)) {
		assert.equal(
			fs.lstatSync(file).isFile(),
			true,
			`SDK input must be regular before infra: ${file}`,
		);
		assert.equal(
			createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
			hash,
			`Exact SDK input before infra: ${file}`,
		);
	}
	save("sdk8-observed-before-infra.json", expected);
} else if (target === "run" && value("SCRIPT") === "boat:observe-preview") {
	const input = value("ARGS").replace(/^'|'$/g, "");
	const r = spawnSync(
		"python",
		[path.join(repository, "scripts/boat-preview-observation.py"), input],
		{ stdio: "inherit" },
	);
	process.exitCode = r.status ?? 1;
} else if (target === "docker-run" && value("ARGS").includes(" application-")) {
	const inspect = value("ARGS").includes(" application-inspect ");
	const rows = inspect
		? services.map((service, i) => ({
				id: id(i),
				image: `sha256:${id(i + 10)}`,
				state: {
					Running: true,
					Status: "running",
					Pid: i + 100,
					StartedAt: "2026-11-03T00:00:00Z",
				},
				restartCount: 0,
				created: "2026-11-03T00:00:00Z",
				labels: {
					"com.docker.compose.service": service,
					"com.docker.compose.project": process.env.CONTROL_PROJECT,
					"com.docker.compose.config-hash": id(i + 20),
				},
				ports: {},
			}))
		: [
				...services,
				"postgres",
				"minio",
				"nats",
				"redis",
				"opensearch",
				"lgtm",
				"migrations",
				"setup",
			].map((Service, i) => ({
				ID: id(i),
				Service,
				Project: process.env.CONTROL_PROJECT,
				State: "running",
			}));
	if (process.env.CONTROL_MISSING_SERVICE) rows[0].Service = "postgres";
	if (inspect && process.env.CONTROL_CONTAINER_CHANGED) {
		const n = fs.existsSync("inspect-count.json")
			? read("inspect-count.json") + 1
			: 1;
		save("inspect-count.json", n);
		if (n === (process.env.CONTROL_CONTAINER_CHANGED === "before" ? 1 : 2))
			rows[0].restartCount += 1;
	}
	console.log("Reusing the inherited Docker host lock.");
	console.log(
		"BOAT547_APPLICATION " +
			JSON.stringify({
				mode: inspect ? "application-inspect" : "application-ps",
				nativeStdout: Buffer.from(
					rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
				).toString("base64"),
			}),
	);
	console.log("Docker validation waited 0.0s; execution 0.0s; exit 0.");
} else if (target === "boat-enroll") {
	fs.mkdirSync(".boat");
	save(".boat/enrollment.json", {
		root,
		key,
		size: "large",
		mode: "development",
		cohort: "c",
		lifecycle: "fresh-after-stop",
		cacheNamespace: value("BOAT_CACHE_NAMESPACE"),
	});
	console.log("boat 1.0.85\nEnrolled. No worker created.");
} else if (target === "boat-prepare-toolchain") {
	const previous = fs.existsSync(".boat/state.json")
		? read(".boat/state.json")
		: {};
	save(".boat/state.json", {
		id: "controlled-worker",
		runningSince: Date.now(),
		developmentWanted: previous.developmentWanted,
		reconciliationPending: previous.reconciliationPending,
		admission: {
			status: "published",
			token: "controlled-admission",
			name: "controlled-owner",
			owner: { root, key },
			candidate: {
				id: "controlled-worker",
				size: "large",
				name: "controlled-owner",
			},
		},
	});
	event("toolchain-preparation");
	if (process.env.CONTROL_PENDING_CANDIDATE) {
		const token = "11111111-2222-4333-8444-555555555555";
		const name = `wallpaperdb-557-c-${key}-${token}`;
		save(".boat/state.json", {
			id: null,
			runningSince: null,
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
		});
		console.error(
			"Controlled preparation failed before main worker publication",
		);
		process.exitCode = 1;
	}
} else if (target === "boat-prepare-workspace") {
	save("workspace-prepared.json", { completed: true });
	event("workspace-preparation");
} else if (target === "boat-prepare-app-images") {
	assert.equal(fs.existsSync("infra-images-prepared.json"), true);
	save("source-at-app-image-preparation.json", preparationSources());
	save("restoration-app-images-prepared.json", { completed: true });
	event("app-image-preparation");
} else if (target === "test-focused") {
	const color = fs.existsSync("patches/nats-2.29.3.patch") ? "green" : "red";
	phase = `${color}-${value("ARGS").includes("protected-broker") ? "auth" : value("PACKAGE")}`;
	if (
		phase === "red-user" &&
		process.env.CONTROL_REQUIRE_RECONCILIATION_PREPARATION
	) {
		save("source-at-first-ordinary.json", preparationSources());
		assert.equal(
			fs.existsSync("workspace-prepared.json"),
			true,
			"Frozen workspace must be prepared before wanted restoration",
		);
		assert.equal(
			fs.existsSync("infra-images-prepared.json"),
			true,
			"Infrastructure images must be prepared before wanted restoration",
		);
		const state = read(".boat/state.json");
		assert.equal(
			fs.existsSync("restoration-app-images-prepared.json"),
			true,
			"Application images must be prepared before wanted restoration",
		);
		save("intent-at-first-ordinary.json", {
			wanted: state.developmentWanted,
			pending: state.reconciliationPending,
		});
	}
	if (phase === "red-asset") {
		process.stdout.write(
			fs.readFileSync(
				path.join(repository, "scripts/test-fixtures/547-asset.stdout.txt"),
			),
		);
		process.stderr.write(
			fs.readFileSync(
				path.join(repository, "scripts/test-fixtures/547-asset.stderr.txt"),
			),
		);
	} else {
		process.stdout.write(data.output[phase].stdout);
		if (
			phase === "red-user" &&
			process.env.CONTROL_ERROR_CASE === "user-non-assertion"
		) {
			for (const [index, ending] of [
				"timeout",
				"cancellation",
				"disposal",
			].entries())
				process.stderr.write(
					`FAIL user-integration test/broker-acquisition.integration.test.ts > closes the native silent-peer socket after ${ending}\n${index === 2 ? "Error: transport disappeared" : "AssertionError: expected 1 to be +0\n test/broker-acquisition.integration.test.ts:50"}\n⎯ [${index + 1}/3] ⎯\n`,
				);
		} else process.stderr.write(data.output[phase].stderr);
	}
	if (color === "red") process.exitCode = 1;
	if (
		phase === "red-user" &&
		process.env.CONTROL_ERROR_CASE === "unrelated-wrapper"
	)
		process.stderr.write(
			"ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed with exit code 1: vitest run test/unrelated\n",
		);
} else if (target === "run" && value("SCRIPT") === "dependencies:lock") {
	if (
		!fs
			.readFileSync("pnpm-lock.yaml", "utf8")
			.includes(
				"    hash: 6991af2bfc41fcaa937a824a006f1037640a92cc2767e53276acf52b624590fe",
			)
	) {
		const patched = spawnSync("patch", ["--silent", "-p1"], {
			input: data.lockDiff,
		});
		if (patched.status !== 0)
			throw new Error("Native lock fixture could not be applied");
		if (process.env.CONTROL_LOCK_DRIFT)
			fs.appendFileSync("pnpm-lock.yaml", "\n# unrelated native output\n");
	}
} else if (target === "docker-run") {
	phase = value("ARGS").endsWith(" metadata") ? "metadata" : "chromium-launch";
	const observed = data.output[phase];
	if (phase === "metadata")
		observed.rootLock.sha256 = createHash("sha256")
			.update(fs.readFileSync("pnpm-lock.yaml"))
			.digest("hex");
	console.log(
		`${phase === "metadata" ? "BOAT547_WORKER_METADATA" : "BOAT547_CHROMIUM_LAUNCH"} ${JSON.stringify(observed)}`,
	);
} else if (target === "boat-prepare-infra-images") {
	if (process.env.CONTROL_REQUIRE_RECONCILIATION_PREPARATION)
		assert.equal(
			fs.existsSync("workspace-prepared.json"),
			true,
			"Workspace preparation must precede acquisition",
		);
	const observed = data.output["prepare-infra-images"];
	observed.project = process.env.CONTROL_PROJECT;
	console.log(`BOAT_INFRA_IMAGES ${JSON.stringify(observed)}`);
	save("infra-images-prepared.json", { completed: true });
	event("infra-image-preparation");
} else if (target === "boat-stop") {
	const retired = {};
	for (const name of ["dev", "preview", "replacement-preview"]) {
		const capture = path.join("evidence/startup", name);
		if (!fs.existsSync(path.join(capture, "invocation.json"))) continue;
		const disposal = read(path.join(capture, "disposal.json"));
		assert.equal(
			disposal.pipesClosed,
			true,
			`${name} capture must drain before worker stop`,
		);
		assert.deepEqual(
			disposal.unresolved,
			[],
			`${name} ownership must retire before worker stop`,
		);
		retired[name] = disposal;
	}
	if (Object.keys(retired).length)
		save("retirement-observed-before-stop.json", retired);
	const state = read(".boat/state.json"),
		when = new Date().toISOString();
	if (
		value("BOAT_EXPECTED_WORKER_ID") !== state.id ||
		value("BOAT_EXPECTED_ADMISSION") !== state.admission.token
	)
		throw new Error("Controlled wrong-owner stop");
	state.runningSince = null;
	state.shutdownAttempt = {
		workerId: state.id,
		status: "completed-observed",
		accountingAppliedAt: when,
		completion: {
			workerId: state.id,
			provider: {
				id: state.id,
				stop: {
					id: "controlled-stop",
					status: "completed",
					forced: false,
					error: null,
					endedAt: when,
				},
			},
		},
	};
	save(".boat/state.json", state);
}
if (process.env.CONTROL_FAIL === phase) {
	console.error("SyntaxError: controlled external failure");
	process.exitCode = 1;
}
