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
		const current = () => {
			const a = observed(file, fs.fstatSync(fd, { bigint: true }), bytes);
			const b = observed(file, fs.lstatSync(file, { bigint: true }), bytes);
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

// The immutable authority remains expected throughout archive and CAS. Never
// substitute a fresh observation for a refused expected identity.
export function resetOwnedSource(value, bytes) {
	const expected = identity(value);
	assert(
		bytes === null || Buffer.isBuffer(bytes),
		"Expected exact restore bytes or deletion",
	);
	return access(expected.path, true, (fd, _before, current) => {
		assert.deepEqual(current(), expected, "Owned source identity changed");
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
		try {
			fs.fsyncSync(directory);
		} finally {
			fs.closeSync(directory);
		}
	});
}
