import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { makeCommand } from "./boat-hillclimb.mjs";
import {
	parseSourceAuthority,
	sourceIdentity,
	verifySourceIdentity,
	resetOwnedSource,
} from "./boat-source-identity.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const mono = () => Number(process.hrtime.bigint()) / 1e9;
function pinned(pin) {
	const s = fs.lstatSync(pin.path);
	assert(s.isFile() && !s.isSymbolicLink(), "Pinned input must be regular");
	assert(
		Number.isSafeInteger(pin.bytes) && pin.bytes >= 0,
		"Invalid pinned length",
	);
	assert(
		Number.isSafeInteger(pin.mode) && pin.mode >= 0 && pin.mode <= 0o777,
		"Invalid pinned mode",
	);
	const bytes = fs.readFileSync(pin.path);
	assert(
		bytes.length === pin.bytes &&
			sha(bytes) === pin.sha256 &&
			(s.mode & 0o777) === pin.mode,
		`Pinned input changed: ${pin.path}`,
	);
	return bytes;
}
function save(file, value) {
	const fd = fs.openSync(file, "wx", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function stateIdentity(state) {
	return {
		worker: state.id,
		admission: state.admission?.token,
		runningSince: state.runningSince,
		snapshotRecovery: state.snapshotRecovery,
		stop: state.shutdownAttempt?.completion?.provider?.stop,
		accountingAppliedAt: state.shutdownAttempt?.accountingAppliedAt,
		cost: state.cost,
	};
}

// This is the fixed 9 tracked + 19 untracked #547 source reset, not admission,
// fresh-worker creation, a generic workflow engine, or a caller timeout option.
export async function prepare547Source({ authority: pin, evidence }) {
	const deadline = mono() + 180;
	const authority = parseSourceAuthority(pinned(pin));
	const root = authority.root;
	assert(
		typeof root === "string" &&
			path.resolve(root) === root &&
			fs.realpathSync(root) === root,
		"Invalid source worktree",
	);
	assert(
		typeof evidence === "string" &&
			path.isAbsolute(evidence) &&
			!evidence.startsWith(root + path.sep),
		"Evidence must be outside source worktree",
	);
	assert(
		Array.isArray(authority.files) && authority.files.length === 28,
		"Expected 28 owned paths",
	);
	assert(
		Array.isArray(authority.controls) && authority.controls.length === 11,
		"Expected 11 control pins",
	);
	assert(
		Array.isArray(authority.selectedTrackedRestores) &&
			authority.selectedTrackedRestores.length === 9,
		"Expected 9 tracked restores",
	);
	const names = new Set();
	for (const file of authority.files) {
		assert(
			file.relative &&
				!file.relative.split("/").some((p) => !p || p === "." || p === "..") &&
				file.path === path.join(root, file.relative) &&
				!names.has(file.path),
			"Invalid owned source path",
		);
		names.add(file.path);
		assert([" M", "??"].includes(file.gitStatus), "Invalid owned Git status");
		verifySourceIdentity(file); // Reject unsafe decoded objects before any Make.
	}
	assert(
		authority.files.filter((f) => f.gitStatus === "??").length === 19,
		"Expected 19 untracked paths",
	);
	const checkDeadline = () =>
		assert(mono() < deadline, "Original source preparation deadline exceeded");
	const git = (...args) => {
		checkDeadline();
		return execFileSync("git", ["--no-optional-locks", ...args], {
			cwd: root,
			timeout: Math.max(1, Math.floor((deadline - mono()) * 1000)),
			maxBuffer: 32 * 1024 * 1024,
		});
	};
	const sourceLock = path.join(root, ".boat/source.lock");
	let ownedLock;
	const quiet = () => {
		for (const file of [
			"source-writer.json",
			"lifecycle.lock",
			"preview-process.json",
		])
			assert(
				!fs.existsSync(path.join(root, ".boat", file)),
				`Source ownership is active: ${file}`,
			);
		if (ownedLock) {
			const current = fs.lstatSync(sourceLock, { bigint: true });
			assert(
				current.ino === ownedLock.directory.ino &&
					current.dev === ownedLock.directory.dev &&
					fs.readFileSync(path.join(sourceLock, "pid"), "utf8") ===
						String(process.pid),
				"Source lock superseded",
			);
		} else
			assert(
				!fs.existsSync(sourceLock),
				"Source ownership is active: source.lock",
			);
		assert(
			!fs
				.readdirSync(path.join(root, ".boat"))
				.some((p) => /^command-.*\.json$/.test(p)),
			"Source command lease is active",
		);
	};
	const controls = () => {
		for (const p of authority.controls) pinned(p);
	};
	const verify = () => {
		checkDeadline();
		quiet();
		for (const file of authority.files) verifySourceIdentity(file);
	};
	const stateFile = path.join(root, ".boat/state.json");
	const externalState = path.join(
		process.env.HOME,
		".local/state/wallpaperdb-boat/557",
		`${authority.key}.worker.json`,
	);
	const expectedControls = [
		".git",
		".worktree",
		".boat/state.json",
		".boat/enrollment.json",
		".boat/source-modes.json",
		".boat/manifest.json",
		".boat/usage.json",
		".boat/cache-server.json",
		".boat/cache.json",
	].map((p) => path.join(root, p));
	const index = git("rev-parse", "--git-path", "index").toString().trim();
	expectedControls.push(externalState, path.resolve(root, index));
	assert.deepEqual(
		authority.controls.map((p) => p.path).sort(),
		expectedControls.sort(),
		"Source control authority changed",
	);
	controls();
	verify();
	const before = json(stateFile),
		enrollment = json(path.join(root, ".boat/enrollment.json"));
	assert(
		typeof before.id === "string" &&
			/^[A-Za-z0-9_-]+$/.test(before.id) &&
			typeof before.admission?.token === "string" &&
			/^[A-Za-z0-9_-]+$/.test(before.admission.token),
		"Expected complete stop worker/admission identities",
	);
	assert(
		enrollment.root === root &&
			enrollment.key === authority.key &&
			sha(root).slice(0, 12) === authority.key,
		"Worktree enrollment identity changed",
	);
	assert(
		before.id === authority.worker &&
			before.admission?.token === authority.admission &&
			typeof authority.developmentWanted === "boolean" &&
			before.admission?.status === "published" &&
			before.admission?.candidate?.id === before.id &&
			before.admission?.owner?.root === root &&
			before.admission?.owner?.key === authority.key &&
			before.runningSince === null &&
			before.developmentWanted === authority.developmentWanted &&
			before.snapshotRecovery?.status === "DIRTY" &&
			before.shutdownAttempt?.status === "completed-observed",
		"Expected exact stopped source owner",
	);
	assert(
		before.shutdownAttempt.completion.status === "stopped" &&
			before.shutdownAttempt.completion.provider.stop.status === "completed" &&
			before.shutdownAttempt.completion.provider.stop.forced === false &&
			before.shutdownAttempt.completion.provider.stop.error === null &&
			typeof authority.accountingAppliedAt === "string" &&
			Number.isFinite(Date.parse(authority.accountingAppliedAt)),
		"Expected completed nonforced accounted stop",
	);
	assert.deepEqual(
		before.shutdownAttempt.completion.provider.stop,
		authority.stop,
		"Physical stop changed",
	);
	assert.deepEqual(
		before.snapshotRecovery,
		authority.snapshotRecovery,
		"DIRTY authority changed",
	);
	assert.equal(
		before.shutdownAttempt.accountingAppliedAt,
		authority.accountingAppliedAt,
		"Accounting changed",
	);
	assert.equal(
		String(before.cost),
		authority.cost,
		"Saved accounting balance changed",
	);
	assert.deepEqual(
		fs.readFileSync(stateFile),
		fs.readFileSync(externalState),
		"External owner changed",
	);
	assert.equal(
		git("rev-parse", "HEAD").toString().trim(),
		authority.head,
		"Selected revision changed",
	);
	assert.equal(
		git("rev-parse", "HEAD^{tree}").toString().trim(),
		authority.tree,
		"Selected tree changed",
	);
	assert.equal(
		git("status", "--porcelain=v1", "-uall", "-z")
			.toString()
			.replaceAll("\0", "\n"),
		authority.statusText,
		"Owned Git status changed",
	);
	const restored = new Map();
	for (const target of authority.selectedTrackedRestores) {
		const file = authority.files.find(
			(f) => f.relative === target.relative && f.gitStatus === " M",
		);
		assert(
			file &&
				["100644", "100755"].includes(target.gitMode) &&
				!restored.has(file.path) &&
				target.selectedRevision === authority.head &&
				target.preserveFilesystemMode === file.mode,
			"Invalid tracked restore authority",
		);
		assert.equal(
			git("rev-parse", `${authority.head}:${file.relative}`).toString().trim(),
			target.gitBlob,
			"Restore Git blob changed",
		);
		const bytes = git("cat-file", "blob", target.gitBlob);
		assert(
			bytes.length === target.bytes && sha(bytes) === target.sha256,
			"Restore payload changed",
		);
		assert.equal(
			Boolean(parseInt(target.gitMode, 8) & 0o111),
			Boolean(file.mode & 0o111),
			"Restore mode changed",
		);
		restored.set(file.path, bytes);
	}
	assert.equal(restored.size, 9);
	fs.mkdirSync(evidence, { mode: 0o700 }); // Exclusive destination; never overwrite old evidence.
	const result = {
		status: "FAIL",
		root,
		makeInvocations: 0,
		mutations: 0,
		archiveVerified: false,
	};
	let operationFailure, releaseFailure;
	try {
		if (before.developmentWanted) {
			result.makeInvocations++;
			// Explicit existing routing override defeats an outer local coordinator's
			// BOAT_EXEC value. The enrolled controller still owns the stopped path.
			const receipt = await makeCommand(["make", "stop", "BOAT_EXEC=remote"], {
				cwd: root,
				directory: path.join(evidence, "intent"),
				deadline,
				disposalMs: 5000,
				env: {
					...process.env,
					BOAT_EXPECTED_WORKER_ID: before.id,
					BOAT_EXPECTED_ADMISSION: before.admission.token,
				},
			});
			const disposal = json(path.join(evidence, "intent/disposal.json"));
			assert.deepEqual(
				receipt.terminal,
				{ code: 0, signal: null },
				"Ordinary intent command failed",
			);
			assert.deepEqual(
				disposal.terminal,
				receipt.terminal,
				"Ordinary intent terminal changed",
			);
			assert(
				receipt.captureComplete &&
					disposal.pipesClosed &&
					!disposal.unresolved.length,
				"Ordinary intent capture did not drain",
			);
			for (const stream of ["stdout", "stderr"]) {
				const bytes = fs.readFileSync(
					path.join(evidence, "intent", `${stream}.raw`),
				);
				assert(
					bytes.length === receipt.files[stream].bytes &&
						sha(bytes) === receipt.files[stream].sha256 &&
						!receipt.files[stream].overflow,
					"Ordinary intent raw integrity changed",
				);
			}
			assert(
				fs
					.readFileSync(path.join(evidence, "intent/stdout.raw"), "utf8")
					.includes(
						"development intent cleared; physical cleanup was not performed; snapshot remains DIRTY.",
					),
				"Expected ordinary cleanupSkipped path",
			);
		}
		assert.deepEqual(
			stateIdentity(json(stateFile)),
			stateIdentity(before),
			"Stopped owner/accounting changed",
		);
		assert.equal(
			json(stateFile).developmentWanted,
			false,
			"Development intent remains active",
		);
		assert.deepEqual(
			fs.readFileSync(stateFile),
			fs.readFileSync(externalState),
			"External owner changed",
		);
		verify(); // Same exact decoder and native comparison after the Make boundary.
		fs.mkdirSync(sourceLock, { mode: 0o700 });
		ownedLock = {
			directory: fs.lstatSync(sourceLock, { bigint: true }),
			pid: null,
			published: false,
		};
		const pidFile = fs.openSync(path.join(sourceLock, "pid"), "wx", 0o600);
		try {
			ownedLock.pid = fs.fstatSync(pidFile, { bigint: true });
			fs.writeFileSync(pidFile, String(process.pid));
			fs.fsyncSync(pidFile);
			ownedLock.published = true;
		} finally {
			fs.closeSync(pidFile);
		}
		const mutableControls = new Set([
			stateFile,
			path.join(root, ".boat/usage.json"),
			externalState,
		]);
		const controlBytes = authority.controls.map((p) => {
			const stat = fs.lstatSync(p.path);
			assert(
				stat.isFile() &&
					!stat.isSymbolicLink() &&
					(stat.mode & 0o777) === p.mode,
				"Preserved control type/mode changed",
			);
			const bytes = mutableControls.has(p.path)
				? fs.readFileSync(p.path)
				: pinned(p);
			return { ...p, bytes: bytes.length, sha256: sha(bytes), content: bytes };
		});
		const archive = path.join(evidence, "archive");
		fs.mkdirSync(archive, { mode: 0o700 });
		const entries = [];
		for (const [i, file] of authority.files.entries())
			entries.push({
				file: `source-${i}`,
				bytes: verifySourceIdentity(file),
				original: file,
			});
		for (const [i, p] of controlBytes.entries())
			entries.push({
				file: `control-${i}`,
				bytes: p.content,
				original: {
					path: p.path,
					bytes: p.bytes,
					sha256: p.sha256,
					mode: p.mode,
				},
			});
		for (const entry of entries) {
			const file = path.join(archive, entry.file);
			fs.writeFileSync(file, entry.bytes, {
				flag: "wx",
				mode: entry.original.mode,
			});
			fs.chmodSync(file, entry.original.mode);
			const fd = fs.openSync(file, "r");
			try {
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			assert.deepEqual(
				fs.readFileSync(file),
				entry.bytes,
				"Archive copy changed",
			);
		}
		save(
			path.join(archive, "manifest.json"),
			entries.map(({ file, bytes, original }) => ({
				file,
				bytes: bytes.length,
				sha256: sha(bytes),
				mode: original.mode,
				original,
			})),
		);
		result.archiveVerified = true;
		verify();
		for (const file of authority.files) {
			checkDeadline();
			quiet();
			assert.deepEqual(
				stateIdentity(json(stateFile)),
				stateIdentity(before),
				"Source owner superseded",
			);
			assert.equal(
				json(stateFile).developmentWanted,
				false,
				"Source intent changed",
			);
			resetOwnedSource(file, restored.get(file.path) ?? null);
			result.mutations++;
		}
		for (const file of authority.files) {
			const bytes = restored.get(file.path);
			if (!bytes)
				assert.equal(
					fs.lstatSync(file.path, { throwIfNoEntry: false }),
					undefined,
					"Deleted input returned",
				);
			else {
				assert.deepEqual(
					fs.readFileSync(file.path),
					bytes,
					"Restored bytes changed",
				);
				const final = sourceIdentity(file.path);
				for (const key of [
					"path",
					"device",
					"inode",
					"uid",
					"gid",
					"mode",
					"linkCount",
				])
					assert.equal(
						final[key],
						file[key],
						`Restored ownership changed: ${key}`,
					);
			}
		}
		for (const p of controlBytes)
			assert.deepEqual(
				fs.readFileSync(p.path),
				p.content,
				"Preserved control changed",
			);
		assert.deepEqual(
			stateIdentity(json(stateFile)),
			stateIdentity(before),
			"Final stopped identity changed",
		);
		assert.equal(
			git("status", "--porcelain=v1", "-uall").length,
			0,
			"Source worktree is not clean",
		);
		assert.equal(
			git("rev-parse", "HEAD").toString().trim(),
			authority.head,
			"Final revision changed",
		);
		checkDeadline();
		quiet();
		result.status = "PASS_OWNED_SOURCE_PREPARATION";
		result.restored = authority.files
			.filter((f) => restored.has(f.path))
			.map((f) => sourceIdentity(f.path));
	} catch (error) {
		result.status = "FAIL";
		result.error = error.message;
		error.sourcePreparationStarted = true;
		operationFailure = error;
	} finally {
		if (ownedLock) {
			try {
				const current = fs.lstatSync(sourceLock, { bigint: true });
				assert(
					current.isDirectory() &&
						current.ino === ownedLock.directory.ino &&
						current.dev === ownedLock.directory.dev,
					"Source lock superseded; foreign lock retained",
				);
				const entries = fs.readdirSync(sourceLock);
				if (ownedLock.pid) {
					const currentPid = fs.lstatSync(path.join(sourceLock, "pid"), {
						bigint: true,
					});
					assert(
						entries.length === 1 &&
							entries[0] === "pid" &&
							currentPid.isFile() &&
							currentPid.nlink === 1n &&
							currentPid.ino === ownedLock.pid.ino &&
							currentPid.dev === ownedLock.pid.dev &&
							(!ownedLock.published ||
								fs.readFileSync(path.join(sourceLock, "pid"), "utf8") ===
									String(process.pid)),
						"Source PID entry superseded; foreign lock retained",
					);
					fs.unlinkSync(path.join(sourceLock, "pid"));
				} else
					assert.equal(entries.length, 0, "Unowned source lock entry retained");
				fs.rmdirSync(sourceLock);
			} catch (error) {
				releaseFailure = error;
				error.sourcePreparationStarted = true;
				result.cleanupError = error.message;
				result.status = "FAIL";
			}
		}
	}
	try {
		save(path.join(evidence, "result.json"), result);
	} catch (error) {
		const failure = new AggregateError(
			[operationFailure, releaseFailure, error].filter(Boolean),
			[operationFailure?.message, releaseFailure?.message, error.message]
				.filter(Boolean)
				.join("; "),
		);
		failure.sourcePreparationStarted = true;
		throw failure;
	}
	if (operationFailure) throw operationFailure;
	if (releaseFailure) throw releaseFailure;
	return result;
}
