// Source generators only. These receipts cannot authorize Asset DATABASE jobs.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const timestamp = (value) =>
	typeof value === "string" && Number.isFinite(Date.parse(value));
const exitCode = (value) =>
	Number.isInteger(value) && value >= 0 && value <= 255;
const history = (value) =>
	value === undefined ||
	(typeof value === "string" && /^cmd_[a-z0-9]+$/.test(value));
function safeMetadata(value, workerId) {
	return (
		object(value) &&
		[
			"launcherFailed",
			"timedOut",
			"oomKilled",
			"stdoutTruncated",
			"stderrTruncated",
			"truncated",
		].every((key) => !Object.hasOwn(value, key) || value[key] === false) &&
		(!Object.hasOwn(value, "known") || value.known === true) &&
		(!Object.hasOwn(value, "ok") || value.ok === true) &&
		["workerId", "sandboxId"].every(
			(key) => !Object.hasOwn(value, key) || value[key] === workerId,
		)
	);
}
function startValid(record) {
	const s = record.start;
	return (
		safeMetadata(s, record.workerId) &&
		s.success === true &&
		(!Object.hasOwn(s, "type") || s.type === "command.started") &&
		positive(s.processId) &&
		positive(s.pid) &&
		typeof s.command === "string" &&
		s.command.length > 0 &&
		timestamp(s.startedAt) &&
		history(s.commandId)
	);
}
function identity(record, value) {
	const start = record.start;
	return (
		safeMetadata(value, record.workerId) &&
		["processId", "pid", "command", "startedAt", "commandId", "cwd"].every(
			(key) =>
				!Object.hasOwn(value, key) ||
				(Object.hasOwn(start, key) && value[key] === start[key]),
		)
	);
}
function transportComplete(phase, code) {
	return (
		phase?.closed === true &&
		phase.localExit?.code === code &&
		phase.localExit.signal === null &&
		phase.localExit.error === undefined &&
		phase.complete === true &&
		phase.overflow === false
	);
}
export function provenOwnedSourceExit(record) {
	if (
		record?.protocol !== "detached-source-v1" ||
		record.protocolError !== false ||
		!record.workerId ||
		!object(record.offsets) ||
		!object(record.phases) ||
		![record.offsets.stdout, record.offsets.stderr].every(
			(value) => Number.isSafeInteger(value) && value >= 0,
		) ||
		!["lock", "migrations"].includes(record.kind) ||
		!startValid(record)
	)
		return false;
	const s = record.status,
		t = record.terminal,
		a = record.attached;
	return (
		identity(record, a) &&
		a?.type === "attached" &&
		a.processId === record.start.processId &&
		a.stdoutOffset === 0 &&
		a.stderrOffset === 0 &&
		identity(record, t) &&
		t.type === "exit" &&
		t.status === "exited" &&
		exitCode(t.exitCode) &&
		t.signal === null &&
		t.stdoutOffset === record.offsets.stdout &&
		t.stderrOffset === record.offsets.stderr &&
		identity(record, s) &&
		s.success === true &&
		(!Object.hasOwn(s, "type") || s.type === "command.status") &&
		s.processId === record.start.processId &&
		s.command === record.start.command &&
		s.startedAt === record.start.startedAt &&
		s.known === true &&
		s.running === false &&
		s.status === "exited" &&
		s.exitCode === t.exitCode &&
		s.signal === null &&
		s.oomKilled === false &&
		timestamp(s.finishedAt) &&
		Date.parse(s.finishedAt) >= Date.parse(record.start.startedAt) &&
		typeof s.stdout === "string" &&
		typeof s.stderr === "string" &&
		transportComplete(record.phases.start, 0) &&
		transportComplete(record.phases.attach, t.exitCode) &&
		transportComplete(record.phases.status, 0)
	);
}

// 64 MiB covers the existing 8 MiB decoded allowance even with JSON escaping
// and base64 expansion. A retained prefix on overflow is diagnostic, never proof.
const rawLimits = { stdout: 64 * 1024 * 1024, stderr: 8 * 1024 * 1024 };
const decodedLimit = 8 * 1024 * 1024;
function observation(directory, phase, argv, artifact, persistOwnership) {
	const meta = {
		argv,
		artifact,
		rawLimits,
		decodedLimit,
		complete: false,
		overflow: false,
		closed: false,
		events: [],
		streams: {},
	};
	const hashes = {},
		counts = {};
	for (const stream of [
		"stdout",
		"stderr",
		"decoded-stdout",
		"decoded-stderr",
		"decoded-cli-stderr",
	]) {
		fs.writeFileSync(path.join(directory, `${phase}.${stream}`), "", {
			flag: "wx",
			mode: 0o600,
		});
		hashes[stream] = createHash("sha256");
		counts[stream] = { bytes: 0, observedBytes: 0 };
	}
	const save = () =>
		fs.writeFileSync(
			path.join(directory, `${phase}.json`),
			JSON.stringify(meta, null, 2),
			{ mode: 0o600 },
		);
	const fail = () => {
		meta.complete = false;
		return false;
	};
	const retain = (stream, data, limit) => {
		const bytes = Buffer.from(data),
			count = counts[stream];
		count.observedBytes += bytes.length;
		const kept = bytes.subarray(0, Math.max(0, limit - count.bytes));
		try {
			fs.appendFileSync(path.join(directory, `${phase}.${stream}`), kept);
			hashes[stream].update(kept);
			count.bytes += kept.length;
		} catch {
			meta.ioError = true;
			return fail();
		}
		if (kept.length !== bytes.length) {
			meta.overflow = true;
			return fail();
		}
		return true;
	};
	let decoded = 0;
	const retainDecoded = (stream, data) => {
		const remaining = Math.max(0, decodedLimit - decoded);
		decoded += Buffer.byteLength(data);
		const retained = retain(stream, data, counts[stream].bytes + remaining);
		if (decoded > decodedLimit) meta.overflow = true;
		return retained && !meta.overflow;
	};
	const hook = {
		ownership: (receipt) => {
			meta.localOwnership = receipt;
			save();
			persistOwnership();
		},
		raw: (stream, bytes) => retain(stream, bytes, rawLimits[stream]),
		output: (data, stderr) =>
			retainDecoded(stderr ? "decoded-stderr" : "decoded-stdout", data),
		localStderr: (data) => retainDecoded("decoded-cli-stderr", data),
		localStderrFailure: (reason) => {
			meta.localStderrError = reason;
		},
		malformed: () => {
			meta.malformed = true;
		},
		frame: (frame) => {
			if (meta.events.length >= 65536) {
				meta.overflow = true;
				return false;
			}
			meta.events.push(typeof frame?.type === "string" ? frame.type : null);
			return true;
		},
		close: ({ code, signal, error }) => {
			meta.closed = true;
			meta.localExit = {
				code,
				signal,
				...(error ? { error: String(error.code ?? "transport_error") } : {}),
			};
		},
	};
	save();
	return {
		hook,
		meta,
		finish: () => {
			for (const [stream, count] of Object.entries(counts))
				meta.streams[stream] = {
					...count,
					sha256: hashes[stream].digest("hex"),
				};
			// Close and sync every bounded artifact before durable ownership can
			// claim a complete receipt. No descriptor survives this observation.
			try {
				for (const stream of Object.keys(counts)) {
					const fd = fs.openSync(
						path.join(directory, `${phase}.${stream}`),
						"r",
					);
					try {
						fs.fsyncSync(fd);
					} finally {
						fs.closeSync(fd);
					}
				}
			} catch {
				meta.ioError = true;
			}
			meta.complete =
				meta.closed &&
				!meta.overflow &&
				!meta.malformed &&
				!meta.localStderrError &&
				!meta.ioError &&
				(!meta.localOwnership ||
					(meta.localOwnership.stage === "finished" &&
						meta.localOwnership.retired === true &&
						!meta.localOwnership.failure));
			save();
			for (const file of [path.join(directory, `${phase}.json`), directory]) {
				const fd = fs.openSync(file, "r");
				try {
					fs.fsyncSync(fd);
				} finally {
					fs.closeSync(fd);
				}
			}
		},
	};
}

export async function runOwnedSourceCommand({
	workerId,
	kind,
	command,
	execute,
	cli,
	directory,
	persist,
}) {
	fs.mkdirSync(directory, { mode: 0o700 });
	const sha256 = digest(fs.readFileSync(cli));
	const artifact = {
		sha256,
		version:
			sha256 ===
			"5d7933a238dcea0446bbbee0e2506692961d16537b9960003e4ece9ecb1ec498"
				? "1.0.85"
				: null,
	};
	const record = {
		protocol: "detached-source-v1",
		workerId,
		kind,
		startedAt: new Date().toISOString(),
		commandId: null,
		start: null,
		attached: null,
		terminal: null,
		status: null,
		offsets: { stdout: 0, stderr: 0 },
		protocolError: false,
		phases: {},
	};
	const checkpoint = () => persist(record);
	// This write is durable before the single detached submission, even if its ack is lost.
	checkpoint();
	async function phase(name, args, stream = false, onFrame = () => {}) {
		const argv = ["--no-update", "--json", "exec", workerId, ...args];
		const observed = observation(directory, name, argv, artifact, checkpoint);
		record.phases[name] = observed.meta;
		checkpoint();
		try {
			if (digest(fs.readFileSync(cli)) !== sha256)
				throw new Error("Source CLI artifact changed");
			return await execute(cli, argv, {
				allowFailure: true,
				capture: !stream,
				streamFrames: stream,
				collectOutput: stream,
				maxCaptureBytes: rawLimits.stdout,
				sourceObservation: observed.hook,
				onFrame: (frame) => {
					if (!observed.hook.frame(frame)) record.protocolError = true;
					else onFrame(frame);
					if (record.protocolError) checkpoint();
					return !record.protocolError;
				},
			});
		} finally {
			observed.finish();
			checkpoint();
		}
	}
	try {
		const started = await phase("start", [
			"--detach",
			"--",
			"bash",
			"-lc",
			command,
		]);
		record.start = JSON.parse(started.out);
		if (!startValid(record) || !transportComplete(record.phases.start, 0))
			throw new Error("Incomplete source start");
		record.commandId = record.start.commandId ?? null;
		// The complete actual response and owned process identity precede every follow-up.
		checkpoint();
		const processId = String(record.start.processId);
		const attached = await phase(
			"attach",
			["--attach", processId],
			true,
			(frame) => {
				if (!object(frame) || !identity(record, frame) || record.terminal) {
					record.protocolError = true;
					return;
				}
				if (frame.type === "attached") {
					if (
						frame.processId !== record.start.processId ||
						frame.stdoutOffset !== record.offsets.stdout ||
						frame.stderrOffset !== record.offsets.stderr
					)
						record.protocolError = true;
					// The CLI filters reconnect but forwards each new attached interval.
					// Preserve the first receipt; continuation starts at delivered bytes.
					if (!record.attached) record.attached = frame;
					else record.lastAttached = frame;
					checkpoint();
				} else if (!record.attached) record.protocolError = true;
				else if (frame.type === "stdout" || frame.type === "stderr") {
					if (
						typeof frame.data !== "string" ||
						!Number.isSafeInteger(frame.nextOffset) ||
						frame.nextOffset !==
							record.offsets[frame.type] + Buffer.byteLength(frame.data)
					)
						record.protocolError = true;
					else record.offsets[frame.type] = frame.nextOffset;
				} else if (frame.type === "exit") {
					if (
						frame.status !== "exited" ||
						!exitCode(frame.exitCode) ||
						frame.signal !== null ||
						frame.stdoutOffset !== record.offsets.stdout ||
						frame.stderrOffset !== record.offsets.stderr
					)
						record.protocolError = true;
					record.terminal = frame;
					checkpoint();
				} else record.protocolError = true;
			},
		);
		if (
			record.protocolError ||
			attached.outputOverflow ||
			!record.terminal ||
			!transportComplete(record.phases.attach, record.terminal.exitCode)
		)
			throw new Error("Incomplete source attachment");
		const status = await phase("status", ["--status", processId]);
		record.status = JSON.parse(status.out);
		checkpoint();
		if (!provenOwnedSourceExit(record))
			throw new Error("Incomplete source completion");
		return { ...attached, status: record.terminal.exitCode };
	} catch {
		record.protocolError = true;
		checkpoint();
		throw new Error(
			`Source writer completion is uncertain; source synchronization and generation blocked. Preserve the active worker tree; ownership evidence at ${directory}`,
		);
	}
}
