import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
	sourceIdentity,
	encodeSourceIdentity,
	parseSourceAuthority,
	verifySourceIdentity,
	resetOwnedSource,
} from "./lib/boat-source-identity.mjs";

function fixture(t, nanoseconds = "1793841786244371689") {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "boat-source-identity-"),
	);
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const file = path.join(directory, "owned");
	fs.writeFileSync(file, "independent original\n", { mode: 0o600 });
	execFileSync("python", [
		"-c",
		"import os,sys;os.utime(sys.argv[1],ns=(int(sys.argv[2]),int(sys.argv[2])))",
		file,
		nanoseconds,
	]);
	// Python is the independent legacy producer, including its exact JSON token.
	const raw = execFileSync("python", [
		"-c",
		`import os,sys,json,hashlib
p=sys.argv[1];s=os.lstat(p);b=open(p,'rb').read()
print(json.dumps(dict(path=p,device=s.st_dev,inode=s.st_ino,mtimeNs=s.st_mtime_ns,uid=s.st_uid,gid=s.st_gid,mode=s.st_mode&511,linkCount=s.st_nlink,bytes=len(b),sha256=hashlib.sha256(b).hexdigest())))`,
		file,
	]);
	return { directory, file, raw, expected: parseSourceAuthority(raw) };
}

test("source identity preserves original legacy integer bytes and canonical production strings", (t) => {
	const f = fixture(t);
	assert.match(f.raw.toString(), /"mtimeNs": 1793841786244371689/);
	assert.equal(f.expected.mtimeNs, "1793841786244371689");
	assert.equal(
		verifySourceIdentity(f.expected).toString(),
		"independent original\n",
	);
	const wire = encodeSourceIdentity(sourceIdentity(f.file));
	assert.equal(JSON.parse(wire).mtimeNs, "1793841786244371689");
	assert.equal(typeof JSON.parse(wire).device, "string");
	assert.equal(typeof JSON.parse(wire).inode, "string");
	assert.equal(
		verifySourceIdentity(parseSourceAuthority(wire)).toString(),
		"independent original\n",
	);
});

test("source identity refuses one nanosecond drift that an unsafe Number comparison accepts", (t) => {
	const f = fixture(t);
	assert.equal(Number("1793841786244371689"), Number("1793841786244371690"));
	execFileSync("python", [
		"-c",
		"import os,sys;os.utime(sys.argv[1],ns=(1793841786244371690,1793841786244371690))",
		f.file,
	]);
	assert.throws(
		() => resetOwnedSource(f.expected, Buffer.from("MUST NOT WRITE")),
		/identity changed/,
	);
	assert.equal(fs.readFileSync(f.file, "utf8"), "independent original\n");
});

test("source identity refuses already rounded numeric objects before they become new authority", (t) => {
	const f = fixture(t);
	const unsafe = JSON.parse(f.raw);
	assert.equal(String(unsafe.mtimeNs), "1793841786244371700");
	assert.throws(() => verifySourceIdentity(unsafe), /Unsafe numeric identity/);
	assert.throws(() => encodeSourceIdentity(unsafe), /Unsafe numeric identity/);
	assert.throws(() => parseSourceAuthority(unsafe), /original JSON bytes/);
});

test("source identity preserves the valid safe-number legacy neighbor", (t) => {
	const f = fixture(t, "1000000000");
	const safe = JSON.parse(f.raw);
	assert.equal(safe.mtimeNs, 1000000000);
	assert.equal(verifySourceIdentity(safe).toString(), "independent original\n");
});

for (const [field, wrong] of Object.entries({
	device: "0",
	inode: "0",
	uid: -1,
	gid: 0x100000000,
	mode: 0o1000,
	linkCount: 2,
	bytes: -1,
	sha256: "bad",
	path: "relative/owned",
	mtimeNs: "01793841786244371689",
}))
	test(`source identity refuses malformed ${field}`, (t) => {
		const f = fixture(t);
		assert.throws(() =>
			resetOwnedSource({ ...f.expected, [field]: wrong }, null),
		);
		assert.equal(fs.readFileSync(f.file, "utf8"), "independent original\n");
	});

for (const [field, delta] of [
	["device", 1n],
	["inode", 1n],
	["uid", 1],
	["gid", 1],
	["mode", 1],
	["bytes", 1],
])
	test(`source identity guards exact ${field}`, (t) => {
		const f = fixture(t),
			value = f.expected[field];
		const wrong =
			typeof delta === "bigint"
				? (BigInt(value) + delta).toString()
				: value + delta;
		assert.throws(() =>
			resetOwnedSource({ ...f.expected, [field]: wrong }, null),
		);
		assert.equal(fs.readFileSync(f.file, "utf8"), "independent original\n");
	});

test("source identity refuses malformed decimal tokens and unsafe bounded integers", () => {
	for (const token of ["1.0", "1e3", "-0"])
		assert.throws(
			() => parseSourceAuthority(`{"mtimeNs":${token}}`),
			/decimal identity/,
		);
	assert.throws(
		() => parseSourceAuthority('{"bytes":9007199254740993}'),
		/Unsafe JSON number/,
	);
});

test("source identity refuses hash drift, symlinks and multiple links", (t) => {
	const f = fixture(t);
	assert.throws(() =>
		resetOwnedSource({ ...f.expected, sha256: "0".repeat(64) }, null),
	);
	const alias = path.join(f.directory, "alias");
	fs.symlinkSync(f.file, alias);
	assert.throws(() => verifySourceIdentity({ ...f.expected, path: alias }));
	fs.unlinkSync(alias);
	fs.linkSync(f.file, alias);
	assert.throws(() => verifySourceIdentity(f.expected), /one owned link/);
});

test("source identity keeps the opened fd bound to the current entry before CAS", (t) => {
	const f = fixture(t),
		moved = path.join(f.directory, "retained");
	const read = fs.readFileSync;
	let switched = false;
	t.mock.method(fs, "readFileSync", (file, ...args) => {
		if (
			!switched &&
			typeof file === "number" &&
			fs.readlinkSync(`/proc/self/fd/${file}`) === f.file
		) {
			switched = true;
			fs.renameSync(f.file, moved);
			fs.writeFileSync(f.file, "new entry stays intact\n", { mode: 0o600 });
		}
		return read(file, ...args);
	});
	assert.throws(
		() => resetOwnedSource(f.expected, Buffer.from("MUST NOT WRITE")),
		/current-entry/,
	);
	assert.equal(read(moved, "utf8"), "independent original\n");
	assert.equal(read(f.file, "utf8"), "new entry stays intact\n");
});

test("source identity exact restore and deletion preserve unrelated siblings", (t) => {
	const f = fixture(t),
		sibling = path.join(f.directory, "sibling");
	fs.writeFileSync(sibling, "unrelated\n");
	resetOwnedSource(f.expected, Buffer.from("selected Git bytes\n"));
	assert.equal(fs.readFileSync(f.file, "utf8"), "selected Git bytes\n");
	assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
	resetOwnedSource(sourceIdentity(f.file), null);
	assert.equal(fs.existsSync(f.file), false);
	assert.equal(fs.readFileSync(sibling, "utf8"), "unrelated\n");
});
