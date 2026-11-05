// Extracted from the qualified #557 capture. Ownership/retirement stays in boat-shutdown.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { finiteShutdownProcess } from "./boat-shutdown.mjs";
const mono = () => Number(process.hrtime.bigint()) / 1e9;
const sha = (b) => createHash("sha256").update(b).digest("hex");
export function independentMakeEnvironment(source = process.env) {
	const env = { ...(source ?? process.env), MAKELEVEL: "0" };
	for (const name of ["MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS"])
		delete env[name];
	return env;
}
function save(file, value) {
	const fd = fs.openSync(file, "wx", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	const dir = fs.openSync(path.dirname(file), "r");
	try {
		fs.fsyncSync(dir);
	} finally {
		fs.closeSync(dir);
	}
}
function beginCapture({
	argv,
	directory: dir,
	deadline,
	cwd,
	limit = 16777216,
	env = process.env,
	disposalMs = 5000,
	serving = false,
	input = false,
}) {
	if (
		!serving &&
		(!Number.isFinite(deadline) || deadline - mono() <= disposalMs / 1000)
	)
		throw new Error("Insufficient original command deadline");
	fs.mkdirSync(dir, { mode: 0o700 }); // Exclusive phase directory. No overwrite/retry.
	const parent = fs.openSync(path.dirname(dir), "r");
	try {
		fs.fsyncSync(parent);
	} finally {
		fs.closeSync(parent);
	}
	const began = { utc: new Date().toISOString(), monotonic: mono() };
	const streams = {};
	for (const name of ["stdout", "stderr"])
		streams[name] = {
			fd: fs.openSync(path.join(dir, `${name}.raw`), "wx", 0o600),
			bytes: 0,
			overflow: false,
		};
	save(path.join(dir, "invocation.json"), { argv, began, deadline, limit });
	const phase = {
		phase: "547-command",
		deadline: serving
			? Infinity
			: performance.now() + Math.max(0, deadline - mono()) * 1000,
		disposalMs,
		record: (r) => save(path.join(dir, "disposal.json"), r),
	};
	let failure = null,
		spawnError = null,
		terminal = null;
	const integrityFailures = new Set();
	const recordIntegrityFailure = (message) => {
		integrityFailures.add(message);
		failure ??= message;
	};
	const shorten = () => {
		phase.deadline = Math.min(phase.deadline, performance.now() + disposalMs);
	};
	const cancel = () => {
		failure ??= "local interruption";
		shorten();
	};
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, cancel);
	const child = spawn(argv[0], argv.slice(1), {
		detached: true,
		stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
		env,
		cwd,
	});
	child.on("error", (e) => {
		spawnError = e.code ?? "spawn-error";
		shorten();
	});
	child.stdin?.on("error", () => {
		recordIntegrityFailure("stdin transport error");
		shorten();
	});
	child.on("exit", (code, signal) => {
		terminal = { code, signal };
		if (serving && !Number.isFinite(phase.deadline)) {
			// Natural terminal/close may finish normally. Bound only lingering
			// descendants or pipes; do not label natural retirement as cancellation.
			phase.deadline = performance.now() + 30000;
			phase.disposalMs = 5000;
		}
	});
	for (const name of ["stdout", "stderr"]) {
		child[name].on("error", () => {
			recordIntegrityFailure(`${name} transport error`);
			shorten();
		});
		child[name].on("data", (b) => {
			const s = streams[name],
				keep = Math.min(b.length, Math.max(0, limit - s.bytes));
			try {
				let written = 0;
				while (written < keep)
					written += fs.writeSync(s.fd, b, written, keep - written);
				s.bytes += keep; // Bytes are saved before any parsing. No parsing occurs here.
				if (keep < b.length) {
					s.overflow = true;
					failure ??= `${name} overflow`;
					shorten();
				}
			} catch {
				recordIntegrityFailure(`${name} capture write failed`);
				shorten();
			}
		});
	}
	const completion = (async () => {
		try {
			await finiteShutdownProcess(child, phase);
		} catch (e) {
			if (e.message === `Shutdown ${phase.phase}: deadline exceeded`)
				failure ??= e.message;
			else recordIntegrityFailure(e.message);
		} finally {
			for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
				process.off(sig, cancel);
			for (const s of Object.values(streams)) {
				try {
					fs.fsyncSync(s.fd);
				} catch {
					recordIntegrityFailure("capture fsync failed");
				}
				try {
					fs.closeSync(s.fd);
				} catch {
					recordIntegrityFailure("capture close failed");
				}
			}
		}
		const files = {};
		for (const name of ["stdout", "stderr"]) {
			const data = fs.readFileSync(path.join(dir, `${name}.raw`));
			files[name] = {
				bytes: data.length,
				sha256: sha(data),
				overflow: streams[name].overflow,
			};
		}
		const receipt = {
			argv,
			began,
			ended: { utc: new Date().toISOString(), monotonic: mono() },
			deadline,
			byteLimitPerStream: limit,
			terminal,
			spawnError,
			failure,
			integrityFailures: [...integrityFailures],
			files,
			captureComplete: !failure && !spawnError,
		};
		save(path.join(dir, "receipt.json"), receipt);
		return receipt;
	})();
	return {
		pid: child.pid,
		checkpointDirectory: dir,
		completion,
		writeInput(value) {
			if (!child.stdin) throw new Error("Capture input is not enabled");
			child.stdin.write(value);
		},
		stop: () => {
			shorten();
			return completion;
		},
		assertRunning() {
			if (failure || spawnError || terminal)
				throw new Error(
					`Serving Make capture ended: ${failure ?? spawnError ?? JSON.stringify(terminal)}`,
				);
		},
		checkpoint() {
			this.assertRunning();
			const checkpoint = {
				argv,
				pid: child.pid,
				began,
				directory: dir,
				files: Object.fromEntries(
					Object.entries(streams).map(([name, stream]) => {
						fs.fsyncSync(stream.fd);
						const bytes = fs.readFileSync(path.join(dir, `${name}.raw`));
						const snapshot = path.join(dir, `${name}.ready.raw`);
						const fd = fs.openSync(snapshot, "wx", 0o600);
						try {
							fs.writeFileSync(fd, bytes);
							fs.fsyncSync(fd);
						} finally {
							fs.closeSync(fd);
						}
						return [
							name,
							{ path: snapshot, bytes: bytes.length, sha256: sha(bytes) },
						];
					}),
				),
			};
			const fd = fs.openSync(dir, "r");
			try {
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			return checkpoint;
		},
	};
}

export async function captureCommand(options) {
	return beginCapture(options).completion;
}

// A healthy serving command has no lifetime deadline. Its ordinary signal
// handler gets its full cooperative disposal window before transport escalation.
export function captureServingCommand(options) {
	return beginCapture({
		...options,
		deadline: null,
		limit: Infinity,
		disposalMs: 30000,
		serving: true,
	});
}
