import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./boat-capture.mjs";
import { assessAssetBaseline } from "./boat-547-baseline.mjs";

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

function owner(root) {
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
	return captureCommand({ ...options, argv });
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

function manifest(directory) {
	const files = [];
	const collect = (folder) => {
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const file = path.join(folder, entry.name);
			if (entry.isDirectory()) collect(file);
			else if (file !== path.join(directory, "manifest.json"))
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

async function stopOwned(root, binding, evidence, make) {
	try {
		if (JSON.stringify(binding) !== JSON.stringify(owner(root)))
			throw new Error("Owning worker changed; no stop authority");
		const directory = path.join(evidence, "owning-stop");
		const argv = [
			"make",
			"boat-stop",
			`BOAT_EXPECTED_WORKER_ID=${binding.worker}`,
			`BOAT_EXPECTED_ADMISSION=${binding.admission}`,
		];
		const receipt = await make(argv, {
			directory,
			deadline: monotonic() + 180,
			cwd: root,
		});
		captured(directory, receipt, argv, 0);
		const state = read(path.join(root, ".boat/state.json"));
		const attempt = state.shutdownAttempt;
		const accounted =
			state.id === binding.worker &&
			state.runningSince === null &&
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
			worker: state.id,
			runningSince: state.runningSince,
			accountingAppliedAt: attempt?.accountingAppliedAt,
			stop,
			cost: state.cost,
		};
	} catch (error) {
		return { status: "UNRESOLVED", error: error.message };
	}
}

export async function execute547Asset(
	config,
	{ make = makeCommand, clock = monotonic, publication = publish } = {},
) {
	const started = clock();
	const deadline = Math.min(started + 180, config.coldDeadline);
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
	const binding = owner(root);
	fs.mkdirSync(config.evidence, { recursive: true, mode: 0o700 });
	const directory = path.join(config.evidence, "red-asset");
	fs.mkdirSync(directory, { mode: 0o700 }); // Exclusive owning phase; capture owns a distinct absent child.
	const result = {
		version: 1,
		phase: "red-asset",
		round: config.round,
		scope: binding.worker ? "LIVE" : "LOCAL_CONTROL",
		owner: binding,
		started,
		deadline,
	};
	const within = () => {
		if (clock() >= deadline)
			throw new Error(
				"Original phase/cold deadline exceeded before acceptance",
			);
	};
	try {
		const contract = read(contractPath);
		const inputs = [
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
				...contract.baselineSources,
			]) {
				const file = path.join(root, input.path);
				if (sha(fs.readFileSync(file)) !== input.sha256)
					throw new Error(`Frozen workload input changed: ${input.path}`);
				inputs.push(file);
			}
		}
		const before = inputs.map(fileIdentity);
		result.inputs = before;
		const preserved = () => {
			if (
				JSON.stringify(before) !== JSON.stringify(inputs.map(fileIdentity)) ||
				JSON.stringify(binding) !== JSON.stringify(owner(root))
			)
				throw new Error("Phase source or owner changed");
		};
		within();
		const command = path.join(directory, "command");
		const receipt = await make(contract.nativeMakeArgv, {
			directory: command,
			deadline,
			cwd: root,
		});
		const raw = captured(command, receipt, contract.nativeMakeArgv);
		within();
		result.outcome = assessAssetBaseline(raw.stdout, raw.stderr, contract);
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
		if (binding.worker)
			result.cleanup = await stopOwned(root, binding, config.evidence, make);
		record();
		try {
			manifest(directory);
		} catch (manifestError) {
			result.manifestError = manifestError.message;
		}
		throw error;
	}
}
