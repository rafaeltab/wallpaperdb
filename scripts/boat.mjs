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
import { cacheServer } from "./lib/boat-cache.mjs";
import {
	fingerprint,
	projectedInputs,
	installationInputs,
	prepareEnvironment,
} from "./lib/boat-preparation.mjs";

const root = process.cwd();
const dir = path.join(root, ".boat");
const configFile = path.join(dir, "enrollment.json");
const stateFile = path.join(dir, "state.json");
const runDir = path.join(os.homedir(), ".local/state/wallpaperdb-boat/557");
const cli = path.join(root, ".mise/boat/boat");
const remote = "/home/user/wallpaperdb";
const [action, ...args] = process.argv.slice(2);
const read = (p, fallback = {}) =>
	fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
function write(p, value) {
	fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
	const tmp = `${p}.${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, p);
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
	} = {},
) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const child = spawn(command, argv, {
			cwd: root,
			env: { ...process.env, BOAT_NO_UPDATE: "1" },
			stdio: [
				input === undefined ? "inherit" : "pipe",
				capture || streamFrames ? "pipe" : "inherit",
				capture || streamFrames ? "pipe" : "inherit",
			],
		});
		let out = "",
			err = "";
		if (capture) {
			child.stdout.on("data", (b) => {
				out += b;
			});
			child.stderr.on("data", (b) => {
				err += b;
			});
		}
		if (streamFrames) {
			let pending = "";
			const emit = (data, stderr = false) => {
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
			const line = (value) => {
				try {
					const frame = JSON.parse(value);
					if (frame.type === "stdout" || frame.type === "stderr")
						emit(frame.data, frame.type === "stderr");
					else if (frame.event === "error") emit(`${frame.error}\n`, true);
				} catch {
					emit(`${value}\n`);
				}
			};
			child.stdout.on("data", (bytes) => {
				pending += bytes;
				let at = pending.indexOf("\n");
				while (at >= 0) {
					line(pending.slice(0, at));
					pending = pending.slice(at + 1);
					at = pending.indexOf("\n");
				}
			});
			child.stdout.on("end", () => {
				if (pending) line(pending);
			});
			child.stderr.on("data", (bytes) => emit(bytes, true));
		}
		if (input !== undefined) {
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		}
		child.on("error", reject);
		child.on("close", (code, signal) => {
			const status = code ?? (signal === "SIGINT" ? 130 : 143);
			if (status && !allowFailure) {
				let code;
				try {
					code = JSON.parse(out.trim().split("\n").at(-1)).code;
				} catch {}
				const error = new Error(
					`${path.basename(command)} failed (${status}); ${code ?? (capture ? err.slice(-1000) : "see command output")}`,
				);
				error.code = code;
				reject(error);
			} else resolve({ status, out, ms: Date.now() - start });
		});
	});
}
const boat = async (argv, opts = {}) =>
	execute(cli, ["--no-update", ...argv], opts);
const json = async (argv) => {
	const result = await boat(["--json", ...argv], { capture: true });
	return parseBoatJson(result.out);
};
const ssh = (id, command, opts = {}) =>
	boat(["ssh", id, "--", "bash", "-lc", command], opts);
const retireWatchers = (id) =>
	ssh(
		id,
		`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && sudo -n "$(mise which node)" --input-type=module -`,
		{ input: fs.readFileSync("scripts/boat-stop-watch.mjs") },
	);
function owned() {
	if (!config || config.root !== root)
		throw new Error("This worktree is not enrolled");
}
async function lock(fn, name = "lifecycle") {
	const lockDir = path.join(dir, `${name}.lock`);
	for (let attempt = 0; ; attempt++) {
		try {
			fs.mkdirSync(lockDir);
			fs.writeFileSync(path.join(lockDir, "pid"), String(process.pid));
			break;
		} catch (e) {
			if (e.code !== "EEXIST") throw e;
			const pid = Number(fs.readFileSync(path.join(lockDir, "pid"), "utf8"));
			try {
				process.kill(pid, 0);
			} catch {
				fs.rmSync(lockDir, { recursive: true, force: true });
				continue;
			}
			if (attempt > 600) throw new Error("Lifecycle lock timed out");
			await wait(500);
		}
	}
	try {
		return await fn();
	} finally {
		fs.rmSync(lockDir, { recursive: true, force: true });
	}
}
function accounting() {
	let dollars = 0;
	for (const name of fs.existsSync(runDir) ? fs.readdirSync(runDir) : []) {
		if (!name.endsWith(".worker.json")) continue;
		const s = read(path.join(runDir, name));
		dollars += s.cost ?? 0;
		if (s.runningSince)
			dollars += estimate(s.size, Date.now() - s.runningSince);
	}
	return dollars;
}
function save(state) {
	write(stateFile, state);
	write(path.join(runDir, `${config.key}.worker.json`), state);
}
function admit() {
	if (accounting() >= 9.9)
		throw new Error(
			"Protective $10 usage cutoff: no new work admitted; stop experiment workers.",
		);
}
async function ensure() {
	return lock(async () => {
		admit();
		let s = read(stateFile);
		let resumed = false;
		let existingInfo;
		if (s.id) {
			try {
				existingInfo = await json(["info", s.id]);
			} catch (error) {
				if (error.code !== "not_found") throw error;
				event("lost-worker", { id: s.id });
				delete s.id;
				delete s.watcher;
				for (const name of ["prepared.json", "manifest.json"])
					fs.rmSync(path.join(dir, name), { force: true });
			}
		}
		if (!s.id) {
			const name = `wallpaperdb-557-${config.cohort}-${config.key}`;
			const listed = await json(["list", "--all"]);
			const matches = listed.sandboxes.filter(
				(worker) =>
					worker.name === name &&
					!worker.dataExpiredAt &&
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
			if (["archived", "stopped"].includes(status)) {
				try {
					await boat(
						["resume", s.id, "--type", config.size, "--ttl", "2100", "--json"],
						{ capture: true },
					);
					s.runningSince = Date.now();
					delete s.watcher;
					resumed = true;
				} catch (error) {
					if (error.code !== "snapshot_data_expired") throw error;
					event("expired", { id: s.id });
					delete s.id;
					for (const name of ["prepared.json", "manifest.json"])
						fs.rmSync(path.join(dir, name), { force: true });
				}
			} else if (!["ready", "running", "idle"].includes(status))
				throw new Error(
					`Worker ${s.id} has state ${status}; inspect before recovery.`,
				);
		}
		if (!s.id) {
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
				id,
				size: config.size,
				cost: s.cost ?? 0,
				runningSince: Date.now(),
				lastActivity: Date.now(),
			};
			save(s);
			event("created", { id });
		}
		s.lastActivity = Date.now();
		save(s);
		await ssh(
			s.id,
			`mkdir -p ${remote}; command -v mise >/dev/null || (curl -fsSL https://mise.run | sh); test -d ${remote}/.git || (git init ${remote} && cd ${remote} && git remote add origin https://github.com/rafaeltab/wallpaperdb.git && git fetch --depth=1 origin ${quote(config.base)} && git checkout --detach FETCH_HEAD)`,
		);
		if (resumed) {
			await retireWatchers(s.id);
			console.log("Remote environment resumed from sleep");
			event("resumed", { id: s.id });
		}
		return { id: s.id, resumed };
	});
}
function manifest() {
	const files = execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
		{ cwd: root },
	)
		.toString()
		.split("\0")
		.filter(Boolean);
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
async function sync(id) {
	return lock(() => syncSource(id, manifest()), "source");
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
	const change = delta(before, after);
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
		await ssh(id, `cd ${remote} && tar -xzf -`, { input: tar });
		event("sync", {
			changed: change.changed.length,
			deleted: change.deleted.length,
			bytes: tar.length,
		});
	} else if (change.deleted.length)
		event("sync", { changed: 0, deleted: change.deleted.length, bytes: 0 });
	write(path.join(dir, "manifest.json"), after);
	if (change.changed.length || change.deleted.length) {
		const s = read(stateFile);
		s.lastActivity = Date.now();
		save(s);
	}
}

function lockGeneration(targets) {
	return (
		targets.length === 3 &&
		targets[0] === "run" &&
		targets.includes("PACKAGE=scripts") &&
		targets.includes("SCRIPT=dependencies:lock")
	);
}
function dependencyState(source) {
	return Object.fromEntries(
		[...new Set(installationInputs(Object.keys(source)))]
			.sort()
			.map((name) => [name, source[name] ?? null]),
	);
}
async function generateLock(id, started) {
	return lock(async () => {
		const staging = fs.mkdtempSync(path.join(runDir, `lock-${config.key}-`));
		fs.chmodSync(staging, 0o700);
		const snapshot = path.join(staging, "source");
		const source = {};
		// Capture bytes once. Hashing live files and later archiving them can send
		// a different input than the one used by the acceptance check.
		for (const name of Object.keys(manifest())) {
			const from = path.join(root, name),
				to = path.join(snapshot, name);
			fs.mkdirSync(path.dirname(to), { recursive: true });
			const stat = fs.lstatSync(from);
			if (stat.isSymbolicLink()) {
				const target = fs.readlinkSync(from);
				fs.symlinkSync(target, to);
				source[name] = hash(target);
			} else if (stat.isFile()) {
				const bytes = fs.readFileSync(from);
				fs.writeFileSync(to, bytes, { mode: stat.mode & 0o777 });
				source[name] = hash(bytes);
			}
		}
		const inputs = dependencyState(source);
		for (const name of Object.keys(inputs)) {
			if (
				inputs[name] !== null &&
				!fs.lstatSync(path.join(snapshot, name)).isFile()
			)
				throw new Error(`Lock generation requires regular input: ${name}`);
		}
		let accepted = false;
		try {
			await syncSource(id, source, snapshot);
			// A failed generator may have changed the worker lock. Force the next
			// sync to restore local authority, including a locally absent output.
			const sent = read(path.join(dir, "manifest.json"));
			write(path.join(dir, "manifest.json"), {
				...sent,
				"pnpm-lock.yaml": null,
			});
			await ssh(
				id,
				`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && mise trust && mise install --locked`,
			);
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
					`export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1; cd ${remote} && mise exec -- make BOAT_EXEC=worker run PACKAGE=scripts SCRIPT=dependencies:lock`,
				],
				{
					allowFailure: true,
					streamFrames: true,
					logPath: path.join(dir, `command-${started}.log`),
				},
			);
			const proposal = path.join(staging, "pnpm-lock.yaml");
			try {
				const collected = await ssh(
					id,
					`cd ${remote} && test ! -L pnpm-lock.yaml && test -f pnpm-lock.yaml && base64 -w0 -- pnpm-lock.yaml`,
					{ capture: true },
				);
				const encoded = collected.out.trim();
				const bytes = Buffer.from(encoded, "base64");
				if (!bytes.length || bytes.toString("base64") !== encoded)
					throw new Error("Invalid lockfile transfer");
				fs.writeFileSync(proposal, bytes, { mode: 0o600 });
			} catch (error) {
				throw new Error(
					`Lock generation output collection failed; retained evidence at ${staging}: ${error.message}`,
				);
			}
			if (result.status !== 0)
				throw new Error(
					`Lock generator failed (${result.status}); proposal retained at ${proposal}`,
				);
			if (
				JSON.stringify(dependencyState(manifest())) !== JSON.stringify(inputs)
			)
				throw new Error(
					`Local dependency inputs or old lock changed; proposal retained at ${proposal}`,
				);
			const output = path.join(root, "pnpm-lock.yaml");
			if (fs.existsSync(output) && !fs.lstatSync(output).isFile())
				throw new Error(
					`Local lock is not regular; proposal retained at ${proposal}`,
				);
			const bytes = fs.readFileSync(proposal);
			// Keep the retained proposal private and replace source atomically on its
			// own filesystem. No event-loop yield between comparison and rename.
			const temporary = path.join(root, `.boat/lock-${process.pid}.tmp`);
			fs.writeFileSync(temporary, bytes, {
				mode: fs.existsSync(output) ? fs.statSync(output).mode & 0o777 : 0o644,
			});
			fs.renameSync(temporary, output);
			const current = read(path.join(dir, "manifest.json"));
			write(path.join(dir, "manifest.json"), {
				...current,
				"pnpm-lock.yaml": hash(bytes),
			});
			accepted = true;
			event("lock-accepted", { hash: hash(bytes) });
			return result;
		} finally {
			fs.rmSync(snapshot, { recursive: true, force: true });
			if (accepted) fs.rmSync(staging, { recursive: true, force: true });
		}
	}, "source");
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
async function stop(remove = false) {
	return lock(async () => {
		const s = read(stateFile);
		if (!s.id) return;
		if (s.runningSince) {
			const initial = workerState(await json(["info", s.id]));
			if (!["stopping", "archived", "stopped"].includes(initial)) {
				await retireWatchers(s.id);
				await json(["stop", s.id]);
			}
			let stopped = false;
			for (let attempt = 0; attempt < 180; attempt++) {
				const state = workerState(await json(["info", s.id]));
				if (["archived", "stopped"].includes(state)) {
					stopped = true;
					break;
				}
				if (state !== "stopping")
					throw new Error(`Unexpected worker state during stop: ${state}`);
				await wait(1000);
			}
			if (!stopped)
				throw new Error(
					"Provider stop did not complete within 180 seconds; worker state must be inspected",
				);
			s.cost = (s.cost ?? 0) + estimate(s.size, Date.now() - s.runningSince);
			s.runningSince = null;
			delete s.watcher;
			save(s);
			event("stopped", { id: s.id, estimatedCost: s.cost });
		}
		const tunnel = read(path.join(dir, "cache-tunnel.json"));
		if (liveOwnedProcess(root, tunnel)) {
			try {
				process.kill(-tunnel.pid, "SIGTERM");
			} catch {}
			fs.rmSync(path.join(dir, "cache-tunnel.json"), { force: true });
		}
		// Keep the provider's authoritative usage separately from the conservative ledger.
		write(path.join(dir, "usage.json"), await json(["usage", s.id]));
		if (remove) {
			await boat(["delete", s.id, "--yes"]);
			event("deleted", { id: s.id });
			delete s.id;
			save(s);
		}
	});
}
async function command() {
	owned();
	admit();
	const targets = args
		.slice(args.indexOf("--") + 1)
		.filter((v) => !v.startsWith("BOAT_EXEC="));
	if (targets[0] === "stop" && !read(stateFile).runningSince) {
		console.log("Remote environment is already stopped");
		return;
	}
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
		if (lockGeneration(targets)) {
			const result = await generateLock(id, started);
			event("command", {
				targets,
				status: result.status,
				ms: Date.now() - started,
				resumed,
			});
			process.exitCode = result.status;
			return;
		}
		await sync(id);
		await prepare(id);
		await cache(id);
		if (
			resumed &&
			config.mode === "development" &&
			read(stateFile).developmentWanted
		) {
			await ssh(
				id,
				`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make run PACKAGE=scripts SCRIPT=boat:stop-watch BOAT_EXEC=worker && make stop BOAT_EXEC=worker && make infra-start BOAT_EXEC=worker && make apps-start ARGS=--no-build BOAT_EXEC=worker`,
			);
			if (targets[0] !== "dev") await watchDevelopment(id);
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
				`export PATH="$HOME/.local/bin:$PATH" WALLPAPERDB_BOAT_WORKER=1 PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/ms-playwright"; cd ${remote} && mise exec -- make BOAT_EXEC=worker ${targets.map(quote).join(" ")}`,
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
		s.developmentWanted = developmentWantedAfterCommand(
			s.developmentWanted,
			targets,
			result.status,
		);
		save(s);
		if (targets[0] === "stop" && result.status === 0) await stop();
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
			await stop();
			return;
		}
		await sync(s.id);
		const fresh = read(stateFile);
		if (
			Date.now() - extended > 60000 &&
			(active || Date.now() - fresh.lastActivity < 60000)
		) {
			await boat(["extend", s.id, "--ttl", "2100"]);
			extended = Date.now();
		}
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
	await prepare(id);
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
	const prior = read(path.join(dir, "preview-process.json"));
	if (liveOwnedProcess(root, prior) && prior.pid !== process.pid) {
		try {
			if (fs.readlinkSync(`/proc/${prior.pid}/cwd`) === root)
				process.kill(prior.pid, "SIGTERM");
		} catch {}
		await wait(500);
	}
	const tunnel = spawn(
		cli,
		[
			"--no-update",
			"forward",
			id,
			"--remote",
			String(port),
			"--local",
			String(privatePort),
		],
		{ stdio: "inherit", detached: true },
	);
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
		const upstream = http.request({
			hostname: "127.0.0.1",
			port: privatePort,
			path: req.url,
			headers: req.headers,
		});
		upstream.on("upgrade", (response, peer, bytes) => {
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
					.map(([k, v]) => `${k}: ${v}`)
					.join("\r\n")}\r\n\r\n`,
			);
			peer.write(head);
			socket.write(bytes);
			socket.pipe(peer).pipe(socket);
		});
		upstream.on("error", () => socket.destroy());
		upstream.end();
	});
	await new Promise((resolve, reject) =>
		server.listen(port, "127.0.0.1", resolve).once("error", reject),
	);
	write(
		path.join(dir, "preview-process.json"),
		worktreeProcesses(root).find((p) => p.pid === process.pid),
	);
	process.once("exit", () => {
		if (read(path.join(dir, "preview-process.json")).pid === process.pid)
			fs.rmSync(path.join(dir, "preview-process.json"), { force: true });
	});
	console.log(
		`Private preview proxy http://localhost:${port}/web; application health passed. Authentication must still be verified in the browser.`,
	);
	const sockets = new Set();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	const close = () => {
		try {
			process.kill(-tunnel.pid, "SIGTERM");
		} catch {}
		for (const socket of sockets) socket.destroy();
		server.close();
	};
	process.once("exit", () => {
		try {
			process.kill(-tunnel.pid, "SIGTERM");
		} catch {}
	});
	process.on("SIGINT", close);
	process.on("SIGTERM", close);
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
	if (action === "enroll") {
		const [mode = "validation", size = "large", cohort = "smoke"] = args;
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
	} else if (action === "stop" || action === "delete") {
		owned();
		await stop(action === "delete");
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
		else if (read(stateFile).runningSince) {
			event("settle-stop", { owners: owners.owners });
			const id = read(stateFile).id;
			await ssh(
				id,
				`export PATH="$HOME/.local/bin:$PATH"; cd ${remote} && make stop BOAT_EXEC=worker`,
			);
			await stop();
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
