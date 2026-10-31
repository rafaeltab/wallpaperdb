import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { installationInputs } from "./boat-preparation.mjs";

const migrations = "apps/asset/drizzle";
const journalPath = `${migrations}/meta/_journal.json`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Exactly two maintained commands. This is not an arbitrary generator launcher.
export function sourceGeneration(targets) {
	if (targets[0] !== "run") return null;
	const kind =
		targets.includes("PACKAGE=scripts") &&
		targets.includes("SCRIPT=dependencies:lock")
			? "lock"
			: targets.includes("PACKAGE=asset") &&
					targets.includes("SCRIPT=db:generate")
				? "migrations"
				: null;
	if (kind && targets.length !== 3)
		throw new Error(
			"Source generation supports only the maintained package/script selectors; extra arguments are unsupported",
		);
	return kind;
}

function sourceStat(root, name) {
	const parts = name.split("/");
	if (parts.some((p) => !p || p === "." || p === ".."))
		throw new Error(`Invalid source path: ${name}`);
	for (let i = 1; i < parts.length; i++)
		if (!fs.lstatSync(path.join(root, ...parts.slice(0, i))).isDirectory())
			throw new Error(`Generation requires in-root ancestors: ${name}`);
	return fs.lstatSync(path.join(root, name));
}
function regular(root, name) {
	if (!sourceStat(root, name).isFile())
		throw new Error(`Generation requires regular in-root source: ${name}`);
	return fs.readFileSync(path.join(root, name));
}

function migrationName(name) {
	return (
		name === journalPath ||
		/^apps\/asset\/drizzle\/\d{4}_[\w-]+\.sql$/.test(name) ||
		/^apps\/asset\/drizzle\/meta\/\d{4}_snapshot\.json$/.test(name)
	);
}
const maxTransferBytes = 32 * 1024 * 1024,
	maxFileBytes = 8 * 1024 * 1024,
	maxFiles = 4096;
function migrationFiles(root) {
	const result = {};
	function visit(name) {
		const stat = fs.lstatSync(path.join(root, name));
		if (stat.isDirectory()) {
			if (name !== migrations && name !== `${migrations}/meta`)
				throw new Error(`Invalid migration directory: ${name}`);
			for (const entry of fs.readdirSync(path.join(root, name)).sort())
				visit(`${name}/${entry}`);
		} else {
			if (!migrationName(name))
				throw new Error(`Invalid migration path: ${name}`);
			if (Object.keys(result).length >= maxFiles)
				throw new Error("Migration file count limit exceeded");
			const stat = fs.lstatSync(path.join(root, name));
			if (stat.size > maxFileBytes)
				throw new Error("Migration file size limit exceeded");
			result[name] = regular(root, name);
		}
	}
	// Also reject symlink ancestors of an otherwise regular output directory.
	for (const name of ["apps", "apps/asset", migrations])
		if (!fs.lstatSync(path.join(root, name)).isDirectory())
			throw new Error(`Invalid migration directory: ${name}`);
	visit(migrations);
	if (
		Object.values(result).reduce((total, b) => total + b.length, 0) >
		maxTransferBytes
	)
		throw new Error("Migration transfer size limit exceeded");
	return result;
}
function validateMigrations(files) {
	const journal = JSON.parse(files[journalPath]);
	if (
		journal.version !== "7" ||
		journal.dialect !== "postgresql" ||
		!Array.isArray(journal.entries)
	)
		throw new Error("Invalid migration journal");
	const origin = "00000000-0000-0000-0000-000000000000";
	const expected = new Set([journalPath]),
		ids = new Set([origin]);
	let previous = origin,
		when = -1;
	for (const [idx, entry] of journal.entries.entries()) {
		const prefix = String(idx).padStart(4, "0");
		if (
			entry.idx !== idx ||
			entry.version !== "7" ||
			typeof entry.breakpoints !== "boolean" ||
			!Number.isSafeInteger(entry.when) ||
			entry.when <= when ||
			!new RegExp(`^${prefix}_[\\w-]+$`).test(entry.tag)
		)
			throw new Error("Inconsistent migration journal entry");
		const sql = `${migrations}/${entry.tag}.sql`,
			snapshot = `${migrations}/meta/${prefix}_snapshot.json`;
		if (!files[sql]?.length || !files[snapshot]?.length)
			throw new Error("Incomplete journal SQL/snapshot set");
		const value = JSON.parse(files[snapshot]);
		if (
			value.version !== "7" ||
			value.dialect !== "postgresql" ||
			value.prevId !== previous ||
			typeof value.id !== "string" ||
			!/^[a-f0-9-]{36}$/.test(value.id) ||
			ids.has(value.id) ||
			!value.tables ||
			typeof value.tables !== "object"
		)
			throw new Error("Inconsistent migration snapshot chain");
		ids.add(value.id);
		previous = value.id;
		when = entry.when;
		expected.add(sql);
		expected.add(snapshot);
	}
	if (
		Object.keys(files).some((name) => !expected.has(name)) ||
		Object.keys(files).length !== expected.size
	)
		throw new Error("Migration files do not match journal membership");
	return journal;
}
function inputState(source, kind, outputs, root) {
	const names = installationInputs(Object.keys(source));
	if (kind === "migrations")
		names.push(
			"Makefile",
			"scripts/boat.mjs",
			"scripts/boat-route.mk",
			"scripts/mise-shell.sh",
			"scripts/boat-shell.mjs",
			"scripts/toolchain.mjs",
			"scripts/lib/boat-source-generation.mjs",
			"scripts/lib/boat-preparation.mjs",
			"scripts/lib/boat-snapshot.mjs",
			"scripts/lib/boat-shutdown.mjs",
			"scripts/lib/boat.mjs",
			"scripts/lib/boat-cache.mjs",
			"scripts/lib/boat-asset-migration.mjs",
			"tsconfig.json",
			".pnpmfile.cjs",
			"pnpmfile.cjs",
		);
	if (kind === "migrations")
		names.push(
			...Object.keys(source).filter(
				(name) =>
					name.startsWith("apps/asset/") || name.startsWith("packages/"),
			),
		);
	return Object.fromEntries(
		[...new Set([...names, ...Object.keys(outputs)])].sort().map((name) => [
			name,
			(outputs[name] ? hash(outputs[name]) : source[name])
				? {
						hash: outputs[name] ? hash(outputs[name]) : source[name],
						mode: fs.lstatSync(path.join(root, name)).mode & 0o777,
					}
				: null,
		]),
	);
}
function capture(root, snapshot, names, kind) {
	const source = {};
	for (const name of names) {
		const from = path.join(root, name),
			to = path.join(snapshot, name);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		const stat = sourceStat(root, name);
		if (stat.isSymbolicLink()) {
			const target = fs.readlinkSync(from);
			fs.symlinkSync(target, to);
			source[name] = hash(target);
		} else if (stat.isFile()) {
			const bytes = fs.readFileSync(from);
			fs.writeFileSync(to, bytes, { mode: stat.mode & 0o777 });
			fs.chmodSync(to, stat.mode & 0o777);
			source[name] = hash(bytes);
		}
	}
	const outputs = kind === "migrations" ? migrationFiles(root) : {};
	// Include ignored or untracked output files in membership and capture checks.
	for (const [name, bytes] of Object.entries(outputs)) {
		const to = path.join(snapshot, name);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.writeFileSync(to, bytes, {
			mode: fs.lstatSync(path.join(root, name)).mode & 0o777,
		});
		fs.chmodSync(to, fs.lstatSync(path.join(root, name)).mode & 0o777);
		source[name] = hash(bytes);
	}
	const inputs = inputState(source, kind, outputs, snapshot);
	for (const name of Object.keys(inputs))
		if (
			inputs[name] !== null &&
			hash(regular(root, name)) !== inputs[name].hash
		)
			throw new Error(`Source changed during capture: ${name}`);
	return { source, inputs, outputs };
}

function saveIntent(root, intent) {
	const file = path.join(root, ".boat/migration-publication.json"),
		tmp = `${file}.tmp`;
	const fd = fs.openSync(tmp, "w", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(intent));
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(tmp, file);
	const dir = fs.openSync(path.dirname(file), "r");
	try {
		fs.fsyncSync(dir);
	} finally {
		fs.closeSync(dir);
	}
}
function finishPublication(root) {
	const file = path.join(root, ".boat/migration-publication.json");
	if (!fs.existsSync(file)) return;
	const intent = JSON.parse(fs.readFileSync(file));
	if (
		path.dirname(intent.staging) !== path.join(root, ".boat") ||
		!path.basename(intent.staging).startsWith("migration-accept-")
	)
		throw new Error("Unsafe publication staging intent");
	fs.rmSync(file);
	fs.rmSync(intent.staging, { recursive: true, force: true });
}
// Every controller source consumer recovers before it scans or sends snapshots.
// This is process-crash recovery under source.lock, not a filesystem snapshot.
export function recoverPublication(root, accept) {
	const file = path.join(root, ".boat/migration-publication.json");
	if (!fs.existsSync(file)) return;
	const intent = JSON.parse(fs.readFileSync(file));
	const current = hash(regular(root, journalPath));
	if (current === intent.oldJournal) {
		const owned = [];
		for (const entry of intent.additions) {
			if (!migrationName(entry.name))
				throw new Error("Unsafe publication intent");
			try {
				const stat = fs.lstatSync(path.join(root, entry.name));
				if (
					!stat.isFile() ||
					stat.ino !== entry.ino ||
					stat.dev !== entry.dev ||
					(stat.mode & 0o777) !== entry.mode ||
					hash(regular(root, entry.name)) !== entry.hash
				)
					throw new Error(
						"Local migration recovery conflict; preserve edited addition",
					);
				owned.push(entry.name);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		for (const name of owned) fs.unlinkSync(path.join(root, name));
	} else if (current === intent.newJournal) {
		const files = migrationFiles(root);
		validateMigrations(files);
		const actual = Object.fromEntries(
			Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
		);
		if (
			JSON.stringify(actual) !== JSON.stringify(intent.outputs) ||
			Object.entries(intent.modes).some(
				([name, mode]) =>
					(fs.lstatSync(path.join(root, name)).mode & 0o777) !== mode,
			)
		)
			throw new Error("Committed migration recovery conflict");
		accept(intent.outputs, intent.workerId);
	} else
		throw new Error(
			"Local journal recovery conflict; preserve source and intent",
		);
	finishPublication(root);
}

// Publish append-only Drizzle output using the journal as commit point. Existing
// metadata is immutable. Exclusive links never overwrite a concurrent new path.
// Readers following either old or new journal always have all referenced files.
function acceptMigrations(root, files, old, check, proposal, modes, workerId) {
	const journal = validateMigrations(files),
		before = validateMigrations(old);
	if (
		(journal.entries.length !== before.entries.length &&
			journal.entries.length !== before.entries.length + 1) ||
		JSON.stringify({ ...journal, entries: before.entries }) !==
			JSON.stringify(before) ||
		JSON.stringify(journal.entries.slice(0, before.entries.length)) !==
			JSON.stringify(before.entries)
	)
		throw new Error("Generator rewrote old journal entries");
	for (const [name, bytes] of Object.entries(old))
		if (name !== journalPath && !files[name]?.equals(bytes))
			throw new Error(`Generator rewrote old migration: ${name}`);
	const additions = Object.keys(files).filter((name) => !old[name]);
	if (!additions.length && files[journalPath].equals(old[journalPath])) return;
	const staging = fs.mkdtempSync(path.join(root, ".boat/migration-accept-")),
		published = [];
	try {
		for (const [index, name] of additions.entries()) {
			fs.writeFileSync(path.join(staging, String(index)), files[name], {
				mode: modes[name],
			});
			fs.chmodSync(path.join(staging, String(index)), modes[name]);
		}
		fs.writeFileSync(path.join(staging, "journal"), files[journalPath], {
			mode: fs.statSync(path.join(root, journalPath)).mode & 0o777,
		});
		fs.chmodSync(
			path.join(staging, "journal"),
			fs.statSync(path.join(root, journalPath)).mode & 0o777,
		);
		const intent = {
			workerId,
			modes: Object.fromEntries(
				Object.keys(files).map((name) => [
					name,
					old[name]
						? fs.statSync(path.join(root, name)).mode & 0o777
						: modes[name],
				]),
			),
			oldJournal: hash(old[journalPath]),
			newJournal: hash(files[journalPath]),
			staging,
			proposal,
			outputs: Object.fromEntries(
				Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
			),
			additions: additions.map((name, index) => {
				const stat = fs.lstatSync(path.join(staging, String(index)));
				return {
					name,
					hash: hash(files[name]),
					ino: stat.ino,
					dev: stat.dev,
					mode: stat.mode & 0o777,
				};
			}),
		};
		saveIntent(root, intent);
		check();
		for (const [index, name] of additions.entries()) {
			fs.linkSync(path.join(staging, String(index)), path.join(root, name));
			published.push({
				name,
				stat: fs.lstatSync(path.join(root, name)),
				bytes: files[name],
			});
		}
		// Recheck all inputs and old outputs after adding files, allowing only our
		// exact inodes. Rollback checks inode, mode and bytes before removing additions.
		check(published);
		// Optimistic comparison: source.lock excludes controller writers. An external
		// editor can still race the final check/rename syscalls; no OS CAS is claimed.
		fs.renameSync(path.join(staging, "journal"), path.join(root, journalPath));
		// The intent remains until output bookkeeping is complete. A restart must
		// distinguish this committed set from pre-commit orphan snapshots.
	} catch (error) {
		for (const { name, stat, bytes } of published.reverse()) {
			try {
				const file = path.join(root, name),
					current = fs.lstatSync(file);
				if (
					current.ino === stat.ino &&
					current.dev === stat.dev &&
					(current.mode & 0o777) === (stat.mode & 0o777) &&
					current.isFile() &&
					fs.readFileSync(file).equals(bytes)
				)
					fs.unlinkSync(file);
			} catch (e) {
				if (e.code !== "ENOENT") throw e;
			}
		}
		try {
			recoverPublication(root, () => {});
		} catch {
			/* Keep unresolved local edits and recovery intent. */
		}
		throw error;
	} finally {
		if (!fs.existsSync(path.join(root, ".boat/migration-publication.json")))
			fs.rmSync(staging, { recursive: true, force: true });
	}
}

// Controller owns transport and source.lock. Both generators share capture,
// immutable upload, collection, conflict checks and sync acknowledgement here.
export async function generateSource({
	kind,
	root,
	stagingRoot,
	names,
	transport,
}) {
	const staging = fs.mkdtempSync(path.join(stagingRoot, `${kind}-`));
	fs.chmodSync(staging, 0o700);
	const snapshot = path.join(staging, "source");
	const proposal =
		kind === "lock"
			? path.join(staging, "pnpm-lock.yaml")
			: path.join(staging, "proposal");
	let accepted = false;
	try {
		transport.assertStopped();
		recoverPublication(root, transport.accept);
		const { source, inputs, outputs } = capture(root, snapshot, names(), kind);
		if (kind === "migrations") validateMigrations(outputs);
		await transport.sync(source, snapshot);
		transport.invalidate(kind, Object.keys(outputs));
		await transport.prepare(kind);
		if (kind === "migrations") await transport.verify(inputs);
		const result = await transport.generate(kind);
		let files;
		const modes = {};
		try {
			const encoded = await transport.collect(kind);
			if (kind === "lock") {
				const text = encoded.trim(),
					bytes = Buffer.from(text, "base64");
				if (!bytes.length || bytes.toString("base64") !== text)
					throw new Error("Invalid lockfile transfer");
				fs.writeFileSync(proposal, bytes, { mode: 0o600 });
				files = { "pnpm-lock.yaml": bytes };
			} else {
				if (Buffer.byteLength(encoded) > maxTransferBytes * 1.5)
					throw new Error("Migration transfer size limit exceeded");
				fs.mkdirSync(proposal, { mode: 0o700 });
				// Retain raw rejected transport separately; never extract remote archives.
				fs.writeFileSync(path.join(staging, "collection.json"), encoded, {
					mode: 0o600,
				});
				const pairs = JSON.parse(encoded);
				if (!Array.isArray(pairs) || pairs.length > maxFiles)
					throw new Error("Invalid migration transfer");
				files = {};
				for (const record of pairs) {
					const { name, data: text, type, size, sha256, mode } = record ?? {};
					if (
						typeof name !== "string" ||
						name.length > 512 ||
						type !== "file" ||
						!Number.isInteger(mode) ||
						mode < 0 ||
						mode > 0o666 ||
						(mode & ~0o666) !== 0 ||
						!Number.isSafeInteger(size) ||
						size < 1 ||
						!migrationName(name) ||
						Object.hasOwn(files, name) ||
						typeof text !== "string"
					)
						throw new Error("Invalid migration transfer path");
					const bytes = Buffer.from(text, "base64");
					if (
						!bytes.length ||
						bytes.toString("base64") !== text ||
						size !== bytes.length ||
						sha256 !== hash(bytes)
					)
						throw new Error("Invalid migration transfer bytes");
					if (bytes.length > maxFileBytes)
						throw new Error("Migration file size limit exceeded");
					files[name] = bytes;
					modes[name] = mode;
					const file = path.join(proposal, name);
					fs.mkdirSync(path.dirname(file), { recursive: true });
					fs.writeFileSync(file, bytes, { mode: 0o600 });
				}
				if (
					Object.values(files).reduce((total, b) => total + b.length, 0) >
					maxTransferBytes
				)
					throw new Error("Migration transfer size limit exceeded");
				validateMigrations(files);
				await transport.verify(
					Object.fromEntries(
						Object.entries(inputs).filter(
							([name]) => !name.startsWith(`${migrations}/`),
						),
					),
				);
			}
		} catch (error) {
			throw new Error(
				`${kind === "lock" ? "Lock" : "Migration"} generation output collection failed; retained evidence at ${staging}: ${error.message}`,
			);
		}
		if (result.status !== 0)
			throw new Error(
				`${kind === "lock" ? "Lock" : "Migration"} generator failed (${result.status}); proposal retained at ${proposal}`,
			);
		if (kind === "migrations") {
			if (result.outputOverflow)
				throw new Error("Drizzle diagnostic output limit exceeded");
			const log = (result.output ?? "").replace(
				new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, "g"),
				"",
			);
			const changed = !files[journalPath].equals(outputs[journalPath]);
			if (
				/\b(?:Error|TypeError|ReferenceError|SyntaxError):/.test(log) ||
				!(changed
					? log.includes("Your SQL migration file")
					: log.includes("No schema changes, nothing to migrate"))
			)
				throw new Error("Drizzle did not confirm successful generation");
		}
		const check = (published = []) => {
			const current = kind === "migrations" ? migrationFiles(root) : {};
			for (const { name, stat, bytes } of published) {
				const now = fs.lstatSync(path.join(root, name));
				if (
					now.ino !== stat.ino ||
					now.dev !== stat.dev ||
					!current[name]?.equals(bytes)
				)
					throw new Error("Concurrent migration addition changed");
				delete current[name];
			}
			const live = {};
			for (const name of names()) {
				try {
					const stat = sourceStat(root, name);
					live[name] = stat.isSymbolicLink()
						? hash(fs.readlinkSync(path.join(root, name)))
						: hash(fs.readFileSync(path.join(root, name)));
				} catch (e) {
					if (e.code !== "ENOENT") throw e;
				}
			}
			for (const { name } of published) delete live[name];
			const currentInputs = inputState(live, kind, current, root);
			if (JSON.stringify(currentInputs) !== JSON.stringify(inputs))
				throw new Error(
					kind === "lock"
						? "Local dependency inputs or old lock changed"
						: "Local generator inputs or old migration set changed: " +
								Object.keys({
									...inputs,
									...currentInputs,
								})
									.filter(
										(name) =>
											JSON.stringify(inputs[name]) !==
											JSON.stringify(currentInputs[name]),
									)
									.join(","),
				);
			for (const name of Object.keys(inputs))
				if (inputs[name] !== null) regular(root, name);
		};
		check();
		if (kind === "migrations") {
			acceptMigrations(
				root,
				files,
				outputs,
				check,
				proposal,
				modes,
				transport.workerId,
			);
			const committed = migrationFiles(root);
			validateMigrations(committed);
			if (
				Object.keys(committed).length !== Object.keys(files).length ||
				Object.keys(files).some(
					(name) =>
						!committed[name]?.equals(files[name]) ||
						(fs.statSync(path.join(root, name)).mode & 0o777) !== modes[name],
				)
			)
				throw new Error(
					"Committed migration source verification conflict; recovery intent retained",
				);
		} else {
			const output = path.join(root, "pnpm-lock.yaml");
			if (fs.existsSync(output)) regular(root, "pnpm-lock.yaml");
			const tmp = path.join(root, `.boat/lock-${process.pid}.tmp`);
			fs.writeFileSync(tmp, files["pnpm-lock.yaml"], {
				mode: fs.existsSync(output) ? fs.statSync(output).mode & 0o777 : 0o644,
			});
			fs.renameSync(tmp, output);
		}
		transport.accept(
			Object.fromEntries(
				Object.entries(files).map(([name, bytes]) => [name, hash(bytes)]),
			),
			transport.workerId,
		);
		if (kind === "migrations") finishPublication(root);
		accepted = true;
		return result;
	} catch (error) {
		throw new Error(
			error.message.includes("proposal retained at")
				? error.message
				: fs.existsSync(proposal)
					? `${error.message}; proposal retained at ${proposal}`
					: `${error.message}; transaction evidence retained at ${staging}`,
		);
	} finally {
		fs.rmSync(snapshot, { recursive: true, force: true });
		if (accepted) fs.rmSync(staging, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.cwd();
	if (process.argv[2] === "collect-migrations")
		console.log(
			JSON.stringify(
				Object.entries(migrationFiles(root)).map(([name, bytes]) => ({
					name,
					type: "file",
					size: bytes.length,
					sha256: hash(bytes),
					mode: fs.lstatSync(path.join(root, name)).mode & 0o777,
					data: bytes.toString("base64"),
				})),
			),
		);
	else if (process.argv[2] === "verify-inputs") {
		const inputs = JSON.parse(fs.readFileSync(0, "utf8")),
			changed = [];
		for (const [name, value] of Object.entries(inputs)) {
			try {
				if (value === null) {
					try {
						fs.lstatSync(path.join(root, name));
						changed.push(name);
					} catch (error) {
						if (error.code !== "ENOENT") throw error;
					}
				} else if (
					hash(regular(root, name)) !== value.hash ||
					(fs.lstatSync(path.join(root, name)).mode & 0o777) !== value.mode
				)
					changed.push(name);
			} catch {
				changed.push(name);
			}
		}
		if (Object.hasOwn(inputs, journalPath)) {
			const actual = Object.keys(migrationFiles(root)).sort(),
				expected = Object.keys(inputs)
					.filter(
						(name) =>
							name.startsWith(`${migrations}/`) && inputs[name] !== null,
					)
					.sort();
			if (JSON.stringify(actual) !== JSON.stringify(expected))
				throw new Error("Worker migration baseline membership changed");
		}
		console.log(JSON.stringify({ changed }));
	} else if (process.argv[2] === "retain-migrations") {
		const id = process.argv[3];
		if (!/^[a-f0-9]{24}$/.test(id))
			throw new Error("Invalid proposal ownership");
		fs.mkdirSync(path.join(root, ".boat"), { recursive: true, mode: 0o700 });
		for (const name of ["apps", "apps/asset", ".boat"])
			if (!fs.lstatSync(path.join(root, name)).isDirectory())
				throw new Error("Unsafe proposal ancestor");
		const directory = path.join(root, ".boat/source-proposals", id),
			receipt = path.join(directory, "retained.json");
		for (const name of [
			".boat/source-proposals",
			`.boat/source-proposals/${id}`,
		]) {
			try {
				fs.mkdirSync(path.join(root, name), { mode: 0o700 });
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
			if (!fs.lstatSync(path.join(root, name)).isDirectory())
				throw new Error("Unsafe proposal ancestor");
		}
		if (!fs.existsSync(receipt)) {
			const destination = path.join(directory, "drizzle");
			let missing = false;
			try {
				fs.lstatSync(destination);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				try {
					fs.renameSync(path.join(root, migrations), destination);
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
					missing = true;
				}
			}
			fs.writeFileSync(
				receipt,
				JSON.stringify({
					id,
					retained: path.relative(root, directory),
					missing,
				}),
				{ mode: 0o600, flag: "wx" },
			);
		}
		const record = JSON.parse(
			regular(root, `${path.relative(root, directory)}/retained.json`),
		);
		if (record.id !== id || record.retained !== path.relative(root, directory))
			throw new Error("Invalid proposal retention receipt");
		if (!record.missing) fs.lstatSync(path.join(directory, "drizzle"));
		console.log(JSON.stringify(record));
	} else if (process.argv[2] === "prune-migrations") {
		const keep = new Set(JSON.parse(fs.readFileSync(0, "utf8")));
		// Only this owned output directory can be pruned. Never follow symlinks.
		if ([...keep].some((name) => !migrationName(name)))
			throw new Error("Invalid migration restore path");
		function prune(name) {
			const file = path.join(root, name),
				stat = fs.lstatSync(file);
			if (stat.isDirectory()) {
				for (const entry of fs.readdirSync(file)) prune(`${name}/${entry}`);
				if (name !== migrations && name !== `${migrations}/meta`)
					fs.rmdirSync(file);
			} else if (!stat.isFile() || !keep.has(name)) fs.unlinkSync(file);
		}
		for (const name of ["apps", "apps/asset"])
			if (!fs.lstatSync(path.join(root, name)).isDirectory())
				throw new Error(`Invalid migration directory: ${name}`);
		try {
			prune(migrations);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		fs.mkdirSync(path.join(root, migrations, "meta"), { recursive: true });
	} else throw new Error("Unknown source-generation transport operation");
}
