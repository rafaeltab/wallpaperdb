// Throwaway #557 controller. Only enrolled linked worktrees may create workers.
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
	delta,
	estimate,
	quote,
	parseBoatJson,
	workerState,
	meaningfulPreviewRequest,
	worktreeProcesses,
	liveOwnedProcess,
	forwardPreviewDisconnect,
	developmentWantedAfterCommand,
} from "./lib/boat.mjs";
import {
	shutdownBudget,
	finiteShutdownProcess,
	retireShutdownTunnel,
} from "./lib/boat-shutdown.mjs";
import {
	runPreview,
	forwardPreviewUpgrade,
	retirePreviewConnections,
} from "./lib/boat-preview.mjs";
import {
	freshWorker,
	assertAdmission,
	completedStop,
} from "./lib/boat-reconstruction.mjs";
import { snapshotLifecycle, snapshotExpired } from "./lib/boat-snapshot.mjs";
import { cacheServer } from "./lib/boat-cache.mjs";
import {
	fingerprint,
	projectedInputs,
	installationInputs,
	prepareEnvironment,
} from "./lib/boat-preparation.mjs";

import {
	sourceGeneration,
	generateSource,
	recoverPublication,
} from "./lib/boat-source-generation.mjs";
import {
	assetMigrationSelected,
	captureAssetMigration,
} from "./lib/boat-asset-migration.mjs";

import {
	runOwnedSourceCommand,
	provenOwnedSourceExit,
} from "./lib/boat-source-command.mjs";

const root = process.cwd();
const dir = path.join(root, ".boat");
const configFile = path.join(dir, "enrollment.json");
const stateFile = path.join(dir, "state.json");
const runDir = path.join(os.homedir(), ".local/state/wallpaperdb-boat/557");
const cli = path.join(root, ".mise/boat/boat");
const remote = "/home/user/wallpaperdb";
const workerEnvironment =
	'export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1 PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/ms-playwright"';
const [action, ...args] = process.argv.slice(2);
const read = (p, fallback = {}) =>
	fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
function write(p, value, durable = false) {
	fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
	const tmp = `${p}.${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
	if (durable) {
		const fd = fs.openSync(tmp, "r");
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	}
	fs.renameSync(tmp, p);
	if (durable) {
		const fd = fs.openSync(path.dirname(p), "r");
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	}
}
const config = read(configFile, null);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function event(kind, detail = {}) {
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.appendFileSync(
		path.join(dir, "events.jsonl"),
		`${JSON.stringify({ at: new Date().toISOString(), kind, ...detail })}\n`,
		{ mode: 0o600 },
	);
}
function execute(
	command,
	argv,
	{
		capture = false,
		input,
		allowFailure = false,
		streamFrames = false,
		logPath,
		onOutput = () => {},
		collectOutput = false,
		maxCaptureBytes = Infinity,
		onFrame = () => {},
		shutdown,
		sourceObservation,
	} = {},
) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		if (
			shutdown &&
			performance.now() >= shutdown.deadline - shutdown.disposalMs
		) {
			reject(
				new Error(
					`Shutdown ${shutdown.phase}: deadline exhausted before launch`,
				),
			);
			return;
		}
		const child = spawn(command, argv, {
			cwd: root,
			detached: !!shutdown || !!sourceObservation,
			env: { ...process.env, BOAT_NO_UPDATE: "1" },
			stdio: [
				shutdown ? "pipe" : input === undefined ? "inherit" : "pipe",
				capture || streamFrames || shutdown ? "pipe" : "inherit",
				capture || streamFrames || shutdown ? "pipe" : "inherit",
			],
		});
		let sourceAborted = false,
			sourceError;
		// The source CLI has unlimited healthy duration. Its already-selected
		// failure allowance is TERM now, KILL at 1000ms, final disposal at 2000ms.
		const sourcePhase = sourceObservation && {
			phase: "source-transport",
			deadline: Infinity,
			disposalMs: 2000,
			sourceScope: { cwd: root },
			record: (receipt) => sourceObservation.ownership(receipt),
		};
		const abortSource = () => {
			if (sourceAborted) return;
			sourceAborted = true;
			sourceError ??= { code: "source_capture_aborted" };
			sourcePhase.deadline = Math.min(
				sourcePhase.deadline,
				performance.now() + 2000,
			);
		};
		if (sourceObservation) {
			// Observe actual CLI bytes before JSON parsing or decoded projection.
			for (const stream of ["stdout", "stderr"])
				child[stream].on("data", (bytes) => {
					if (!sourceObservation.raw(stream, bytes)) {
						abortSource();
					}
				});
			child.on("error", (error) => {
				sourceError = error;
				abortSource();
			});
			// Only actual close establishes pipe closure, including failed disposal.
			child.on("close", (code, signal) =>
				sourceObservation.close({ code, signal, error: sourceError }),
			);
		}
		let out = "",
			err = "",
			decoded = "",
			outputOverflow = false,
			captureOverflow = false;
		const finite =
			(shutdown || sourcePhase) &&
			finiteShutdownProcess(child, shutdown || sourcePhase);
		let forwarded = 0,
			forwardingOverflow = false;
		if (shutdown && !capture && !streamFrames) {
			const forward = (stream, bytes) => {
				forwarded += bytes.length;
				if (forwarded > 1024 * 1024) forwardingOverflow = true;
				if (!forwardingOverflow && !stream.destroyed) stream.write(bytes);
			};
			child.stdout.on("data", (b) => forward(process.stdout, b));
			child.stderr.on("data", (b) => forward(process.stderr, b));
		}
		if (capture) {
			const decoder = sourceObservation
				? new TextDecoder("utf-8", { fatal: true })
				: null;
			child.stdout.on("data", (b) => {
				if (
					Buffer.byteLength(out) + b.length >
					Math.min(maxCaptureBytes, shutdown ? 1024 * 1024 : Infinity)
				) {
					captureOverflow = true;
					if (sourceObservation) abortSource();
					else child.kill("SIGTERM");
				} else {
					try {
						out += decoder ? decoder.decode(b, { stream: true }) : b;
					} catch {
						sourceObservation.malformed();
						abortSource();
					}
				}
			});
			if (decoder)
				child.stdout.on("end", () => {
					try {
						out += decoder.decode();
					} catch {
						sourceObservation.malformed();
						abortSource();
					}
				});
			child.stderr.on("data", (b) => {
				if (!sourceObservation) err = (err + b).slice(shutdown ? -1000 : 0);
			});
		}
		if (streamFrames) {
			let pending = "";
			const emit = (data, stderr = false) => {
				if (sourceObservation && !sourceObservation.output(data, stderr)) {
					abortSource();
					return;
				}
				if (collectOutput) {
					decoded += data;
					if (Buffer.byteLength(decoded) > 8 * 1024 * 1024) {
						outputOverflow = true;
						decoded = decoded.slice(-1024 * 1024);
					}
				}
				onOutput(data);
				(stderr ? process.stderr : process.stdout).write(data);
				if (logPath) fs.appendFileSync(logPath, data, { mode: 0o600 });
				for (const phase of [
					"building",
					"exporting",
					"unpacking",
					"extracting",
					"loading",
					"healthy",
					"started",
					"watch enabled",
				]) {
					if (data.toLowerCase().includes(phase))
						event("startup-progress", { phase, elapsedMs: Date.now() - start });
				}
			};
			const decoder = sourceObservation
				? new TextDecoder("utf-8", { fatal: true })
				: null;
			const line = (value) => {
				try {
					const frame = JSON.parse(value);
					const accepted = onFrame(frame);
					if (sourceObservation && accepted === false) {
						abortSource();
						return;
					}
					if (frame.type === "stdout" || frame.type === "stderr")
						emit(frame.data, frame.type === "stderr");
					else if (frame.event === "error") emit(`${frame.error}\n`, true);
				} catch {
					if (sourceObservation) {
						sourceObservation.malformed();
						abortSource();
					} else emit(`${value}\n`);
				}
			};
			child.stdout.on("data", (bytes) => {
				if (sourceAborted) return;
				try {
					pending += decoder ? decoder.decode(bytes, { stream: true }) : bytes;
				} catch {
					sourceObservation.malformed();
					abortSource();
					return;
				}
				let at = pending.indexOf("\n");
				while (at >= 0 && !sourceAborted) {
					line(pending.slice(0, at));
					pending = pending.slice(at + 1);
					at = pending.indexOf("\n");
				}
			});
			child.stdout.on("end", () => {
				if (decoder && !sourceAborted) {
					try {
						pending += decoder.decode();
					} catch {
						sourceObservation.malformed();
						abortSource();
					}
				}
				if (pending && !sourceAborted) line(pending);
			});
			if (!sourceObservation)
				child.stderr.on("data", (bytes) => emit(bytes, true));
		}
		if (sourceObservation) {
			// Local CLI diagnostics are not remote stderr frames or generator output.
			// Decode physical stderr independently so split/invalid UTF-8 cannot
			// escape the same bounded source failure disposal.
			const decoder = new TextDecoder("utf-8", { fatal: true });
			const diagnostic = (bytes, end = false) => {
				if (sourceAborted) return;
				let data;
				try {
					data = decoder.decode(bytes, { stream: !end });
				} catch {
					sourceObservation.localStderrFailure("invalid_utf8");
					abortSource();
					return;
				}
				try {
					if (!sourceObservation.localStderr(data)) {
						abortSource();
						return;
					}
					if (data) process.stderr.write(data);
				} catch {
					sourceObservation.localStderrFailure("callback_failed");
					abortSource();
				}
			};
			child.stderr.on("data", (bytes) => diagnostic(bytes));
			child.stderr.on("end", () => diagnostic(undefined, true));
		}
		if (input !== undefined || shutdown) {
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		}
		if (!shutdown && !sourceObservation) child.on("error", reject);
		const complete = (code, signal) => {
			const status = code ?? (signal === "SIGINT" ? 130 : 143);
			if (captureOverflow || forwardingOverflow) {
				reject(new Error("Captured transport output limit exceeded"));
				return;
			}
			if (status && !allowFailure) {
				let code;
				try {
					code = JSON.parse(out.trim().split("\n").at(-1)).code;
				} catch {}
				const error = new Error(
					`${path.basename(command)} failed (${status}); ${shutdown ? (typeof code === "string" && /^[a-z_]{1,80}$/.test(code) ? code : "transport failure") : (code ?? (capture ? err.slice(-1000) : "see command output"))}`,
				);
				error.code = code;
				reject(error);
			} else
				resolve({
					status,
					out,
					output: decoded,
					outputOverflow,
					ms: Date.now() - start,
				});
		};
		if (finite)
			finite.then(({ code, signal }) => complete(code, signal), reject);
		else child.on("close", complete);
	});
}
const boat = async (argv, opts = {}) =>
	execute(cli, ["--no-update", ...argv], opts);
const json = async (argv, opts = {}) => {
	const result = await boat(["--json", ...argv], { ...opts, capture: true });
	if (!opts.shutdown) return parseBoatJson(result.out);
	try {
		return parseBoatJson(result.out);
	} catch {
		throw new Error(
			`Shutdown ${opts.shutdown.phase}: invalid metadata response`,
		);
	}
};
const ssh = (id, command, opts = {}) =>
	boat(["ssh", id, "--", "bash", "-lc", command], opts);
const retireWatchers = async (id, opts = {}) => {
	const results = await Promise.allSettled([
		retirePreviewConnections(root, id, opts.shutdown),
		ssh(
			id,
			`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && sudo -n "$(mise which node)" --input-type=module -`,
			{ ...opts, input: fs.readFileSync("scripts/boat-stop-watch.mjs") },
		),
	]);
	const failures = results.filter((r) => r.status === "rejected");
	if (failures.length)
		throw new Error(failures.map((r) => r.reason.message).join("; "));
};

function owned() {
	if (!config || config.root !== root)
		throw new Error("This worktree is not enrolled");
}
async function lock(
	fn,
	name = "lifecycle",
	deadline = Infinity,
	shutdown,
	contended,
) {
	const lockDir = path.join(dir, `${name}.lock`);
	for (let attempt = 0; ; attempt++) {
		if (shutdown && performance.now() >= shutdown.deadline)
			throw new Error("Shutdown lock: deadline exceeded; no remote effects");
		if (Date.now() >= deadline)
			throw new Error(
				"Asset migration command allowance exhausted while awaiting source ownership; no launch",
			);
		try {
			fs.mkdirSync(lockDir);
			fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid));
			break;
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
			let pid;
			try {
				pid = Number(fs.readFileSync(path.join(lockDir, "pid"), "utf8"));
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				if (attempt > 600) throw new Error("Lifecycle lock timed out");
				// mkdir/pid publication and owner release are separate filesystem steps.
				// Missing publication never authorizes removing another owner's lock.
				await wait(
					Math.max(
						1,
						Math.min(
							500,
							deadline - Date.now(),
							shutdown ? shutdown.deadline - performance.now() : Infinity,
						),
					),
				);
				continue;
			}
			try {
				process.kill(pid, 0);
			} catch {
				fs.rmSync(lockDir, { recursive: true, force: true });
				continue;
			}
			const selection = contended?.(pid);
			if (selection !== undefined) return selection;
			if (attempt > 600) throw new Error("Lifecycle lock timed out");
			await wait(
				Math.max(
					1,
					Math.min(
						500,
						deadline - Date.now(),
						shutdown ? shutdown.deadline - performance.now() : Infinity,
					),
				),
			);
		}
	}
	try {
		return await fn();
	} finally {
		fs.rmSync(lockDir, { recursive: true, force: true });
	}
}

// Only the live command holding both locks can lend its selected identity to
// TTL maintenance. This does not grant permission to synchronize source.
function preparationOwner(pid) {
	const lease = read(path.join(dir, `command-${pid}.json`));
	const state = read(stateFile);
	if (
		lease.pid !== pid ||
		!liveOwnedProcess(root, lease) ||
		lease.preparation?.worker !== state.id ||
		lease.preparation?.admission !== state.admission?.token ||
		!state.runningSince ||
		state.snapshotRecovery?.status !== "ACTIVE"
	)
		return;
	try {
		for (const name of ["lifecycle", "source"])
			if (
				Number(fs.readFileSync(path.join(dir, `${name}.lock/pid`), "utf8")) !==
				pid
			)
				return;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		return;
	}
	return { worker: state.id, preparationPid: pid };
}
function accounting() {
	let dollars = 0;
	for (const name of fs.existsSync(runDir) ? fs.readdirSync(runDir) : []) {
		if (!name.endsWith(".worker.json")) continue;
		const s = read(path.join(runDir, name));
		dollars += s.cost ?? 0;
		if (s.admission?.status !== "published") dollars += s.admission?.cost ?? 0;
		if (s.admission?.status !== "published" && s.admission?.runningSince)
			dollars += estimate(
				s.admission.size,
				Date.now() - s.admission.runningSince,
			);
		if (s.runningSince)
			dollars += estimate(s.size, Date.now() - s.runningSince);
	}
	return dollars;
}
function save(state, durable = false) {
	if (durable)
		write(path.join(runDir, `${config.key}.worker.json`), state, true);
	write(stateFile, state, durable);
	if (!durable) write(path.join(runDir, `${config.key}.worker.json`), state);
}
const snapshots = snapshotLifecycle({
	load: () => read(stateFile),
	persist: save,
});
function admit() {
	if (accounting() >= 9.9)
		throw new Error(
			"Protective $10 usage cutoff: no new work admitted; stop experiment workers.",
		);
}
async function ensure() {
	return lock(async () => {
		admit();
		if (config.lifecycle === "fresh-after-stop") {
			const s = await lock(
				() =>
					freshWorker({
						root,
						config,
						load: () => read(stateFile),
						persist: (s) => save(s, true),
						json,
						admit,
						snapshots,
						preflight: () => {
							assertSourceWriterStopped();
							recoverPublication(root, acceptSource);
						},
					}),
				"source",
			);
			await bootstrap(s.id);
			return { id: s.id, resumed: false };
		}
		let s = read(stateFile);
		let existingInfo;
		if (s.id) {
			let inspectionError;
			try {
				existingInfo = await json(["info", s.id]);
			} catch (error) {
				if (error.code !== "not_found") throw error;
				inspectionError = error;
			}
			const priorId = s.id;
			s = snapshots.inspectIdentity({
				info: existingInfo,
				error: inspectionError,
			});
			if (!s.id) {
				event(inspectionError ? "lost-worker" : "expired", { id: priorId });
				existingInfo = undefined;
				for (const name of ["prepared.json", "manifest.json"])
					fs.rmSync(path.join(dir, name), { force: true });
			}
		}
		if (!s.id) {
			s = snapshots.startup();
			const name = `wallpaperdb-557-${config.cohort}-${config.key}`;
			const listed = await json(["list", "--all"]);
			const matches = listed.sandboxes.filter(
				(worker) =>
					worker.name === name &&
					!snapshotExpired(worker) &&
					worker.state !== "deleted",
			);
			if (matches.length > 1)
				throw new Error(
					"Multiple owned workers found; inspect and clean up before admitting work",
				);
			if (matches.length === 1) {
				const worker = matches[0];
				s = {
					...s,
					id: worker.id,
					size: worker.type,
					cost: s.cost ?? 0,
					runningSince: ["archived", "stopped"].includes(worker.state)
						? null
						: Date.parse(worker.createdAt),
					lastActivity: Date.now(),
				};
				save(s);
				event("recovered-identity", { id: s.id });
			}
		}
		if (s.id) {
			const info = existingInfo ?? (await json(["info", s.id]));
			const status = workerState(info);
			s = snapshots.startup(info);
			if (!["ready", "running", "idle"].includes(status))
				throw new Error(
					`Worker ${s.id} has state ${status}; inspect before recovery.`,
				);
		}
		if (!s.id) {
			admit();
			const limits = await json(["limits"]);
			if (!limits.canStart || limits.nextStartDollars > 0)
				throw new Error(
					"Worker admission refused: starts unavailable or paid bursting required",
				);
			const created = await json([
				"new",
				"--type",
				config.size,
				"--ttl",
				"2100",
				"--no-env",
				"--name",
				`wallpaperdb-557-${config.cohort}-${config.key}`,
			]);
			const id = created.sandbox?.id ?? created.id;
			if (!id)
				throw new Error(
					"Create returned no worker ID; inspect Boat list before retrying",
				);
			s = {
				...s,
				id,
				size: config.size,
				cost: s.cost ?? 0,
				runningSince: Date.now(),
				lastActivity: Date.now(),
			};
			if (s.developmentWanted) s.reconciliationPending = true;
			save(s);
			event("created", { id });
		}
		s = snapshots.startup();
		s.lastActivity = Date.now();
		save(s);
		await bootstrap(s.id);
		return { id: s.id, resumed: false };
	});
}
async function bootstrap(id) {
	await ssh(
		id,
		`mkdir -p ${remote}; command -v mise >/dev/null || (curl -fsSL https://mise.run | sh); test -d ${remote}/.git || (git init ${remote} && cd ${remote} && git remote add origin https://github.com/rafaeltab/wallpaperdb.git && git fetch --depth=1 origin ${quote(config.base)} && git checkout --detach FETCH_HEAD)`,
	);
}
function sourceNames() {
	const files = execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root },
	)
		.toString()
		.split("\0")
		.filter(Boolean);
	return files.filter((name) => {
		if (name.startsWith(".boat/") || name.startsWith(".mise/")) return false;
		try {
			fs.lstatSync(path.join(root, name));
			return true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			return false;
		}
	});
}
function manifest() {
	const files = sourceNames();
	const result = {};
	for (const p of files) {
		if (p.startsWith(".boat/") || p.startsWith(".mise/")) continue;
		try {
			const stat = fs.lstatSync(p);
			if (stat.isSymbolicLink()) result[p] = hash(fs.readlinkSync(p));
			else if (stat.isFile()) result[p] = hash(fs.readFileSync(p));
		} catch (e) {
			if (e.code !== "ENOENT") throw e;
		}
	}
	return result;
}
function startupWorker(id) {
	if (read(stateFile).id !== id)
		throw new Error(
			"Worker generation changed; no source synchronization or generation permitted",
		);
	return snapshots.startup();
}
async function syncOwned(id, capture) {
	startupWorker(id);
	assertSourceWriterStopped();
	recoverPublication(root, acceptSource);
	const source = manifest();
	const intended = capture?.(source);
	await syncSource(id, source);
	if (
		capture &&
		JSON.stringify(capture(manifest())) !== JSON.stringify(intended)
	)
		throw new Error(
			"Migration source changed during authoritative flush; no launch",
		);
	return intended;
}
async function sync(id, capture) {
	return lock(() => syncOwned(id, capture), "source");
}
// Caller holds source.lock, including while accepting generated source.
async function syncSource(id, after, sourceRoot = root) {
	const baseline = Object.fromEntries(
		execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", config.base])
			.toString()
			.split("\0")
			.filter(Boolean)
			.map((p) => [p, "baseline"]),
	);
	const before = read(path.join(dir, "manifest.json"), baseline);
	const pending = fs.existsSync(
		path.join(dir, "migration-return-pending.json"),
	);
	if (pending)
		for (const name of Object.keys(after))
			if (name.startsWith("apps/asset/drizzle/")) before[name] = null;
	const modes = {};
	const priorModes = read(path.join(dir, "source-modes.json"));
	for (const name of Object.keys(after)) {
		const stat = fs.lstatSync(path.join(sourceRoot, name));
		modes[name] = stat.isSymbolicLink() ? "link" : stat.mode & 0o777;
		if (priorModes[name] !== modes[name]) before[name] = null;
	}
	const change = delta(before, after);
	if (pending) {
		const marker = path.join(dir, "migration-return-pending.json"),
			record = read(marker);
		if (!record.retained || record.retainedWorkerId !== id) {
			const result = await ssh(
				id,
				`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise exec -- node scripts/lib/boat-source-generation.mjs retain-migrations ${quote(record.id)}`,
				{ capture: true },
			);
			const receipt = JSON.parse(result.out);
			if (
				receipt.id !== record.id ||
				receipt.retained !== `.boat/source-proposals/${record.id}`
			)
				throw new Error(
					"Remote proposal retention not confirmed; restoration blocked",
				);
			write(marker, {
				...record,
				retained: receipt.retained,
				retainedWorkerId: id,
			});
		}
		await ssh(
			id,
			`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise exec -- node scripts/lib/boat-source-generation.mjs prune-migrations`,
			{
				input: JSON.stringify(
					Object.keys(after).filter((name) =>
						name.startsWith("apps/asset/drizzle/"),
					),
				),
			},
		);
	}
	if (change.deleted.length)
		await ssh(
			id,
			`cd ${remote} && rm -f -- ${change.deleted.map(quote).join(" ")}`,
		);
	if (change.changed.length) {
		const tar = execFileSync("tar", ["--null", "-T", "-", "-czf", "-"], {
			cwd: sourceRoot,
			input: `${change.changed.join("\0")}\0`,
			maxBuffer: 256 * 1024 * 1024,
		});
		await ssh(id, `cd ${remote} && tar -xzf - --same-permissions`, {
			input: tar,
		});
		event("sync", {
			changed: change.changed.length,
			deleted: change.deleted.length,
			bytes: tar.length,
		});
	} else if (change.deleted.length)
		event("sync", { changed: 0, deleted: change.deleted.length, bytes: 0 });

	if (pending)
		fs.rmSync(path.join(dir, "migration-return-pending.json"), { force: true });
	write(path.join(dir, "manifest.json"), after);
	write(path.join(dir, "source-modes.json"), modes);
	if (change.changed.length || change.deleted.length) {
		const s = read(stateFile);
		s.lastActivity = Date.now();
		save(s);
	}
}

function acceptSource(outputs, workerId) {
	const migration = Object.hasOwn(
		outputs,
		"apps/asset/drizzle/meta/_journal.json",
	);
	// Local publication survives worker loss. Delivery acknowledgement belongs
	// only to the worker that generated these bytes, with known pending ownership.
	// Legacy intents/markers without ownership must restore through normal sync.
	const pending = read(path.join(dir, "migration-return-pending.json"));
	if (
		typeof workerId !== "string" ||
		workerId !== read(stateFile).id ||
		(migration && pending.workerId !== workerId)
	)
		return;
	write(path.join(dir, "manifest.json"), {
		...read(path.join(dir, "manifest.json")),
		...outputs,
	});
	if (migration)
		fs.rmSync(path.join(dir, "migration-return-pending.json"), { force: true });
	const modes = read(path.join(dir, "source-modes.json"));
	for (const name of Object.keys(outputs))
		modes[name] = fs.lstatSync(path.join(root, name)).mode & 0o777;
	write(path.join(dir, "source-modes.json"), modes);
	event(
		migration ? "migrations-accepted" : "lock-accepted",
		migration ? { outputs } : { hash: outputs["pnpm-lock.yaml"] },
	);
}

function provenSourceExit(record) {
	const terminal = record.terminal;
	return (
		record.protocolError !== true &&
		typeof record.commandId === "string" &&
		/^cmd_[a-z0-9]+$/.test(record.commandId) &&
		terminal?.type === "exit" &&
		Number.isInteger(terminal.exitCode) &&
		terminal.exitCode >= 0 &&
		terminal.exitCode <= 255 &&
		terminal.launcherFailed === false &&
		terminal.timedOut === false &&
		terminal.oomKilled === false &&
		terminal.signal === null &&
		terminal.success === (terminal.exitCode === 0) &&
		typeof terminal.finishedAt === "string" &&
		Number.isFinite(Date.parse(terminal.finishedAt))
	);
}
function assertSourceWriterStopped() {
	const file = path.join(dir, "source-writer.json");
	if (!fs.existsSync(file)) return;
	const record = read(file);
	if (
		!(record.protocol === undefined
			? provenSourceExit(record)
			: record.workerId === read(stateFile).id && provenOwnedSourceExit(record))
	)
		throw new Error(
			`Source writer completion is uncertain; source synchronization and generation blocked. Preserve the active worker tree; ownership evidence at ${file}`,
		);
	fs.rmSync(file);
}

async function runSourceCommand(id, started, kind) {
	const file = path.join(dir, "source-writer.json");
	const evidence = path.join(
		dir,
		`source-command-${started}-${process.pid}.json`,
	);
	const result = await runOwnedSourceCommand({
		workerId: id,
		kind,
		cli,
		execute,
		directory: path.join(dir, `source-command-${started}-${process.pid}`),
		command: `export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1; cd ${remote} && mise exec -- make BOAT_EXEC=worker run ${kind === "lock" ? "PACKAGE=scripts SCRIPT=dependencies:lock" : "PACKAGE=asset SCRIPT=db:generate"}`,
		persist: (record) => {
			write(evidence, record, true);
			write(file, record, true);
		},
	});
	assertSourceWriterStopped();
	return result;
}

async function generate(id, started, kind) {
	return lock(
		() =>
			generateSource({
				kind,
				root,
				stagingRoot: runDir,
				names: sourceNames,
				transport: {
					workerId: id,
					assertStopped: () => {
						startupWorker(id);
						assertSourceWriterStopped();
					},
					sync: (source, snapshot) => syncSource(id, source, snapshot),
					invalidate: (kind, outputs) => {
						const sent = read(path.join(dir, "manifest.json"));
						for (const name of kind === "lock" ? ["pnpm-lock.yaml"] : outputs)
							sent[name] = null;
						write(path.join(dir, "manifest.json"), sent);
						if (kind === "migrations")
							write(path.join(dir, "migration-return-pending.json"), {
								id: randomBytes(12).toString("hex"),
								workerId: id,
							});
					},
					prepare: async (kind) => {
						await ssh(
							id,
							`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise trust && ${kind === "lock" ? "mise install --locked" : "make install BOAT_EXEC=worker"}`,
						);
					},
					generate: (kind) => runSourceCommand(id, started, kind),
					collect: async (kind) =>
						(
							await ssh(
								id,
								kind === "lock"
									? `cd ${remote} && test ! -L pnpm-lock.yaml && test -f pnpm-lock.yaml && base64 -w0 -- pnpm-lock.yaml`
									: `export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise exec -- node scripts/lib/boat-source-generation.mjs collect-migrations`,
								{ capture: true, maxCaptureBytes: 48 * 1024 * 1024 },
							)
						).out,
					verify: async (inputs) => {
						const result = await ssh(
							id,
							`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise exec -- node scripts/lib/boat-source-generation.mjs verify-inputs`,
							{ input: JSON.stringify(inputs), capture: true },
						);
						const { changed } = JSON.parse(result.out);
						if (
							!Array.isArray(changed) ||
							changed.some((name) => !Object.hasOwn(inputs, name))
						)
							throw new Error("Invalid worker input verification");
						if (changed.length) {
							const sent = read(path.join(dir, "manifest.json"));
							for (const name of changed) sent[name] = null;
							write(path.join(dir, "manifest.json"), sent);
							throw new Error(
								`Worker generation inputs changed: ${changed.join(",")}`,
							);
						}
					},
					accept: acceptSource,
				},
			}),
		"source",
	);
}
async function prepare(id) {
	return lock(async () => {
		const inputs = projectedInputs(root);
		const tracked = Object.keys(manifest());
		const installation = installationInputs(tracked);
		const dependencies = fingerprint(root, installation);
		const configuration = [
			...new Set([
				...inputs,
				...installation,
				...tracked.filter(
					(name) =>
						name.startsWith("apps/asset/scripts/") ||
						name.startsWith("apps/asset/src/adapters/commands/") ||
						name === "apps/asset/src/authority.ts" ||
						name.startsWith("apps/asset/src/capabilities/sources/"),
				),
			]),
		];
		const previous = read(path.join(dir, "prepared.json"));
		const started = Date.now();
		const result = await prepareEnvironment({
			root,
			previous,
			configuration,
			dependencies,
			generate: async () => {
				if (previous.dependencies !== dependencies)
					await execute("node", ["scripts/setup-worktree.mjs"]);
				await execute("make", [
					"run",
					"PACKAGE=asset",
					"SCRIPT=dev:configure",
					"BOAT_EXEC=local",
				]);
			},
			project: () =>
				ssh(id, `cd ${remote} && tar -xzf -`, {
					input: execFileSync("tar", ["-czf", "-", ...inputs], {
						maxBuffer: 16 * 1024 * 1024,
					}),
				}),
			install: () =>
				ssh(
					id,
					`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise trust && make install BOAT_EXEC=worker`,
				),
			validateMounts: () =>
				ssh(
					id,
					`cd ${remote} && ${inputs.map((name) => `test -f ${quote(name)}`).join(" && ")} && chmod a+rx infra/postgres/init && chmod a+r infra/postgres/init/*.sql`,
				),
			persist: (record) => write(path.join(dir, "prepared.json"), record),
		});
		event("preparation", { changed: result.changed, ms: Date.now() - started });
		return dependencies;
	});
}

// Preparation must accept the frozen lock before restoring ordinary processes.
// Keep the obligation durable when a generator or a failed attempt defers it.
async function reconcileDevelopment(
	id,
	dependencies,
	{ foreground = false, requested = false } = {},
) {
	return lock(async () => {
		const state = read(stateFile);
		if (
			config.mode !== "development" ||
			(!state.developmentWanted && !requested) ||
			!state.reconciliationPending
		)
			return;
		if (!dependencies)
			throw new Error("Development requires prepared dependencies");
		// Host installation does not establish what is baked into app images.
		// Unknown or changed image inputs require a build during recovery.
		// Awake foreground and partial starts do not authorize full restoration.
		const rebuild =
			state.developmentDependencies?.id !== id ||
			state.developmentDependencies?.dependencies !== dependencies;
		delete state.watcher;
		save(state);
		await ssh(
			id,
			`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make run PACKAGE=scripts SCRIPT=boat:stop-watch BOAT_EXEC=worker && make stop BOAT_EXEC=worker && make infra-start BOAT_EXEC=worker && make apps-start ARGS=${rebuild ? "--build" : "--no-build"} BOAT_EXEC=worker`,
		);
		if (!foreground) await watchDevelopment(id);
		const reconciled = read(stateFile);
		reconciled.developmentDependencies = { id, dependencies };
		delete reconciled.reconciliationPending;
		save(reconciled);
	});
}

function daemon() {
	const s = read(stateFile);
	if (liveOwnedProcess(root, s.daemon)) return;
	const log = fs.openSync(path.join(dir, "daemon.log"), "a", 0o600);
	const child = spawn(
		process.execPath,
		[fileURLToPath(import.meta.url), "daemon"],
		{ cwd: root, detached: true, stdio: ["ignore", log, log] },
	);
	child.unref();
	s.daemonPid = child.pid;
	s.daemon = worktreeProcesses(root).find((p) => p.pid === child.pid);
	save(s);
}
async function disposeShutdownTunnel(id, protectedPids, budget) {
	const results = await Promise.allSettled([
		retirePreviewConnections(root, id, budget.phase("disposal")),
		(async () => {
			const tunnelFile = path.join(dir, "cache-tunnel.json");
			const tunnel = read(tunnelFile);
			if (!tunnel.pid) return;
			if (tunnel.id !== id)
				throw new Error(
					"Shutdown disposal: tunnel worker identity unresolved; record retained",
				);
			await retireShutdownTunnel(
				tunnel,
				protectedPids,
				budget.phase("disposal"),
				(updated) => write(tunnelFile, updated),
			);
			fs.rmSync(tunnelFile, { force: true });
		})(),
	]);
	const failures = results.filter((r) => r.status === "rejected");
	if (failures.length)
		throw new Error(failures.map((r) => r.reason.message).join("; "));
}
// Pending candidates are independently owned compute, even before main identity
// publication. Stop them without creating, bootstrapping or discarding intent.
async function stopAdmission(budget) {
	const state = read(stateFile),
		a = state.admission;
	if (!a || a.status === "published") return;
	assertAdmission(state, config);
	if (!a.candidate)
		throw new Error(
			`Unknown create obligation ${a.token}; stop cannot resolve an unobserved candidate`,
		);
	const info = await json(["info", a.candidate.id], {
		shutdown: budget.phase("initial"),
	});
	const worker = info?.sandbox ?? info;
	if (
		worker?.id !== a.candidate.id ||
		worker.name !== a.name ||
		worker.type !== a.size
	)
		throw new Error(
			"Candidate stop identity mismatch; preserve unknown obligation",
		);
	const candidateSnapshots = snapshotLifecycle({
		load: () => {
			const current = read(stateFile).admission;
			return {
				id: current.candidate.id,
				size: current.size,
				cost: current.cost ?? 0,
				runningSince: current.runningSince,
				shutdownAttempt: current.shutdownAttempt,
			};
		},
		persist: (candidate) => {
			const current = read(stateFile);
			Object.assign(current.admission, {
				cost: candidate.cost,
				runningSince: candidate.runningSince,
				shutdownAttempt: candidate.shutdownAttempt,
			});
			save(current, true);
		},
	});
	const result = await candidateSnapshots.stopCompute({
		budget,
		inspect: (opts) => json(["info", a.candidate.id], opts),
		retire: (opts) => retireWatchers(a.candidate.id, opts),
		request: (opts) => json(["stop", a.candidate.id], opts),
		wait,
	});
	if (result.error) throw new Error(result.error);
	console.log(
		`Stopped owned candidate ${a.candidate.id}; admission history retained, no replacement admitted.`,
	);
}
async function stop(
	remove = false,
	targets,
	{
		preserveIntent = false,
		expectedWorkerId,
		expectedAdmissionToken,
		observeOnly = false,
		expectedStopId,
	} = {},
) {
	const budget = shutdownBudget(config.shutdownBudgetMs, (receipt) => {
		fs.appendFileSync(
			path.join(dir, "shutdown-processes.jsonl"),
			`${JSON.stringify(receipt)}\n`,
			{ mode: 0o600 },
		);
	});
	const outputErrors = [];
	const outputFailure = () => {
		if (!outputErrors.length)
			outputErrors.push("Shutdown output forwarding failed");
	};
	process.stdout.on("error", outputFailure);
	process.stderr.on("error", outputFailure);
	try {
		return await lock(
			async () => {
				// A daemon's idle/cost decision belongs to the generation it observed.
				// Explicit stop/settle calls still clean all of their owned obligations.
				if (expectedWorkerId || expectedAdmissionToken) {
					const current = read(stateFile),
						admission = current.admission;
					if (
						(expectedWorkerId &&
							(current.id !== expectedWorkerId ||
								(admission &&
									(admission.status !== "published" ||
										admission.candidate?.id !== expectedWorkerId)))) ||
						(expectedAdmissionToken &&
							(admission?.token !== expectedAdmissionToken ||
								admission.owner?.root !== root ||
								admission.owner?.key !== config.key ||
								(!expectedWorkerId &&
									current.runningSince != null &&
									current.id !== admission.candidate?.id)))
					)
						return false;
				}
				if (observeOnly) {
					const current = read(stateFile),
						attempt = current.shutdownAttempt;
					if (
						!current.id ||
						attempt?.workerId !== current.id ||
						typeof attempt.submittedAt !== "string" ||
						!Number.isFinite(Date.parse(attempt.submittedAt)) ||
						(attempt.completion &&
							attempt.completion.provider?.stop?.id !== expectedStopId) ||
						(attempt.accountingAppliedAt && current.runningSince != null) ||
						![
							"submission-uncertain",
							"stopping-observed",
							"completed-observed",
						].includes(attempt.status)
					)
						throw new Error(
							"Stop observation requires an existing submitted owning attempt",
						);
					const info = await json(["info", current.id], {
						shutdown: budget.phase("initial"),
					});
					const worker = info?.sandbox ?? info,
						operation = worker?.stop;
					if (
						!completedStop(worker, current.id) ||
						worker.name !== current.admission.name ||
						worker.type !== config.size ||
						operation?.id !== expectedStopId ||
						typeof operation.endedAt !== "string"
					)
						throw new Error(
							"Stop observation requires exact completed nonforced proof",
						);
					// No request, retirement or cleanup hook can run on this read-only path.
					const result = await snapshots.stopCompute({
						budget,
						inspect: async () => info,
					});
					if (result.error) throw new Error(result.error);
					event("stop-observed", {
						id: current.id,
						completion: result.completion,
					});
					console.log(
						"Observed existing completed stop; accounting reconciled, no stop submitted.",
					);
					return;
				}
				const errors = [];
				try {
					await stopAdmission(budget);
				} catch (error) {
					errors.push(error.message);
				}
				let s = read(stateFile);
				if (!s.id) {
					if (errors.length) throw new Error(errors.join("; "));
					return;
				}
				let result;
				const protectedPids = [
					process.pid,
					read(path.join(dir, "cache-server.json")).pid,
					s.daemon?.pid,
					s.watcher?.pid,
				];
				try {
					result = await snapshots.stopCompute({
						budget,
						inspect: (opts) => json(["info", s.id], opts),
						retire: (opts) => retireWatchers(s.id, opts),
						cleanup:
							targets &&
							(async (opts) => {
								await ssh(
									s.id,
									`export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1; cd ${remote} && mise exec -- make BOAT_EXEC=worker ${targets.map(quote).join(" ")}`,
									opts,
								);
								if (preserveIntent) return;
								const cleaned = read(stateFile);
								cleaned.developmentWanted = developmentWantedAfterCommand(
									cleaned.developmentWanted,
									targets,
									0,
								);
								if (!developmentWantedAfterCommand(true, targets, 0))
									delete cleaned.reconciliationPending;
								save(cleaned);
							}),
						request: (opts) => json(["stop", s.id], opts),
						wait,
					});
					s = read(stateFile);
					if (config.lifecycle === "fresh-after-stop")
						console.log(
							"Next execution reconstructs scratch DB, dependencies and Docker state on a fresh worker; local source/Git and external Turbo cache are preserved.",
						);
					event("stopped", {
						id: s.id,
						estimatedCost: s.cost,
						completion: result.completion,
					});
					if (targets && result.cleanupSkipped && !preserveIntent) {
						s.developmentWanted = developmentWantedAfterCommand(
							s.developmentWanted,
							targets,
							0,
						);
						if (!developmentWantedAfterCommand(true, targets, 0))
							delete s.reconciliationPending;
						save(s);
						console.log(
							`Remote compute already stopped or stopping; development intent ${s.developmentWanted ? "preserved" : "cleared"}; physical cleanup was not performed; snapshot remains DIRTY.`,
						);
					}
					if (result.error) errors.push(result.error);
					try {
						write(
							path.join(dir, "usage.json"),
							await json(["usage", s.id], { shutdown: budget.phase("usage") }),
						);
					} catch (error) {
						errors.push(`Usage after completed stop: ${error.message}`);
					}
				} catch (error) {
					errors.push(error.message);
				} finally {
					try {
						await disposeShutdownTunnel(s.id, protectedPids, budget);
					} catch (error) {
						errors.push(error.message);
					}
				}
				errors.push(...outputErrors);
				if (errors.length) throw new Error(errors.join("; "));
				if (remove) {
					// The later destructive delete retains its existing contract, outside the
					// stop enclosure. This repair neither exercises nor bounds that request.
					await boat(["delete", s.id, "--yes"]);
					event("deleted", { id: s.id });
					delete s.id;
					save(s);
				}
			},
			"lifecycle",
			Infinity,
			budget.phase("lock"),
		);
	} finally {
		// A destroyed output stream can emit again during final error reporting.
		// Keep its error handler until process exit, without retaining a live handle.
		if (!process.stdout.destroyed) process.stdout.off("error", outputFailure);
		if (!process.stderr.destroyed) process.stderr.off("error", outputFailure);
	}
}
async function runAssetMigration(id, started, targets, expected, deadline) {
	if (Date.now() >= deadline)
		throw new Error("Asset migration command allowance exhausted; no launch");
	const token = randomBytes(16).toString("hex");
	const requestFile = `.boat/asset-migration-${token}.json`;
	const permit = `.boat/asset-migration-${token}.permit`;
	await ssh(id, `cd ${remote} && cat > ${quote(requestFile)}`, {
		input: JSON.stringify({ expected, deadline, permit, token }),
	});
	const file = path.join(dir, "asset-migration-active.json");
	const evidence = path.join(
		dir,
		`asset-migration-${started}-${process.pid}.json`,
	);
	const record = {
		workerId: id,
		targets,
		expected,
		started,
		deadline,
		deliveryBudgetMs: 20_000,
		commandId: null,
		terminal: null,
	};
	const persist = () => {
		write(file, record);
		write(evidence, record);
	};
	await lock(
		() => {
			if (fs.existsSync(file))
				throw new Error(
					"Previous Asset migration terminal status uncertain; inspect ownership before another run",
				);
			persist();
		},
		"asset-migration",
		deadline,
	);
	let pending = "",
		authorization;
	const result = await boat(
		[
			"--json",
			"exec",
			id,
			"--timeout",
			String(Math.max(1, Math.floor((deadline - Date.now()) / 1000))),
			"--stream",
			"--",
			"bash",
			"-lc",
			`export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1; cd ${remote} && mise exec -- make BOAT_EXEC=worker docker-run ${targets
				.slice(1)
				.filter((v) => !v.startsWith("ARGS="))
				.map(quote)
				.join(
					" ",
				)} ${quote(`ARGS=node scripts/lib/boat-asset-migration.mjs ${requestFile} $(APPS_COMPOSE)`)}`,
		],
		{
			allowFailure: true,
			streamFrames: true,
			logPath: path.join(dir, `command-${started}.log`),
			onOutput: (data) => {
				pending = (pending + data).slice(-8192);
				const completion = pending.match(
					new RegExp(
						`asset-migration completed ${hash(JSON.stringify(expected))} (\\d+)\\n`,
					),
				);
				if (completion && Number(completion[1]) <= 255) {
					record.runtimeExit = Number(completion[1]);
					persist();
				}
				if (!authorization && pending.includes("asset-migration ready\n")) {
					authorization = lock(
						() => {
							const current = captureAssetMigration(root, manifest());
							if (JSON.stringify(current) !== JSON.stringify(expected))
								throw new Error(
									"Asset migration source superseded before launch",
								);
						},
						"source",
						deadline,
					)
						.then(() => {
							record.authorizationSent = true;
							persist();
							return ssh(
								id,
								`cd ${remote} && printf '%s' ${quote(token)} > ${quote(permit)}`,
							);
						})
						.catch(async (error) => {
							await ssh(
								id,
								`cd ${remote} && printf '%s' reject > ${quote(permit)}`,
							);
							throw error;
						});
					// Keep a rejection observed while the exec reports its bounded no-launch result.
					authorization.catch((error) => {
						record.authorizationError = error.message;
						persist();
					});
				}
			},
			onFrame: (frame) => {
				if (frame.type === "started") {
					if (record.commandId || record.terminal) record.protocolError = true;
					record.commandId = frame.commandId;
				}
				if (frame.type === "exit") {
					if (!record.commandId || record.terminal) record.protocolError = true;
					record.terminal = frame;
				}
				persist();
			},
		},
	);
	let authorizationError;
	try {
		await authorization;
	} catch (error) {
		authorizationError = error;
	}
	if (
		!provenSourceExit(record) ||
		((record.authorizationSent || record.terminal?.exitCode === 0) &&
			!Number.isInteger(record.runtimeExit))
	)
		throw new Error(
			`Asset migration terminal status uncertain; no automatic rerun. Ownership: ${file}`,
		);
	fs.rmSync(file);
	await ssh(
		id,
		`cd ${remote} && rm -f -- ${quote(requestFile)} ${quote(permit)}`,
	);
	if (authorizationError) throw authorizationError;
	return {
		status:
			result.status || record.terminal.exitCode || record.runtimeExit || 0,
	};
}

// Worker-only half of the owned phase. Compose resolves its own image authority;
// never print the resolved environment or persist an image-readiness cache.
function prepareInfraImages() {
	if (
		process.env.WALLPAPERDB_BOAT_WORKER !== "1" ||
		args.length !== 1 ||
		!args[0]
	)
		throw new Error(
			"Infrastructure image acquisition requires the selected worker",
		);
	const project = args[0];
	const compose = ["compose", "-p", project, "-f", "infra/docker-compose.yml"];
	const env = { ...process.env, COMPOSE_PROFILES: "" };
	const inspect = (...argv) =>
		JSON.parse(
			execFileSync("docker", argv, {
				env,
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
			}),
		);
	const selection = () => {
		const model = inspect(...compose, "config", "--format", "json");
		if (
			model.name !== project ||
			!model.services ||
			typeof model.services !== "object"
		)
			throw new Error("Invalid infrastructure Compose project");
		const selected = Object.entries(model.services)
			.filter(([, service]) => {
				if (
					!service ||
					(service.profiles !== undefined && !Array.isArray(service.profiles))
				)
					throw new Error("Invalid infrastructure Compose profiles");
				return !service.profiles?.length;
			})
			.map(([name, service]) => {
				if (typeof service.image !== "string" || !service.image.trim())
					throw new Error("Selected infrastructure service requires an image");
				return [name, service.image];
			});
		if (!selected.length)
			throw new Error("No default infrastructure images selected");
		return selected;
	};
	const selected = selection();
	execFileSync(
		"docker",
		[...compose, "pull", ...selected.map(([name]) => name)],
		{
			env,
			stdio: "inherit",
		},
	);
	const images = [...new Set(selected.map(([, image]) => image))].map(
		(reference) => {
			const result = inspect("image", "inspect", reference);
			if (
				!Array.isArray(result) ||
				result.length !== 1 ||
				!/^sha256:[a-f0-9]{64}$/.test(result[0]?.Id)
			)
				throw new Error("Invalid selected image identity");
			return { reference, id: result[0].Id };
		},
	);
	if (JSON.stringify(selection()) !== JSON.stringify(selected))
		throw new Error(
			"Infrastructure image selection changed during acquisition",
		);
	console.log(`BOAT_INFRA_IMAGES ${JSON.stringify({ project, images })}`);
}

function applicationImageCommands() {
	const project = process.env.COMPOSE_PROJECT_NAME;
	if (!project) throw new Error("Missing application Compose project");
	// Resolve locally from the same synchronized configuration. Keep the resolved
	// environment private; only service names become worker Make arguments.
	const model = JSON.parse(
		execFileSync(
			"docker",
			[
				"compose",
				"-p",
				project,
				"-f",
				"infra/docker-compose.apps.yml",
				"config",
				"--format",
				"json",
			],
			{
				env: { ...process.env, COMPOSE_PROFILES: "" },
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
			},
		),
	);
	if (
		model.name !== project ||
		!model.services ||
		typeof model.services !== "object" ||
		Array.isArray(model.services)
	)
		throw new Error("Invalid application Compose project");
	const services = Object.entries(model.services)
		.filter(([, service]) => {
			if (
				!service ||
				(service.profiles !== undefined && !Array.isArray(service.profiles))
			)
				throw new Error("Invalid application Compose profiles");
			return !service.profiles?.length && service.build != null;
		})
		.map(([name]) => {
			if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name))
				throw new Error("Invalid application build service");
			return name;
		})
		.sort((a, b) =>
			a === b ? 0 : a === "asset" ? -1 : b === "asset" ? 1 : a.localeCompare(b),
		);
	if (!services.length)
		throw new Error("No default application builds selected");
	return services.map((name) => ["apps-build", `SERVICE=${name}`]);
}

async function command() {
	const entered = Date.now();
	owned();
	const targets = args
		.slice(args.indexOf("--") + 1)
		.filter((v) => !v.startsWith("BOAT_EXEC="));
	if (targets[0] === "stop") {
		await stop(false, targets);
		return;
	}
	admit();
	const { id, resumed } = await ensure();
	const lease = path.join(dir, `command-${process.pid}.json`);
	write(lease, {
		pid: process.pid,
		at: Date.now(),
		watcherOnly: ["apps-logs", "infra-logs"].includes(targets[0]),
		development: targets[0] === "dev",
		startTicks: worktreeProcesses(root).find((p) => p.pid === process.pid)
			?.startTicks,
	});
	daemon();
	const started = Date.now();
	try {
		const migration = assetMigrationSelected(root, config.mode, targets);
		if (
			migration &&
			fs.existsSync(path.join(dir, "asset-migration-active.json"))
		)
			throw new Error(
				"Previous Asset migration terminal status uncertain; inspect ownership before another run",
			);
		const kind = sourceGeneration(targets);
		if (kind) {
			const result = await generate(id, started, kind);
			event("command", {
				targets,
				status: result.status,
				ms: Date.now() - started,
				resumed,
			});
			process.exitCode = result.status;
			return;
		}
		const expected = await sync(
			id,
			migration ? (source) => captureAssetMigration(root, source) : undefined,
		);
		if (targets[0] === "boat-prepare-toolchain") {
			let completed = false;
			try {
				await lock(async () => {
					startupWorker(id);
					await ssh(
						id,
						`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise trust && mise install --locked && mise exec -- node scripts/toolchain.mjs`,
					);
					completed = true;
				});
			} finally {
				event("toolchain-preparation", {
					workerId: id,
					ms: Date.now() - entered,
					completed,
				});
			}
			// Like source generation, this leaves still-wanted reconciliation for
			// the next ordinary command, after its frozen dependency preparation.
			return;
		}
		const dependencies = await prepare(id);
		if (targets[0] === "boat-prepare-workspace") {
			await lock(() => {
				startupWorker(id);
				event("workspace-preparation", {
					workerId: id,
					ms: Date.now() - entered,
					completed: true,
				});
			});
			return;
		}
		const preparation = new Map([
			[
				"boat-prepare-chromium",
				{
					commands: () => [
						["run", "PACKAGE=web", "SCRIPT=test:browser:install"],
					],
					event: "chromium-preparation",
				},
			],
			[
				"boat-prepare-infra-images",
				{
					commands: () => [["boat-prepare-infra-images"]],
					event: "infra-image-preparation",
				},
			],
			[
				"boat-prepare-app-images",
				{
					commands: applicationImageCommands,
					event: "app-image-preparation",
				},
			],
		]).get(targets[0]);
		if (preparation) {
			let completed = false;
			let commands;
			try {
				await lock(() =>
					lock(async () => {
						startupWorker(id);
						const admission = read(stateFile).admission?.token;
						const selected = () => {
							startupWorker(id);
							const state = read(stateFile);
							if (!state.runningSince || state.admission?.token !== admission)
								throw new Error("Preparation worker admission changed");
						};
						await syncOwned(id);
						const source = manifest();
						if (
							fingerprint(root, installationInputs(Object.keys(source))) !==
							dependencies
						)
							throw new Error("Preparation dependencies changed before launch");
						commands = preparation.commands();
						write(lease, {
							...read(lease),
							preparation: { worker: id, admission },
						});
						try {
							for (const command of commands) {
								selected();
								await ssh(
									id,
									`${workerEnvironment}; cd ${remote} && mise exec -- make ${command.map(quote).join(" ")} BOAT_EXEC=worker`,
								);
							}
							selected();
							if (
								JSON.stringify(preparation.commands()) !==
								JSON.stringify(commands)
							)
								throw new Error(
									"Preparation command selection changed during preparation",
								);
							if (JSON.stringify(manifest()) !== JSON.stringify(source))
								throw new Error(
									"Preparation source changed during preparation",
								);
							completed = true;
						} finally {
							const record = read(lease);
							delete record.preparation;
							write(lease, record);
						}
					}, "source"),
				);
			} finally {
				event(preparation.event, {
					workerId: id,
					ms: Date.now() - entered,
					completed,
					commands,
				});
			}
			// Acquisition never consumes still-wanted process restoration.
			return;
		}
		await cache(id);
		await reconcileDevelopment(id, dependencies, {
			foreground: targets[0] === "dev",
		});
		if (migration) {
			const result = await runAssetMigration(
				id,
				started,
				targets,
				expected,
				entered + 180_000,
			);
			event("command", {
				targets,
				status: result.status,
				ms: Date.now() - started,
				resumed,
			});
			process.exitCode = result.status;
			return;
		}
		if (["dev", "apps-start"].includes(targets[0])) {
			const s = read(stateFile);
			s.developmentWanted = true;
			save(s);
		}
		if (
			targets[0] === "stop" ||
			!developmentWantedAfterCommand(true, targets, 0)
		)
			await retireWatchers(id);
		const result = await boat(
			[
				"exec",
				id,
				"--timeout",
				"0",
				"--stream",
				"--",
				"bash",
				"-lc",
				`${workerEnvironment}; cd ${remote} && mise exec -- make BOAT_EXEC=worker ${targets.map(quote).join(" ")}`,
			],
			{
				allowFailure: true,
				streamFrames: true,
				logPath: path.join(dir, `command-${started}.log`),
				onOutput: (data) => {
					if (targets[0] === "dev" && data.includes("Watch enabled")) {
						const record = read(lease);
						write(lease, { ...record, watcherOnly: true });
						event("foreground-watching");
					}
				},
			},
		);
		event("command", {
			targets,
			status: result.status,
			ms: Date.now() - started,
			resumed,
			local: resourceSample(),
		});
		process.exitCode = result.status;
		const s = read(stateFile);
		// Only the unqualified full-stack command guarantees the default build.
		// Partial services and custom arguments cannot acknowledge all images.
		if (
			result.status === 0 &&
			targets.length === 1 &&
			targets[0] === "apps-start"
		)
			s.developmentDependencies = { id, dependencies };
		s.developmentWanted = developmentWantedAfterCommand(
			s.developmentWanted,
			targets,
			result.status,
		);
		if (!developmentWantedAfterCommand(true, targets, result.status))
			delete s.reconciliationPending;
		save(s);
	} finally {
		if (resumed) console.log("Remote environment resumed from sleep");
		fs.rmSync(lease, { force: true });
		const s = read(stateFile);
		s.lastActivity = Date.now();
		save(s);
	}
}
function resourceSample() {
	return {
		worktreeProcesses: worktreeProcesses(root),
		controllerUsage: process.resourceUsage(),
		load: os.loadavg(),
		free: os.freemem(),
		total: os.totalmem(),
		memory: fs.readFileSync("/proc/meminfo", "utf8"),
		cpu: fs.readFileSync("/proc/stat", "utf8"),
		disk: fs.statfsSync(root),
		pressure: Object.fromEntries(
			["cpu", "memory", "io"].map((n) => [
				n,
				fs.readFileSync(`/proc/pressure/${n}`, "utf8"),
			]),
		),
	};
}
async function runDaemon() {
	let extended = 0;
	const renew = async (selected, active) => {
		const fresh = read(stateFile);
		if (
			fresh.id === selected &&
			fresh.runningSince &&
			fresh.snapshotRecovery?.status === "ACTIVE" &&
			Date.now() - extended > 60000 &&
			(active || Date.now() - fresh.lastActivity < 60000)
		) {
			await boat(["extend", selected, "--ttl", "2100"]);
			extended = Date.now();
		}
	};
	while (true) {
		const s = read(stateFile);
		if (!s.id || !s.runningSince) return;
		const leases = fs
			.readdirSync(dir)
			.filter((p) => p.startsWith("command-") && p.endsWith(".json"));
		let active = false;
		for (const p of leases) {
			const lease = read(path.join(dir, p));
			if (liveOwnedProcess(root, lease)) {
				active ||= !lease.watcherOnly;
			} else {
				fs.rmSync(path.join(dir, p), { force: true });
			}
		}
		if (
			accounting() >= 9.9 ||
			(!active && Date.now() - s.lastActivity >= 1800000)
		) {
			const stopped = await stop(false, undefined, { expectedWorkerId: s.id });
			if (stopped === false) continue;
			return;
		}
		// Selection waits for lifecycle/bootstrap, then releases it before waiting
		// for source. Source ownership prevents publication from splitting sync and
		// renewal; a changed selection explicitly supersedes only this daemon cycle.
		const selected = await lock(
			() => {
				const current = read(stateFile);
				return current.id && current.runningSince ? current.id : null;
			},
			"lifecycle",
			Infinity,
			undefined,
			preparationOwner,
		);
		if (!selected) return;
		if (selected.preparationPid) {
			if (preparationOwner(selected.preparationPid)?.worker === selected.worker)
				await renew(selected.worker, active);
			await wait(2000);
			continue;
		}
		const running = await lock(async () => {
			const current = read(stateFile);
			if (current.id !== selected) return "superseded";
			if (!current.runningSince) return false;
			await syncOwned(selected);
			// Stop may run while source is owned, as before. Never renew its stopped or
			// DIRTY generation after an in-flight flush completes.
			await renew(selected, active);
			return true;
		}, "source");
		if (running === "superseded") continue;
		if (running === false) return;
		event("resources", {
			local: resourceSample(),
			estimatedExperimentCost: accounting(),
		});
		await wait(2000);
	}
}
async function serveCache() {
	owned();
	const directory = path.join(runDir, "cache", config.cacheNamespace ?? "");
	const tokenFile = path.join(runDir, "cache-token.json");
	if (!fs.existsSync(tokenFile))
		write(tokenFile, { token: randomBytes(32).toString("hex") });
	const token = read(tokenFile).token;
	const authPath = path.join(os.homedir(), ".config/turborepo/auth.json");
	const upstreamToken = process.env.TURBO_TOKEN ?? read(authPath).token;
	const server = cacheServer({
		directory,
		cohort: config.cohort === "c" ? `c-${config.key}` : config.cohort,
		token,
		upstream: upstreamToken
			? { token: upstreamToken, team: "rafael-biezes-projects" }
			: null,
		record: (detail) => event("cache", detail),
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	write(path.join(dir, "cache.json"), {
		api: `http://127.0.0.1:${server.address().port}`,
		token,
	});
	write(
		path.join(dir, "cache-server.json"),
		worktreeProcesses(root).find((p) => p.pid === process.pid),
	);
}
async function cache(id) {
	return lock(async () => {
		const server = read(path.join(dir, "cache-server.json"));
		const alive = liveOwnedProcess(root, server);
		if (!alive) {
			fs.rmSync(path.join(dir, "cache.json"), { force: true });
			const log = fs.openSync(path.join(dir, "cache.log"), "a", 0o600);
			const child = spawn(
				process.execPath,
				[fileURLToPath(import.meta.url), "cache-server"],
				{ cwd: root, detached: true, stdio: ["ignore", log, log] },
			);
			child.unref();
			for (
				let i = 0;
				i < 100 && !fs.existsSync(path.join(dir, "cache.json"));
				i++
			)
				await wait(100);
		}
		const settings = read(path.join(dir, "cache.json"));
		if (!settings.api) throw new Error("Cache server did not start");
		if (id) {
			const tunnel = read(path.join(dir, "cache-tunnel.json"));
			let connected = false;
			try {
				connected =
					liveOwnedProcess(root, tunnel) &&
					tunnel.id === id &&
					tunnel.api === settings.api;
			} catch {}
			const local = new URL(settings.api).port;
			if (!connected) {
				for (const record of worktreeProcesses(root)) {
					let argv;
					try {
						argv = fs
							.readFileSync(`/proc/${record.pid}/cmdline`, "utf8")
							.split("\0");
					} catch {
						continue;
					}
					const wrapper =
						argv[0] === cli &&
						argv.includes("forward") &&
						argv.includes("--reverse") &&
						argv.includes(id);
					const orphanSsh =
						record.name === "ssh" &&
						argv.includes("-R") &&
						argv.some((arg) => arg.startsWith("127.0.0.1:27857:127.0.0.1:"));
					if (!wrapper && !orphanSsh) continue;
					if (liveOwnedProcess(root, record)) {
						const group = Number(
							fs
								.readFileSync(`/proc/${record.pid}/stat`, "utf8")
								.split(") ")[1]
								.split(" ")[2],
						);
						if (wrapper && group !== record.pid)
							throw new Error("Cache wrapper has unexpected process group");
						process.kill(-group, "SIGTERM");
					}
					for (let attempt = 0; liveOwnedProcess(root, record); attempt++) {
						if (attempt >= 100)
							throw new Error("Owned cache forward did not terminate");
						await wait(50);
					}
				}
				const log = fs.openSync(
					path.join(dir, "cache-forward.log"),
					"a",
					0o600,
				);
				const forward = spawn(
					cli,
					[
						"--no-update",
						"forward",
						id,
						"--reverse",
						"--local",
						"27857",
						"--remote",
						local,
					],
					{ stdio: ["ignore", log, log], detached: true },
				);
				forward.unref();
				write(path.join(dir, "cache-tunnel.json"), {
					id,
					api: settings.api,
					...worktreeProcesses(root).find((p) => p.pid === forward.pid),
				});
			}
			await ssh(
				id,
				`mkdir -p ${remote}/.boat && chmod 700 ${remote}/.boat && cat > ${remote}/.boat/cache.json && chmod 600 ${remote}/.boat/cache.json`,
				{
					input: JSON.stringify({ ...settings, api: "http://127.0.0.1:27857" }),
				},
			);
			await ssh(
				id,
				`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise exec -- node --input-type=module -`,
				{
					input: `import fs from 'node:fs';const c=JSON.parse(fs.readFileSync('.boat/cache.json'));let ready=false;for(let i=0;i<30;i++){try{const r=await fetch(c.api+'/v8/artifacts/status',{headers:{Authorization:'Bearer '+c.token},signal:AbortSignal.timeout(1000)});if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Authenticated cache forward is unavailable');console.log('Authenticated cache forward ready');`,
				},
			);
		}
	});
}
async function preview() {
	owned();
	if (config.mode !== "development")
		throw new Error("Validation mode uses its local development stack");
	const { id } = await ensure();
	const startupLease = path.join(dir, `command-${process.pid}.json`);
	write(startupLease, {
		...worktreeProcesses(root).find((p) => p.pid === process.pid),
		at: Date.now(),
	});
	process.once("exit", () => fs.rmSync(startupLease, { force: true }));
	await sync(id);
	const dependencies = await prepare(id);
	daemon();
	await cache(id);
	const started = Date.now();
	const foreground = fs
		.readdirSync(dir)
		.filter((name) => /^command-\d+\.json$/.test(name))
		.some((name) => {
			const lease = read(path.join(dir, name));
			return lease.development && liveOwnedProcess(root, lease);
		});
	await reconcileDevelopment(id, dependencies, { foreground, requested: true });
	// Readiness belongs to the app, independent of the process that started it.
	const health = await ssh(
		id,
		`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make run PACKAGE=scripts SCRIPT=boat:ready ARGS=--once BOAT_EXEC=worker`,
		{ allowFailure: true, capture: true },
	);
	await ssh(
		id,
		`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && ${health.status === 0 || foreground ? "" : `make infra-start BOAT_EXEC=worker && make apps-start ${read(stateFile).developmentWanted ? "ARGS=--no-build" : ""} BOAT_EXEC=worker && `}make run PACKAGE=scripts SCRIPT=boat:ready BOAT_EXEC=worker`,
	);
	event("application-ready", { ms: Date.now() - started });
	if (!foreground) await watchDevelopment(id);
	await ssh(
		id,
		`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make run PACKAGE=scripts SCRIPT=boat:ready BOAT_EXEC=worker`,
	);
	event("preview-ready", { ms: Date.now() - started });
	fs.rmSync(startupLease, { force: true });
	const desired = read(stateFile);
	desired.developmentWanted = true;
	save(desired);
	const text = fs.readFileSync(".worktree", "utf8");
	const port = Number(text.match(/^INGRESS_PORT\s*[:?]?=\s*(\d+)/m)?.[1]);
	if (!port) throw new Error("No generated ingress port");
	const privatePort = port + 20000;

	const server = http.createServer((req, res) => {
		if (meaningfulPreviewRequest(req.url, req.headers)) {
			const s = read(stateFile);
			s.lastActivity = Date.now();
			save(s);
		}
		if (req.url === "/__boat557/activity") {
			req.resume();
			res.writeHead(204);
			res.end();
			return;
		}
		const upstream = http.request(
			{
				hostname: "127.0.0.1",
				port: privatePort,
				path: req.url,
				method: req.method,
				headers: { ...req.headers, "accept-encoding": "identity" },
			},
			(response) => {
				if (response.headers["content-type"]?.includes("text/html")) {
					const chunks = [];
					let size = 0;
					response.on("data", (chunk) => {
						size += chunk.length;
						if (size > 1024 * 1024) {
							upstream.destroy();
							res.destroy();
						} else chunks.push(chunk);
					});
					response.on("end", () => {
						const headers = { ...response.headers };
						delete headers["content-length"];
						delete headers.etag;
						headers["cache-control"] = "no-store";
						res.writeHead(response.statusCode, headers);
						const activity = `<script>let boatLastActivity=0;for(const event of ['pointerdown','keydown','focus'])window.addEventListener(event,()=>{if(document.visibilityState==='visible'&&Date.now()-boatLastActivity>10000){boatLastActivity=Date.now();fetch('/__boat557/activity',{method:'POST',headers:{'x-boat-activity':'1'},keepalive:true}).catch(()=>{})}},{passive:true});</script>`;
						res.end(
							Buffer.concat(chunks)
								.toString("utf8")
								.replace("</head>", `${activity}</head>`),
						);
					});
					return;
				}
				res.writeHead(response.statusCode, response.headers);
				response.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (res.destroyed) return;
			if (res.headersSent) {
				res.destroy();
				return;
			}
			res.writeHead(503);
			res.end("Remote application is not ready");
		});
		forwardPreviewDisconnect(req, res, upstream);
		req.pipe(upstream);
	});
	server.on("upgrade", (req, socket, head) => {
		forwardPreviewUpgrade(
			{ root, cli, workerId: id, port, server },
			req,
			socket,
			head,
		);
	});
	await runPreview({
		root,
		cli,
		argv: [
			"--no-update",
			"forward",
			id,
			"--remote",
			String(port),
			"--local",
			String(privatePort),
		],
		privatePort,
		port,
		server,
		record: event,
		ready: () =>
			console.log(
				`Private preview proxy http://localhost:${port}/web; application health passed. Authentication must still be verified in the browser.`,
			),
	});
}
async function watchDevelopment(id) {
	const state = read(stateFile);
	if (state.watcher) {
		const status = await json(["exec", id, "--status", String(state.watcher)]);
		if (status.running) return;
		delete state.watcher;
	}
	const command = await json([
		"exec",
		id,
		"--detach",
		"--",
		"bash",
		"-lc",
		`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make run PACKAGE=scripts SCRIPT=boat:watch BOAT_EXEC=worker`,
	]);
	state.watcher = command.processId ?? command.pid;
	if (!state.watcher)
		throw new Error("Development watcher returned no process ID");
	save(state);
	let ready = false;
	for (let i = 0; i < 120; i++) {
		const status = await json(["exec", id, "--status", String(state.watcher)]);
		if (!status.running)
			throw new Error(
				"Development watcher exited before readiness; inspect Boat command history",
			);
		if (status.stdout?.includes("Watch enabled")) {
			ready = true;
			break;
		}
		await wait(500);
	}
	if (!ready)
		throw new Error(
			"Development watcher did not become ready within 60 seconds",
		);
	event("development-watcher", { processId: state.watcher });
}
try {
	if (action === "prepare-infra-images") prepareInfraImages();
	else if (action === "enroll") {
		const [
			mode = "validation",
			size = "large",
			cohort = "smoke",
			lifecycle = "snapshot",
		] = args;
		if (!["snapshot", "fresh-after-stop"].includes(lifecycle))
			throw new Error("Invalid lifecycle policy");
		if (!fs.statSync(".git").isFile())
			throw new Error("Enrollment requires an isolated linked worktree");
		if (
			!["validation", "development"].includes(mode) ||
			!["smoke", "a", "b", "c"].includes(cohort)
		)
			throw new Error("Invalid mode or cohort");
		estimate(size, 0);
		const cacheNamespace = process.env.BOAT_CACHE_NAMESPACE ?? "";
		if (cacheNamespace && !/^[a-z0-9][a-z0-9-]*$/.test(cacheNamespace))
			throw new Error("Invalid cache namespace");
		if (cohort === "c" && !cacheNamespace)
			throw new Error("C requires an isolated cache namespace");
		if (config)
			throw new Error("Already enrolled; preserve existing worker ownership");
		const base = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
		write(configFile, {
			root,
			mode,
			size,
			cohort,
			cacheNamespace,
			lifecycle,
			base,
			key: hash(root).slice(0, 12),
		});
		console.log("Enrolled. No worker created.");
	} else if (action === "status") {
		owned();
		console.log(
			JSON.stringify(
				{
					config,
					state: read(stateFile),
					estimatedExperimentCost: accounting(),
				},
				null,
				2,
			),
		);
	} else if (action === "command") await command();
	else if (action === "daemon") {
		owned();
		await runDaemon();
	} else if (["stop", "delete", "observe-stop"].includes(action)) {
		owned();
		const observeOnly = action === "observe-stop";
		const expectedWorkerId =
			action !== "delete" ? process.env.BOAT_EXPECTED_WORKER_ID : undefined;
		const expectedAdmissionToken =
			action !== "delete" ? process.env.BOAT_EXPECTED_ADMISSION : undefined;
		const expectedStopId = observeOnly
			? process.env.BOAT_EXPECTED_STOP_ID
			: undefined;
		if (
			observeOnly &&
			(!expectedWorkerId || !expectedAdmissionToken || !expectedStopId)
		)
			throw new Error(
				"Stop observation requires exact worker, admission and stop identities",
			);
		if (expectedWorkerId && !/^[A-Za-z0-9_-]+$/.test(expectedWorkerId))
			throw new Error("Invalid expected stop worker identity");
		if (
			expectedAdmissionToken &&
			!/^[A-Za-z0-9_-]+$/.test(expectedAdmissionToken)
		)
			throw new Error("Invalid expected stop admission identity");
		if (expectedStopId && !/^[A-Za-z0-9_-]+$/.test(expectedStopId))
			throw new Error("Invalid expected stop operation identity");
		const stopped = await stop(action === "delete", undefined, {
			expectedWorkerId,
			expectedAdmissionToken,
			observeOnly,
			expectedStopId,
		});
		if (stopped === false)
			throw new Error("Expected stop ownership changed; no stop executed");
	} else if (action === "preview") await preview();
	else if (action === "cache-server") await serveCache();
	else if (action === "cache") {
		owned();
		await cache();
	} else if (action === "settle") {
		owned();
		const database = path.join(
			process.env.T3CODE_HOME ?? path.join(os.homedir(), ".t3"),
			"userdata/statev2.sqlite",
		);
		const owners = JSON.parse(
			execFileSync("python", [
				"scripts/boat-owners.py",
				root,
				database,
			]).toString(),
		);
		if (!owners.stop)
			console.log(
				"Remote cleanup skipped: another worktree owner remains active.",
			);
		else {
			const state = read(stateFile);
			if (
				state.id ||
				(state.admission && state.admission.status !== "published")
			) {
				event("settle-stop", { owners: owners.owners });
				await stop(false, ["stop"], { preserveIntent: true });
			}
		}
	} else
		throw new Error(
			"Use make boat-enroll, boat-status, boat-stop, boat-delete or boat-preview",
		);
} catch (error) {
	console.error(error.message);
	event("failure", { action, message: error.message });
	process.exitCode = 1;
}
