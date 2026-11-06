import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const wide = ["device", "inode", "mtimeNs"];
const bounded = {
	uid: 0xffffffff,
	gid: 0xffffffff,
	mode: 0o777,
	linkCount: Number.MAX_SAFE_INTEGER,
	bytes: Number.MAX_SAFE_INTEGER,
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function decimal(value, key) {
	if (typeof value === "number") {
		assert(Number.isSafeInteger(value), `Unsafe numeric identity: ${key}`);
		value = String(value);
	}
	assert(
		typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value),
		`Invalid decimal identity: ${key}`,
	);
	assert(key === "mtimeNs" || BigInt(value) >= 0n, `Negative identity: ${key}`);
	return value;
}

// Reviver source is supplied by the pinned Node runtime before Number rounding.
// Only these three filesystem fields have an unbounded decimal wire form.
export function parseSourceAuthority(raw) {
	assert(
		typeof raw === "string" || Buffer.isBuffer(raw),
		"Expected original JSON bytes",
	);
	return JSON.parse(raw.toString(), (key, value, context) => {
		if (wide.includes(key) && typeof value === "number") {
			assert(context?.source, "JSON source-aware parsing is required");
			return decimal(context.source, key);
		}
		if (typeof value === "number")
			assert(
				Number.isFinite(value) &&
					(!Number.isInteger(value) || Number.isSafeInteger(value)),
				`Unsafe JSON number: ${key}`,
			);
		return value;
	});
}

function identity(value) {
	assert(
		value && typeof value === "object" && !Array.isArray(value),
		"Invalid source identity",
	);
	assert(
		typeof value.path === "string" &&
			!value.path.includes("\0") &&
			path.isAbsolute(value.path) &&
			path.resolve(value.path) === value.path,
		"Invalid identity path",
	);
	const result = { path: value.path };
	for (const key of wide) result[key] = decimal(value[key], key);
	for (const [key, maximum] of Object.entries(bounded)) {
		assert(
			Number.isSafeInteger(value[key]) &&
				value[key] >= 0 &&
				value[key] <= maximum,
			`Invalid bounded identity: ${key}`,
		);
		result[key] = value[key];
	}
	assert(result.linkCount === 1, "Source must have one owned link");
	assert(
		typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256),
		"Invalid source hash",
	);
	result.sha256 = value.sha256;
	return result;
}

function observed(file, stat, bytes) {
	assert(stat.isFile(), "Source must be regular and nonsymlink");
	return identity({
		path: file,
		device: stat.dev.toString(),
		inode: stat.ino.toString(),
		mtimeNs: stat.mtimeNs.toString(),
		uid: Number(stat.uid),
		gid: Number(stat.gid),
		mode: Number(stat.mode & 0o777n),
		linkCount: Number(stat.nlink),
		bytes: bytes.length,
		sha256: hash(bytes),
	});
}

function access(file, writable, callback) {
	// Reject symlink ancestors as well as a symlink at the opened entry.
	assert.equal(
		fs.realpathSync(path.dirname(file)),
		path.dirname(file),
		"Source ancestor changed",
	);
	const fd = fs.openSync(
		file,
		(writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) |
			fs.constants.O_NOFOLLOW,
	);
	try {
		const bytes = fs.readFileSync(fd);
		const current = (payload = bytes) => {
			const a = observed(file, fs.fstatSync(fd, { bigint: true }), payload);
			const b = observed(file, fs.lstatSync(file, { bigint: true }), payload);
			assert.deepEqual(a, b, "Source fd/current-entry identity changed");
			assert.equal(
				fs.realpathSync(path.dirname(file)),
				path.dirname(file),
				"Source ancestor changed",
			);
			return a;
		};
		return callback(fd, bytes, current);
	} finally {
		fs.closeSync(fd);
	}
}

export function sourceIdentity(file) {
	return access(file, false, (_fd, _bytes, current) => current());
}

export function encodeSourceIdentity(value) {
	return JSON.stringify(identity(value));
}

export function verifySourceIdentity(value) {
	const expected = identity(value);
	return access(expected.path, false, (_fd, bytes, current) => {
		assert.deepEqual(current(), expected, "Owned source identity changed");
		return bytes;
	});
}

function readHeldPayload(fd, maximum) {
	const buffer = Buffer.alloc(maximum);
	let length = 0;
	while (length < maximum) {
		const count = fs.readSync(fd, buffer, length, maximum - length, length);
		if (count === 0) break;
		length += count;
	}
	return buffer.subarray(0, length);
}

// The immutable authority remains expected throughout archive and CAS. Never
// substitute a fresh observation for a refused expected identity.
export function resetOwnedSource(value, bytes) {
	const expected = identity(value);
	assert(
		bytes === null || Buffer.isBuffer(bytes),
		"Expected exact restore bytes or deletion",
	);
	return access(expected.path, true, (fd, _before, current) => {
		const before = current();
		assert.deepEqual(before, expected, "Owned source identity changed");
		const operation =
			bytes === null
				? null
				: {
						type: "write",
						payload: { bytes: bytes.length, sha256: hash(bytes) },
					};
		if (bytes === null) fs.unlinkSync(expected.path);
		else {
			let written = 0;
			while (written < bytes.length)
				written += fs.writeSync(
					fd,
					bytes,
					written,
					bytes.length - written,
					written,
				);
			fs.ftruncateSync(fd, bytes.length);
			fs.fsyncSync(fd);
		}
		const directory = fs.openSync(path.dirname(expected.path), "r");
		let parentAfter;
		try {
			fs.fsyncSync(directory);
			const held = fs.fstatSync(directory, { bigint: true });
			const entry = fs.lstatSync(path.dirname(expected.path), { bigint: true });
			assert(held.isDirectory() && entry.isDirectory());
			assert.equal(held.dev, entry.dev, "Source parent changed");
			assert.equal(held.ino, entry.ino, "Source parent changed");
			assert.equal(
				fs.realpathSync(path.dirname(expected.path)),
				path.dirname(expected.path),
			);
			parentAfter = {
				path: path.dirname(expected.path),
				device: held.dev.toString(),
				inode: held.ino.toString(),
				mtimeNs: held.mtimeNs.toString(),
				uid: Number(held.uid),
				gid: Number(held.gid),
				mode: Number(held.mode & 0o777n),
				linkCount: Number(held.nlink),
			};
		} finally {
			fs.closeSync(directory);
		}
		if (bytes === null) {
			const actual = readHeldPayload(fd, before.bytes + 1);
			const held = fs.fstatSync(fd, { bigint: true });
			assert(held.isFile() && held.nlink === 0n, "Deleted fd remains linked");
			assert.deepEqual(actual, _before, "Deleted fd payload changed");
			assert.equal(held.size, BigInt(actual.length));
			assert.equal(
				fs.lstatSync(expected.path, { throwIfNoEntry: false }),
				undefined,
				"Deleted input returned",
			);
			const heldAfter = {
				path: expected.path,
				device: held.dev.toString(),
				inode: held.ino.toString(),
				mtimeNs: held.mtimeNs.toString(),
				uid: Number(held.uid),
				gid: Number(held.gid),
				mode: Number(held.mode & 0o777n),
				linkCount: Number(held.nlink),
				bytes: actual.length,
				sha256: hash(actual),
			};
			for (const key of ["path", "device", "inode", "uid", "gid", "mode"])
				assert.equal(heldAfter[key], before[key], `Deleted fd changed: ${key}`);
			return {
				before,
				operation: { type: "unlink", payload: null },
				heldAfter,
				entryAfter: null,
				parentAfter,
				fileFsyncCompleted: false,
				directoryFsyncCompleted: true,
			};
		}
		const actual = readHeldPayload(fd, bytes.length + 1);
		assert.deepEqual(actual, bytes, "Actual restored payload changed");
		assert.equal(
			hash(actual),
			operation.payload.sha256,
			"Approved payload changed",
		);
		const heldAfter = current(actual);
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
				heldAfter[key],
				before[key],
				`Restored ownership changed: ${key}`,
			);
		return {
			before,
			operation,
			heldAfter,
			entryAfter: heldAfter,
			parentAfter,
			fileFsyncCompleted: true,
			directoryFsyncCompleted: true,
		};
	});
}
