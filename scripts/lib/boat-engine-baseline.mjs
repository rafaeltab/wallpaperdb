// #547 optional Engine observation. This never identifies a BuildKit backend.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { captureCommand, independentMakeEnvironment } from "./boat-capture.mjs";
import { finiteShutdownProcess } from "./boat-shutdown.mjs";

const version = "547-engine-baseline-v1";
const label = "Docker Engine visible through this Docker client endpoint";
const helper = "scripts/lib/boat-engine-baseline.mjs";
const frame = "BOAT_ENGINE_VERSION_V1 ";
const mono = () => Number(process.hrtime.bigint()) / 1e9;
const hash = (b) => createHash("sha256").update(b).digest("hex");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const require = (ok, reason) => {
	if (!ok) throw new Error(reason);
};
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
export const engineVersionFormat =
	'{"ClientVersion":{{json .Client.Version}},"ServerVersion":{{if .Server}}{{json .Server.Version}}{{else}}null{{end}},"ServerAPIVersion":{{if .Server}}{{json .Server.APIVersion}}{{else}}null{{end}},"ServerGitCommit":{{if .Server}}{{json .Server.GitCommit}}{{else}}null{{end}},"ServerOs":{{if .Server}}{{json .Server.Os}}{{else}}null{{end}},"ServerArch":{{if .Server}}{{json .Server.Arch}}{{else}}null{{end}}}';
const makeArgv = [
	"make",
	"docker-run",
	"BOAT_EXEC=worker",
	`ARGS=docker version --format ${quote(engineVersionFormat)}`,
];

function regular(p, privateFile = false) {
	const s = fs.lstatSync(p);
	require(s.isFile() &&
		s.uid === process.getuid() &&
		s.size <= 1024 * 1024 &&
		(!privateFile ||
			((s.mode & 0o777) === 0o600 &&
				s.nlink === 1)), "Engine baseline file ownership differs");
	return fs.readFileSync(p);
}
function evidencePin(file) {
	const bytes = regular(file, true);
	return { file, bytes: bytes.length, sha256: hash(bytes) };
}
function save(p, value, exclusive = false) {
	const temporary = exclusive ? p : `${p}.${process.pid}.tmp`;
	const fd = fs.openSync(temporary, "wx", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	if (!exclusive) fs.renameSync(temporary, p);
	const directory = fs.openSync(path.dirname(p), "r");
	try {
		fs.fsyncSync(directory);
	} finally {
		fs.closeSync(directory);
	}
}
function processIdentity(pid) {
	const fields = fs
		.readFileSync(`/proc/${pid}/stat`, "utf8")
		.split(") ")[1]
		.split(" ");
	require(fields[0] !== "Z", "Engine baseline parent is retired");
	return { pid, startTicks: fields[19] };
}
function helperPin() {
	const bytes = regular(fileURLToPath(import.meta.url));
	return {
		path: helper,
		bytes: bytes.length,
		sha256: hash(bytes),
		mode: fs.lstatSync(fileURLToPath(import.meta.url)).mode & 0o777,
	};
}
export const engineBaselineInputs = () => [helperPin()];

// Private phase data, not an experiment configuration field or timeout knob.
export function engineBaselineContext(
	config,
	owner,
	phase,
	directory,
	deadline,
) {
	const context = {
		version,
		root: config.worktree,
		round: config.round,
		evidence: config.evidence,
		phase,
		worker: owner.worker,
		admission: owner.admission,
		executionDeadline: deadline - 5,
		parent: processIdentity(process.pid),
		helper: helperPin(),
	};
	const file = path.join(directory, "engine-context.json");
	save(file, context, true);
	return {
		BOAT_547_ENGINE_CONTEXT: file,
		BOAT_547_ENGINE_CONTEXT_SHA256: hash(regular(file)),
	};
}

function contextFor(root, worker, admission) {
	const file = process.env.BOAT_547_ENGINE_CONTEXT;
	if (!file) return null;
	const bytes = regular(file, true),
		c = JSON.parse(bytes);
	require(hash(bytes) ===
		process.env
			.BOAT_547_ENGINE_CONTEXT_SHA256, "Engine baseline context bytes differ");
	require(c.version === version &&
		c.root === root &&
		c.worker === worker &&
		c.admission === admission &&
		/^[A-Za-z0-9_-]+$/.test(c.round) &&
		[
			"prepare-startup-app-images",
			"prepare-app-images-before-restoration",
		].includes(c.phase) &&
		path.isAbsolute(c.evidence) &&
		fs.realpathSync(c.evidence) === c.evidence &&
		file.startsWith(c.evidence + path.sep) &&
		fs.realpathSync(file) === file &&
		Number.isFinite(c.executionDeadline) &&
		c.executionDeadline <=
			mono() + 1200, "Engine baseline round or owner differs");
	const parent = processIdentity(c.parent.pid);
	require(parent.startTicks ===
		c.parent.startTicks, "Engine baseline parent changed");
	require(JSON.stringify(c.helper) ===
		JSON.stringify(helperPin()), "Engine baseline helper changed");
	return c;
}
function parseMetadata(text) {
	const lines = text.split("\n");
	require(lines.length === 3 &&
		lines[2] === "" &&
		/^Docker validation waited 0\.0s; execution \d+\.\ds; exit 0\.$/.test(
			lines[1],
		), "Engine baseline Make framing differs");
	const m = JSON.parse(lines[0]);
	const keys = [
		"ClientVersion",
		"ServerVersion",
		"ServerAPIVersion",
		"ServerGitCommit",
		"ServerOs",
		"ServerArch",
	];
	require(JSON.stringify(Object.keys(m).sort()) ===
		JSON.stringify([...keys].sort()) &&
		keys.every(
			(k) => typeof m[k] === "string",
		), "Engine baseline fields differ");
	require(m.ClientVersion === "29.1.3" &&
		m.ServerVersion.length <= 96 &&
		/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(m.ServerVersion) &&
		m.ServerAPIVersion.length <= 8 &&
		/^\d{1,2}\.\d{1,2}$/.test(m.ServerAPIVersion) &&
		m.ServerGitCommit.length <= 64 &&
		/^[0-9a-f]{7,64}$/.test(m.ServerGitCommit) &&
		["linux", "windows"].includes(m.ServerOs) &&
		["386", "amd64", "arm64", "arm", "ppc64le", "s390x", "riscv64"].includes(
			m.ServerArch,
		), "Engine baseline metadata unavailable");
	return m;
}

export async function observeEngineBaseline({
	root,
	worker,
	admission,
	cli,
	remote,
	workerEnvironment,
	assertCurrent,
}) {
	const began = mono();
	const c = contextFor(root, worker, admission);
	if (!c) return null; // Ordinary, unmanaged preparation keeps its original behavior.
	assertCurrent();
	const directory = path.join(c.evidence, "engine-baseline-v1");
	const identity = { version, root, round: c.round, worker, admission };
	if (fs.existsSync(directory)) {
		const s = fs.lstatSync(directory);
		require(s.isDirectory() &&
			!s.isSymbolicLink() &&
			s.uid === process.getuid() &&
			(s.mode & 0o777) ===
				0o700, "Engine baseline directory ownership differs");
		const previousBytes = regular(path.join(directory, "intent.json"), true),
			previous = JSON.parse(previousBytes);
		require(JSON.stringify(previous.owner) ===
			JSON.stringify(
				identity,
			), "Engine baseline claim belongs to another owner");
		require(fs.existsSync(
			path.join(directory, "result.json"),
		), "Engine baseline prior attempt is unresolved");
		const previousResult = JSON.parse(
			regular(path.join(directory, "result.json"), true),
		);
		require(JSON.stringify(previousResult.owner) ===
			JSON.stringify(
				identity,
			), "Engine baseline result belongs to another owner");
		require(previousResult.version === version &&
			previousResult.intentSha256 === hash(previousBytes) &&
			JSON.stringify(previous.helper) === JSON.stringify(c.helper) &&
			JSON.stringify(previous.makeArgv) === JSON.stringify(makeArgv) &&
			Array.isArray(previousResult.evidence) &&
			previousResult.evidence.length ===
				(previousResult.attempts === 1 ? 5 : 0) &&
			previousResult.evidence.every(
				(pin) =>
					pin.file.startsWith(directory + path.sep) &&
					JSON.stringify(pin) === JSON.stringify(evidencePin(pin.file)),
			), "Engine baseline prior evidence changed");
		require([
			"AVAILABLE",
			"UNAVAILABLE_ENDPOINT",
			"UNAVAILABLE_CAPTURE",
			"UNAVAILABLE_NATIVE_EXIT",
			"UNAVAILABLE_METADATA",
			"NO_BUDGET",
			"CANCELLED",
		].includes(
			previousResult.status,
		), "Engine baseline prior retirement is unresolved");
		return {
			status: "ALREADY_RECORDED",
			reference: path.join(directory, "result.json"),
		};
	}
	fs.mkdirSync(directory, { mode: 0o700 });
	const transport = [
		cli,
		"--no-update",
		"ssh",
		worker,
		"--",
		"bash",
		"-lc",
		`${workerEnvironment}; cd ${remote} && mise exec -- node ${helper} --worker ${quote(JSON.stringify(identity))} ${quote(JSON.stringify(c.helper))}`,
	];
	save(
		path.join(directory, "intent.json"),
		{
			owner: identity,
			helper: c.helper,
			phase: c.phase,
			began,
			deadline: began + 2,
			executionDeadline: c.executionDeadline,
			transport,
			makeArgv,
			label,
			totalCapMs: 2000,
			executionMs: 1000,
			disposalMs: 1000,
		},
		true,
	);
	let result = {
		version,
		owner: identity,
		phase: c.phase,
		label,
		intentSha256: hash(regular(path.join(directory, "intent.json"), true)),
		evidence: [],
		attempts: 0,
		engineCLIInvocations: 0,
		engineAPIRequests: 0,
		backendContainerCalls: 0,
		metadata: null,
	};
	try {
		assertCurrent();
		if (c.cancelled === true) result.status = "CANCELLED";
		else if (mono() + 2 > c.executionDeadline) result.status = "NO_BUDGET";
		else {
			result.attempts = 1;
			result.engineCLIInvocations = null;
			result.engineAPIRequests = null;
			const native = await captureCommand({
				argv: transport,
				cwd: root,
				directory: path.join(directory, "transport"),
				deadline: began + 2,
				disposalMs: 1000,
				limit: 32768,
			});
			result.native = native;
			result.evidence = [
				"invocation.json",
				"receipt.json",
				"disposal.json",
				"stdout.raw",
				"stderr.raw",
			].map((file) => evidencePin(path.join(directory, "transport", file)));
			const disposal = read(path.join(directory, "transport/disposal.json"));
			require(disposal.pipesClosed &&
				disposal.unresolved.length ===
					0, "Engine baseline transport ownership unresolved");
			const stdout = fs.readFileSync(
				path.join(directory, "transport/stdout.raw"),
				"utf8",
			);
			require(stdout.startsWith(frame) &&
				stdout.endsWith("\n") &&
				stdout.split("\n").length ===
					2, "Engine baseline remote retirement unproven");
			const observed = JSON.parse(stdout.slice(frame.length));
			require(JSON.stringify(observed.owner) === JSON.stringify(identity) &&
				observed.closed === true &&
				(["UNAVAILABLE_ENDPOINT", "NO_BUDGET"].includes(observed.status) ||
					(observed.status === "OBSERVED" &&
						observed.child?.pipesClosed === true &&
						observed.child.unresolved.length ===
							0)), "Engine baseline remote ownership differs");
			if (observed.child)
				for (const name of ["stdout", "stderr"]) {
					require(typeof observed[name] === "string" &&
						Buffer.from(observed[name], "base64").toString("base64") ===
							observed[name] &&
						Buffer.from(observed[name], "base64").length <=
							32768, "Engine baseline raw encoding differs");
				}
			result.remote = observed;
			result.engineCLIInvocations = observed.child ? 1 : 0;
			result.engineAPIRequests = observed.child
				? "NOT_COUNTED_NATIVE_VERSION_API_BOUNDARY"
				: 0;
			if (!native.captureComplete) result.status = "UNAVAILABLE_CAPTURE";
			else if (native.terminal.code !== 0 || native.terminal.signal)
				result.status = "UNAVAILABLE_NATIVE_EXIT";
			else if (["UNAVAILABLE_ENDPOINT", "NO_BUDGET"].includes(observed.status))
				result.status = observed.status;
			else if (observed.cancelled || observed.failure || observed.overflow)
				result.status = "UNAVAILABLE_CAPTURE";
			else if (
				observed.child.terminal.code !== 0 ||
				observed.child.terminal.signal
			)
				result.status = "UNAVAILABLE_NATIVE_EXIT";
			else {
				const raw = Buffer.from(observed.stdout, "base64");
				try {
					result.metadata = parseMetadata(raw.toString("utf8"));
					result.status = "AVAILABLE";
				} catch {
					result.status = "UNAVAILABLE_METADATA";
				}
			}
		}
		assertCurrent();
		require(mono() <=
			began + 2, "Engine baseline end-to-end deadline exceeded");
		result.ended = mono();
		save(path.join(directory, "result.json"), result);
		require(mono() <=
			began +
				2, "Engine baseline publication exceeded its end-to-end deadline");
		return {
			status: result.status,
			attempts: result.attempts,
			elapsedMs: (mono() - began) * 1000,
			contract: version,
			backendContainerCalls: 0,
			reference: path.join(directory, "result.json"),
		};
	} catch (error) {
		result = {
			...result,
			status: "UNRESOLVED",
			error: error.message,
			ended: mono(),
		};
		save(path.join(directory, "result.json"), result);
		throw error;
	}
}

function localEndpoint() {
	if (
		[
			"DOCKER_CONTEXT",
			"DOCKER_TLS",
			"DOCKER_TLS_VERIFY",
			"DOCKER_CERT_PATH",
			"DOCKER_CUSTOM_HEADERS",
			"DOCKER_API_VERSION",
		].some((name) => process.env[name])
	)
		return null;
	const source =
		process.env.WALLPAPERDB_DOCKER_SOURCE_CONFIG ??
		process.env.DOCKER_CONFIG ??
		path.join(os.homedir(), ".docker");
	let config = {};
	try {
		if (fs.existsSync(path.join(source, "config.json")))
			config = JSON.parse(regular(path.join(source, "config.json")));
	} catch {
		return null;
	}
	if (
		!config ||
		typeof config !== "object" ||
		Array.isArray(config) ||
		Object.keys(config).some(
			(name) =>
				!["auths", "currentContext", "cliPluginsExtraDirs"].includes(name),
		) ||
		(config.currentContext && config.currentContext !== "default")
	)
		return null;
	const host = process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock";
	if (!host.startsWith("unix:///")) return null;
	const socket = host.slice("unix://".length);
	try {
		const s = fs.lstatSync(socket);
		if (
			!s.isSocket() ||
			s.uid !== process.getuid() ||
			fs.realpathSync(socket) !== socket
		)
			return null;
		return host;
	} catch {
		return null;
	}
}

async function workerRead(owner, expectedHelper) {
	const workerBegan = performance.now();
	require(JSON.stringify(helperPin()) ===
		JSON.stringify(expectedHelper), "Engine baseline worker helper changed");
	require(process.env.WALLPAPERDB_BOAT_WORKER ===
		"1", "Engine baseline requires owned worker execution");
	const endpoint = localEndpoint();
	if (!endpoint) return { owner, closed: true, status: "UNAVAILABLE_ENDPOINT" };
	const privateDirectory = path.join(process.cwd(), ".boat");
	fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
	const privateIdentity = fs.lstatSync(privateDirectory);
	require(privateIdentity.isDirectory() &&
		!privateIdentity.isSymbolicLink() &&
		privateIdentity.uid ===
			process.getuid(), "Engine baseline worker evidence ownership differs");
	const temporary = fs.mkdtempSync(
		path.join(privateDirectory, "engine-version-"),
	);
	fs.chmodSync(temporary, 0o700);
	const acquired = fs.lstatSync(temporary);
	const removeTemporary = () => {
		const current = fs.lstatSync(temporary);
		require(current.isDirectory() &&
			!current.isSymbolicLink() &&
			current.dev === acquired.dev &&
			current.ino === acquired.ino &&
			current.uid ===
				acquired.uid, "Engine baseline temporary ownership changed");
		fs.rmSync(temporary, { recursive: true });
	};
	fs.writeFileSync(
		path.join(temporary, "config.json"),
		'{"auths":{},"currentContext":"default"}\n',
		{ mode: 0o600 },
	);
	const env = {
		...process.env,
		DOCKER_HOST: endpoint,
		DOCKER_CONFIG: temporary,
		WALLPAPERDB_DOCKER_SOURCE_CONFIG: temporary,
	};
	for (const name of [
		"DOCKER_CONTEXT",
		"DOCKER_API_VERSION",
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"ALL_PROXY",
		"http_proxy",
		"https_proxy",
		"all_proxy",
	])
		delete env[name];
	// Earlier worker-local containment only. The coordinator's original two-second
	// clock includes SSH acquisition and remains the sole acceptance deadline.
	// No worker monotonic value is compared with that coordinator clock.
	if (performance.now() >= workerBegan + 750) {
		removeTemporary();
		return { owner, closed: true, status: "NO_BUDGET" };
	}
	const child = spawn("mise", ["exec", "--", ...makeArgv], {
		detached: true,
		env: independentMakeEnvironment(env),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let ownership,
		cancelled = false;
	const phase = {
		phase: "engine-version",
		deadline: workerBegan + 1000,
		disposalMs: 250,
		record: (r) => {
			ownership = r;
		},
	};
	const cancel = () => {
		cancelled = true;
		phase.deadline = Math.min(phase.deadline, performance.now() + 250);
	};
	for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
		process.on(signal, cancel);
	const streams = { stdout: [], stderr: [] },
		sizes = { stdout: 0, stderr: 0 };
	for (const name of ["stdout", "stderr"])
		child[name].on("data", (b) => {
			sizes[name] += b.length;
			if (sizes[name] > 32768) cancel();
			else streams[name].push(b);
		});
	let failure = null;
	try {
		await finiteShutdownProcess(child, phase);
	} catch (error) {
		failure = error.message;
	} finally {
		for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
			process.off(signal, cancel);
		removeTemporary();
	}
	return {
		owner,
		closed: true,
		status: "OBSERVED",
		child: ownership,
		failure,
		cancelled,
		overflow: Object.values(sizes).some((size) => size > 32768),
		workerContainment: {
			executionMs: 750,
			disposalMs: 250,
			elapsedMs: performance.now() - workerBegan,
		},
		stdout: Buffer.concat(streams.stdout).toString("base64"),
		stderr: Buffer.concat(streams.stderr).toString("base64"),
	};
}

if (
	process.argv[1] === fileURLToPath(import.meta.url) &&
	process.argv[2] === "--worker"
) {
	workerRead(JSON.parse(process.argv[3]), JSON.parse(process.argv[4])).then(
		(r) => console.log(frame + JSON.stringify(r)),
		(error) => {
			console.error(error.message);
			process.exitCode = 1;
		},
	);
}
