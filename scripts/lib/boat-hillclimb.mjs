import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureCommand, captureServingCommand } from "./boat-capture.mjs";
import { start547Application } from "./boat-547-startup.mjs";
import { assessAssetBaseline } from "./boat-547-baseline.mjs";
import {
	create547Preparation,
	preparationInputs,
	qualifiedCliSha256,
} from "./boat-547-preparation.mjs";

const contractPath = fileURLToPath(
	new URL("../boat-workloads/547-asset-baseline.json", import.meta.url),
);
const workloadPath = fileURLToPath(
	new URL("../boat-workloads/547.json", import.meta.url),
);
const implementationPaths = [
	import.meta.url,
	"./boat-capture.mjs",
	"./boat-547-baseline.mjs",
	"./boat-shutdown.mjs",
].map((file) => fileURLToPath(new URL(file, import.meta.url)));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const monotonic = () => Number(process.hrtime.bigint()) / 1e9;

function fileIdentity(file) {
	const stat = fs.lstatSync(file);
	if (!stat.isFile()) throw new Error(`Expected regular input: ${file}`);
	return {
		path: file,
		name: path.basename(file),
		bytes: stat.size,
		sha256: sha(fs.readFileSync(file)),
		mode: stat.mode & 0o777,
	};
}

function publish(file, value) {
	const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
	const temporary = `${file}.${randomUUID()}.tmp`;
	const fd = fs.openSync(temporary, "wx", 0o600);
	try {
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temporary, file);
	const directory = fs.openSync(path.dirname(file), "r");
	try {
		fs.fsyncSync(directory);
	} finally {
		fs.closeSync(directory);
	}
	if (!fs.readFileSync(file).equals(bytes))
		throw new Error("Result publication readback failed");
}

function worktreeIdentity(root) {
	const worktree = fs.readFileSync(path.join(root, ".worktree"), "utf8");
	const value = (name) =>
		worktree
			.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
			?.trim()
			.replace(/^["']|["']$/g, "");
	const identity = {
		root,
		key: sha(root).slice(0, 12),
		project: value("COMPOSE_PROJECT_NAME"),
		ingress: Number(value("INGRESS_PORT")),
	};
	if (
		!identity.project ||
		!Number.isSafeInteger(identity.ingress) ||
		identity.ingress < 1 ||
		identity.ingress > 65535
	)
		throw new Error("Missing generated worktree identity");
	return identity;
}

function owner(root, identity = worktreeIdentity(root)) {
	const enrollmentPath = path.join(root, ".boat/enrollment.json");
	if (!fs.existsSync(enrollmentPath)) return { ...identity, worker: null };
	const enrollment = read(enrollmentPath),
		state = read(path.join(root, ".boat/state.json")),
		admission = state.admission;
	if (
		enrollment.root !== root ||
		enrollment.key !== identity.key ||
		enrollment.size !== "large" ||
		enrollment.lifecycle !== "fresh-after-stop" ||
		!Number.isFinite(state.runningSince) ||
		state.runningSince <= 0 ||
		typeof state.id !== "string" ||
		admission?.status !== "published" ||
		typeof admission.token !== "string" ||
		!admission.token ||
		!/^[A-Za-z0-9_-]+$/.test(admission.token) ||
		typeof admission.name !== "string" ||
		!admission.name ||
		admission.owner?.root !== root ||
		admission.owner?.key !== identity.key ||
		admission.candidate?.id !== state.id ||
		admission.candidate?.size !== "large" ||
		admission.candidate?.name !== admission.name ||
		!/^[-_A-Za-z0-9]+$/.test(state.id) ||
		admission.previousWorkerId === state.id ||
		admission.shutdownAttempt
	)
		throw new Error("Owned published worker is missing or changed");
	return {
		...identity,
		worker: state.id,
		admission: admission.token,
		name: admission.name,
	};
}

export function makeCommand(argv, options) {
	if (
		argv[0] !== "make" ||
		argv.some((x) => typeof x !== "string" || x.includes("\0"))
	)
		throw new Error("Expected Make argv data");
	// Each independent invocation carries its own options and assignments in argv.
	const env = { ...(options.env ?? process.env), MAKELEVEL: "0" };
	for (const name of ["MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS"])
		delete env[name];
	return options.serving
		? captureServingCommand({ ...options, argv, env })
		: captureCommand({ ...options, argv, env });
}

function captured(directory, receipt, expectedArgv, code = 2) {
	const invocation = read(path.join(directory, "invocation.json"));
	const disposal = read(path.join(directory, "disposal.json"));
	if (
		JSON.stringify(read(path.join(directory, "receipt.json"))) !==
			JSON.stringify(receipt) ||
		invocation.deadline !== receipt.deadline ||
		!Number.isFinite(receipt.ended?.monotonic) ||
		receipt.ended.monotonic >= receipt.deadline ||
		disposal.failure
	)
		throw new Error("Captured completion or original deadline mismatch");
	if (
		JSON.stringify(receipt.argv) !== JSON.stringify(expectedArgv) ||
		JSON.stringify(invocation.argv) !== JSON.stringify(expectedArgv) ||
		!receipt.captureComplete ||
		receipt.failure ||
		receipt.spawnError ||
		receipt.terminal?.signal !== null ||
		receipt.terminal?.code !== code ||
		disposal.pipesClosed !== true ||
		disposal.unresolved?.length !== 0 ||
		JSON.stringify(disposal.terminal) !== JSON.stringify(receipt.terminal)
	)
		throw new Error("Native Make terminal or drainage failed");
	return Object.fromEntries(
		["stdout", "stderr"].map((name) => {
			const bytes = fs.readFileSync(path.join(directory, `${name}.raw`));
			const expected = receipt.files[name];
			if (
				expected.overflow ||
				bytes.length !== expected.bytes ||
				sha(bytes) !== expected.sha256
			)
				throw new Error(`Captured ${name} integrity failed`);
			return [name, bytes];
		}),
	);
}

function manifest(directory, exclude = []) {
	const files = [];
	const collect = (folder) => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) collect(file);
			else if (
				file !== path.join(directory, "manifest.json") &&
				!exclude.includes(file)
			)
				files.push({
					...fileIdentity(file),
					name: path.relative(directory, file),
				});
		}
	};
	collect(directory);
	publish(path.join(directory, "manifest.json"), {
		files: files.sort((a, b) => a.name.localeCompare(b.name)),
	});
}

async function stopOwned(
	root,
	binding,
	evidence,
	make,
	pending = false,
	checkOwner = owner,
) {
	if (!binding.worker && !binding.admission)
		return { status: "NOT_NEEDED_LOCAL_CONTROL" };
	try {
		if (pending) {
			const state = read(path.join(root, ".boat/state.json"));
			if (
				state.admission?.token !== binding.admission ||
				state.admission.owner?.root !== root ||
				state.admission.owner?.key !== binding.key ||
				state.runningSince != null
			)
				throw new Error("Pending admission changed; no stop authority");
		} else if (JSON.stringify(binding) !== JSON.stringify(checkOwner(root)))
			throw new Error("Owning worker changed; no stop authority");
		const directory = path.join(evidence, "owning-stop");
		const argv = [
			"make",
			"boat-stop",
			...(pending ? [] : [`BOAT_EXPECTED_WORKER_ID=${binding.worker}`]),
			`BOAT_EXPECTED_ADMISSION=${binding.admission}`,
		];
		const receipt = await make(argv, {
			directory,
			deadline: monotonic() + 180,
			cwd: root,
		});
		captured(directory, receipt, argv, 0);
		const state = read(path.join(root, ".boat/state.json"));
		const selected = pending
			? { ...state.admission, id: state.admission?.candidate?.id }
			: state;
		const attempt = selected.shutdownAttempt;
		const accounted =
			selected.id === binding.worker &&
			selected.runningSince === null &&
			attempt?.workerId === binding.worker &&
			attempt.status === "completed-observed" &&
			attempt.completion?.workerId === binding.worker &&
			attempt.completion?.provider?.id === binding.worker &&
			Number.isFinite(Date.parse(attempt.accountingAppliedAt));
		const stop = attempt?.completion?.provider?.stop;
		const completed =
			accounted &&
			typeof stop?.id === "string" &&
			stop?.status === "completed" &&
			stop.forced === false &&
			stop.error === null &&
			Number.isFinite(Date.parse(stop.endedAt));
		return {
			status: completed
				? "STOPPED_ACCOUNTED"
				: accounted
					? "STOPPED_ACCOUNTED_OPERATION_UNVERIFIED"
					: "UNRESOLVED",
			worker: selected.id,
			runningSince: selected.runningSince,
			accountingAppliedAt: attempt?.accountingAppliedAt,
			stop,
			cost: selected.cost,
		};
	} catch (error) {
		return { status: "UNRESOLVED", error: error.message };
	}
}

export async function execute547Asset(config, dependencies = {}) {
	return execute547Phase(config, dependencies, {
		id: "red-asset",
		argv: read(contractPath).nativeMakeArgv,
		code: 2,
		inputs(root, binding) {
			const paths = [
				contractPath,
				workloadPath,
				...implementationPaths,
				path.join(root, ".worktree"),
			];
			if (binding.worker) {
				const workload = read(workloadPath);
				for (const input of [
					...workload.inputs.tests,
					workload.inputs.initialLock,
					workload.inputs.unchangedProtectedControl,
					...read(contractPath).baselineSources,
				]) {
					const file = path.join(root, input.path);
					if (sha(fs.readFileSync(file)) !== input.sha256)
						throw new Error(`Frozen workload input changed: ${input.path}`);
					paths.push(file);
				}
			}
			return paths;
		},
		assess: (raw) =>
			assessAssetBaseline(raw.stdout, raw.stderr, read(contractPath)),
	});
}

async function execute547Phase(
	config,
	{
		make = makeCommand,
		clock = monotonic,
		publication = publish,
		binding: suppliedBinding,
		checkOwner = owner,
		cleanup = stopOwned,
	} = {},
	spec,
) {
	const started = clock();
	const allowanceSeconds = spec.allowanceSeconds ?? 180;
	const deadline = Math.min(started + allowanceSeconds, config.coldDeadline);
	const root = fs.realpathSync(config.worktree);
	if (
		root !== config.worktree ||
		!/^[a-zA-Z0-9_-]+$/.test(config.round) ||
		!path.isAbsolute(config.evidence) ||
		!Number.isFinite(deadline) ||
		deadline <= started + 5 ||
		config.coldDeadline > started + 1200
	)
		throw new Error("Invalid worktree, round or original cold deadline");
	const binding = suppliedBinding ?? checkOwner(root);
	fs.mkdirSync(config.evidence, { recursive: true, mode: 0o700 });
	const directory = path.join(config.evidence, spec.id);
	fs.mkdirSync(directory, { mode: 0o700 }); // Exclusive owning phase; capture owns a distinct absent child.
	const result = {
		version: 1,
		phase: spec.id,
		round: config.round,
		scope: binding.worker ? "LIVE" : "LOCAL_CONTROL",
		owner: binding,
		started,
		deadline,
		allowanceSeconds,
	};
	const within = () => {
		if (clock() >= deadline)
			throw new Error(
				"Original phase/cold deadline exceeded before acceptance",
			);
	};
	try {
		within();
		await spec.prepare?.();
		const inputs = spec.inputs(root, binding);
		const before = inputs.map(fileIdentity);
		result.inputs = before;
		const preserved = () => {
			if (
				JSON.stringify(before) !== JSON.stringify(inputs.map(fileIdentity)) ||
				JSON.stringify(binding) !== JSON.stringify(checkOwner(root))
			)
				throw new Error("Phase source or owner changed");
		};
		within();
		const command = path.join(directory, "command");
		const receipt = await make(spec.argv, {
			directory: command,
			deadline,
			cwd: root,
		});
		const raw = captured(command, receipt, spec.argv, spec.code ?? 0);
		within();
		result.outcome = await spec.assess(raw, { directory, receipt, within });
		preserved();
		within();
		Object.assign(result, { status: "PASS", acceptedAt: clock() });
		publication(path.join(directory, "result.json"), result);
		manifest(directory);
		preserved();
		within();
		return result;
	} catch (error) {
		delete result.acceptedAt;
		Object.assign(result, {
			status: "FAIL",
			error: error.message,
			failedAt: clock(),
			cleanup: {
				status: binding.worker
					? "PENDING_OWNING_STOP"
					: "NOT_NEEDED_LOCAL_CONTROL",
			},
		});
		// Publish failure before cleanup so a late acceptance never remains visible as PASS.
		const record = () => {
			try {
				publish(path.join(directory, "result.json"), result);
			} catch (publicationError) {
				result.publicationError = publicationError.message;
			}
		};
		record();
		result.cleanup = await cleanup(root, binding, config.evidence, make);
		record();
		try {
			manifest(directory);
		} catch (manifestError) {
			result.manifestError = manifestError.message;
		}
		throw error;
	}
}

export async function execute547Preparation(config, dependencies = {}) {
	if (
		Object.keys(config).some(
			(key) =>
				!["worktree", "round", "evidence", "cacheNamespace", "until"].includes(
					key,
				),
		)
	)
		throw new Error(
			"Preparation configuration accepts only worktree, round, evidence, cacheNamespace and until",
		);
	if (config.until !== undefined && !["images", "ready"].includes(config.until))
		throw new Error("Preparation until must be images or ready");
	const {
		make = makeCommand,
		clock = monotonic,
		publication = publish,
		observeCli = fileIdentity,
	} = dependencies;
	const root = fs.realpathSync(config.worktree);
	if (
		root !== config.worktree ||
		!/^[a-zA-Z0-9_-]+$/.test(config.round) ||
		!path.isAbsolute(config.evidence)
	)
		throw new Error(
			"Invalid preparation worktree, round or evidence destination",
		);
	const identity = worktreeIdentity(root);
	const namespace = config.cacheNamespace ?? `547-${identity.key}`;
	if (!/^[a-z0-9][a-z0-9-]*$/.test(namespace))
		throw new Error("Invalid preparation cache namespace");
	const enrollmentFile = path.join(root, ".boat/enrollment.json"),
		stateFile = path.join(root, ".boat/state.json");
	const previous = fs.existsSync(stateFile) ? read(stateFile) : {};
	if (
		previous.runningSince != null ||
		(previous.admission &&
			previous.admission.status !== "published" &&
			previous.admission.runningSince != null)
	)
		throw new Error(
			"Preparation requires no prior running or pending compute obligation",
		);
	fs.mkdirSync(path.dirname(config.evidence), { recursive: true, mode: 0o700 });
	fs.mkdirSync(config.evidence, { mode: 0o700 });
	let binding = { ...identity, worker: null },
		workload,
		coldStarted,
		coldDeadline;
	let creationMayHaveStarted = false,
		cleanupResult;
	const results = [];
	const immutablePaths = [
		...new Set([
			workloadPath,
			contractPath,
			...implementationPaths,
			...preparationInputs,
			...["../boat.mjs", "../boat-hillclimb.mjs", "../boat-route.mk"].map(
				(file) => fileURLToPath(new URL(file, import.meta.url)),
			),
			path.join(root, ".worktree"),
			path.join(root, "Makefile"),
		]),
	];
	const immutable = immutablePaths.map(fileIdentity);
	const preservedImplementation = () => {
		if (
			JSON.stringify(immutable) !==
			JSON.stringify(immutablePaths.map(fileIdentity))
		)
			throw new Error(
				"Preparation implementation or generated worktree identity changed",
			);
	};
	const summary = {
		version: 1,
		scheduleVersion: "547-cold-v6-early-chromium",
		round: config.round,
		phase: "preparation",
		owner: binding,
		phases: results,
	};
	const currentOwner = () => (binding.worker ? owner(root, identity) : binding);
	const cleanup = async () => {
		if (cleanupResult) return cleanupResult;
		cleanupResult = { status: "UNRESOLVED", error: "Cleanup did not complete" };
		try {
			if (!binding.worker && creationMayHaveStarted) {
				const state = read(stateFile),
					a = state.admission;
				if (
					a?.token !== previous.admission?.token &&
					a?.owner?.root === root &&
					a?.owner?.key === identity.key &&
					typeof a.token === "string" &&
					/^[A-Za-z0-9_-]+$/.test(a.token)
				) {
					if (a.status === "published") binding = owner(root, identity);
					else {
						cleanupResult = await stopOwned(
							root,
							{
								...identity,
								worker: a.candidate?.id ?? null,
								admission: a.token,
							},
							config.evidence,
							make,
							true,
						);
						return cleanupResult;
					}
				} else if (
					state.runningSince != null ||
					(a && a.status !== "published") ||
					state.id !== previous.id
				)
					throw new Error(
						"Created compute ownership is unresolved; no stop authority",
					);
			}
			cleanupResult = await stopOwned(
				root,
				binding,
				config.evidence,
				make,
				false,
				() => owner(root, identity),
			);
			return cleanupResult;
		} catch (error) {
			cleanupResult = { status: "UNRESOLVED", error: error.message };
			return cleanupResult;
		}
	};
	let prepared;
	// Only cold acquisition shares the aggregate. Workload execution and proof
	// retain their ordinary bounds, including the actual Chromium launch.
	const provisioning = new Set([
		"prepare-toolchain",
		"prepare-workspace",
		"prepare-images-before-restoration",
		"prepare-app-images-before-restoration",
		"chromium-install",
		"prepare-infra-images",
	]);
	const run = async (id, argv, options = {}) => {
		const internal = { ...config, coldDeadline: coldDeadline ?? clock() + 180 };
		const result = await execute547Phase(
			internal,
			{ make, clock, publication, binding, checkOwner: currentOwner, cleanup },
			{
				id,
				argv,
				allowanceSeconds: provisioning.has(id)
					? coldDeadline - coldStarted
					: undefined,
				code: options.code,
				prepare: options.prepare,
				inputs: () => {
					preservedImplementation();
					return [
						...new Set([...immutablePaths, ...(workload?.inputs() ?? [])]),
					].filter((file) => !options.mutable?.includes(file));
				},
				assess: options.assess ?? (() => ({ completed: true })),
			},
		);
		results.push({
			phase: id,
			status: result.status,
			started: result.started,
			acceptedAt: result.acceptedAt,
			deadline: result.deadline,
			allowanceSeconds: result.allowanceSeconds,
			outcome: result.outcome,
		});
		return result;
	};
	const enrollment = () => {
		const value = read(enrollmentFile);
		if (
			value.root !== root ||
			value.key !== identity.key ||
			value.size !== "large" ||
			value.mode !== "development" ||
			value.cohort !== "c" ||
			value.lifecycle !== "fresh-after-stop" ||
			value.cacheNamespace !== namespace
		)
			throw new Error("Measured enrollment does not match this preparation");
		const cli = path.join(root, ".mise/boat/boat");
		const observation = observeCli(cli);
		if (observation.sha256 !== qualifiedCliSha256)
			throw new Error("Post-enrollment CLI identity mismatch");
		return { ...value, cli: observation };
	};
	const event = (kind, receipt) => {
		const matches = fs
			.readFileSync(path.join(root, ".boat/events.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse)
			.filter(
				(e) =>
					e.kind === kind && Date.parse(e.at) >= Date.parse(receipt.began.utc),
			);
		if (
			matches.length !== 1 ||
			matches[0].workerId !==
				(binding.worker ?? owner(root, identity).worker) ||
			matches[0].completed !== true
		)
			throw new Error(`Missing current ${kind} completion event`);
		return matches[0];
	};
	const prepareImages = (id) =>
		run(id, ["make", "boat-prepare-infra-images"], {
			assess: (raw, { receipt }) => ({
				...workload.acceptImages(raw, identity.project),
				event: event("infra-image-preparation", receipt),
			}),
		});
	try {
		workload = create547Preparation(root, dependencies.objects);
		if (fs.existsSync(enrollmentFile)) summary.enrollment = enrollment();
		else
			summary.enrollment = (
				await run(
					"enroll",
					[
						"make",
						"boat-enroll",
						"MODE=development",
						"SIZE=large",
						"COHORT=c",
						"LIFECYCLE=fresh-after-stop",
						`BOAT_CACHE_NAMESPACE=${namespace}`,
					],
					{ assess: () => enrollment() },
				)
			).outcome;
		// Enrollment/bootstrap is local. The original cold clock begins here once.
		coldStarted = clock();
		coldDeadline = coldStarted + 1200;
		summary.coldStarted = coldStarted;
		summary.coldDeadline = coldDeadline;
		creationMayHaveStarted = true;
		await run("prepare-toolchain", ["make", "boat-prepare-toolchain"], {
			// Keep the prepared image context identical to the first ordinary test.
			prepare: workload.stageTests,
			assess: (_raw, { receipt }) => ({
				owner: owner(root, identity),
				event: event("toolchain-preparation", receipt),
			}),
		});
		binding = owner(root, identity);
		if (previous.id && binding.worker === previous.id)
			throw new Error("Fresh preparation retained the stopped predecessor");
		summary.owner = binding;
		if (previous.developmentWanted) {
			await run("prepare-workspace", ["make", "boat-prepare-workspace"], {
				assess: (_raw, { receipt }) => ({
					owner: owner(root, identity),
					event: event("workspace-preparation", receipt),
				}),
			});
		}
		await run("chromium-install", ["make", "boat-prepare-chromium"], {
			assess: (_raw, { receipt }) => ({
				event: event("chromium-preparation", receipt),
			}),
		});
		if (previous.developmentWanted) {
			await prepareImages("prepare-images-before-restoration");
			await run(
				"prepare-app-images-before-restoration",
				["make", "boat-prepare-app-images"],
				{
					assess: (_raw, { receipt }) => ({
						event: event("app-image-preparation", receipt),
					}),
				},
			);
		}
		const tests = (name) => [
			"make",
			"test-focused",
			`PACKAGE=${name === "auth" ? "asset" : name}`,
			`ARGS=--config vitest.integration.config.ts ${name === "auth" ? "test/protected-broker.integration.test.ts test/broker-acquisition-errors.integration.test.ts" : "test/broker-acquisition"}`,
		];
		for (const name of ["user", "wallpaper", "asset", "auth"])
			await run(`red-${name}`, tests(name), {
				code: 2,
				assess: (raw, { directory }) => {
					const outcome = workload.assessTests(raw, `red-${name}`);
					if (name === "user")
						publish(
							path.join(directory, "initial-worker.json"),
							read(stateFile),
						);
					return outcome;
				},
			});
		await run("toolchain", ["make", "toolchain"], {
			prepare: workload.stageRepair,
		});
		await run(
			"generate",
			["make", "run", "PACKAGE=scripts", "SCRIPT=dependencies:lock"],
			{
				mutable: [path.join(root, "pnpm-lock.yaml")],
				assess: (_raw, { directory }) => workload.acceptGenerated(directory),
			},
		);
		await run("frozen", ["make", "build", "PACKAGE=vitest-config", "FORCE=1"]);
		await run(
			"noop",
			["make", "run", "PACKAGE=scripts", "SCRIPT=dependencies:lock"],
			{ assess: () => workload.acceptNoop() },
		);
		for (const name of ["user", "wallpaper", "asset", "auth"])
			await run(`green-${name}`, tests(name), {
				assess: (raw) => workload.assessTests(raw, `green-${name}`),
			});
		for (const name of ["user", "wallpaper", "asset"])
			await run(`check-${name}`, ["make", "check", `PACKAGE=${name}`]);
		await run(
			"metadata",
			[
				"make",
				"docker-run",
				"ARGS=node scripts/boat-workloads/547-runtime.cjs metadata",
			],
			{ assess: workload.acceptMetadata },
		);
		await run(
			"chromium-launch",
			[
				"make",
				"docker-run",
				"ARGS=node scripts/boat-workloads/547-runtime.cjs chromium",
			],
			{ assess: workload.acceptChromium },
		);
		await prepareImages("prepare-infra-images");
		workload.verify(true);
		preservedImplementation();
		Object.assign(summary, {
			status: "PASS_PREDEV_THROUGH_IMAGES",
			scope: "LIVE",
			elapsed: clock() - coldStarted,
			compute: "OPEN",
			next: config.until === "ready" ? "STARTUP_PENDING" : "HOLD_BEFORE_SDK8",
		});
		publication(path.join(config.evidence, "preparation-result.json"), summary);
		manifest(config.evidence);
		workload.verify(true);
		preservedImplementation();
		if (clock() >= coldDeadline)
			throw new Error(
				"Original cold deadline exceeded before final publication",
			);
		prepared = summary;
	} catch (error) {
		delete summary.next;
		Object.assign(summary, {
			status: "FAIL",
			error: error.message,
			owner: binding,
			cleanup: await cleanup(),
			failedAt: clock(),
		});
		summary.compute = summary.cleanup.status;
		publish(path.join(config.evidence, "preparation-result.json"), summary);
		manifest(config.evidence);
		throw error;
	}
	if (config.until !== "ready") return prepared;
	return start547Application({
		config,
		binding,
		workload,
		preservedImplementation,
		cleanup,
		make,
		clock,
		publication,
		publish,
		manifest,
		fileIdentity,
		runPhase: (spec, deadline, cleanupStartup) =>
			execute547Phase(
				{
					...config,
					evidence: path.join(config.evidence, "startup"),
					coldDeadline: deadline,
				},
				{
					make,
					clock,
					publication,
					binding,
					checkOwner: currentOwner,
					cleanup: () => cleanupStartup(),
				},
				spec,
			),
	});
}
