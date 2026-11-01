import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scripts);
const sentinel = '#!/bin/sh\necho executed >> "$BOAT_TEST_EXECUTED"\n';

function fixture(t) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "boat-bootstrap-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const installed = path.join(directory, ".mise/boat/boat");
	const retained = path.join(
		directory,
		"home/.local/state/wallpaperdb-boat/557/tools/boat-1.0.85-linux-x64",
	);
	const executed = path.join(directory, "executed");
	const requested = path.join(directory, "requested");
	fs.mkdirSync(path.dirname(installed), { recursive: true });
	fs.mkdirSync(path.dirname(retained), { recursive: true });
	fs.mkdirSync(path.join(directory, "bin"));
	fs.symlinkSync(scripts, path.join(directory, "scripts"));
	// Only the launcher and network are controlled. Python hashes actual bytes.
	fs.writeFileSync(
		path.join(directory, "bin/mise"),
		'#!/bin/sh\n[ "$1" = exec ] && [ "$2" = -- ] || exit 90\nshift 2\nexec "$@"\n',
		{ mode: 0o700 },
	);
	fs.writeFileSync(
		path.join(directory, "bin/curl"),
		'#!/bin/sh\necho requested >> "$BOAT_TEST_REQUESTED"\n[ "$3" = -o ] || exit 91\ncp "$BOAT_TEST_DOWNLOAD" "$4"\n',
		{ mode: 0o700 },
	);
	fs.writeFileSync(path.join(directory, "download"), sentinel);
	// A previous rejected download and unrelated cache must never be overwritten.
	const previous = path.join(directory, ".mise/boat/boat.download");
	fs.writeFileSync(previous, "previous unexpected download\n");
	const sibling = path.join(directory, ".mise/boat/sibling");
	fs.writeFileSync(sibling, "unrelated cache\n");
	return {
		directory,
		installed,
		retained,
		run(extraEnv = {}) {
			const result = spawnSync(
				"make",
				[
					"-f",
					path.join(root, "Makefile"),
					"boat-enroll",
					"MODE=development",
					"SIZE=large",
					"COHORT=c",
					"LIFECYCLE=fresh-after-stop",
				],
				{
					cwd: directory,
					encoding: "utf8",
					timeout: 10000,
					env: {
						...process.env,
						HOME: path.join(directory, "home"),
						PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
						MAKEFLAGS: "",
						MFLAGS: "",
						BOAT_TEST_EXECUTED: executed,
						BOAT_TEST_REQUESTED: requested,
						BOAT_TEST_DOWNLOAD: path.join(directory, "download"),
						BOAT_CACHE_NAMESPACE: "bootstrap-test",
						...extraEnv,
					},
				},
			);
			assert.equal(result.error, undefined);
			assert.notEqual(result.status, 0, result.stdout + result.stderr);
			assert.equal(fs.existsSync(executed), false, "no artifact execution");
			assert.match(result.stderr, /Boat artifact.*(checksum|regular file)/);
			assert.equal(fs.existsSync(path.join(directory, ".boat")), false);
			assert.equal(
				fs.readFileSync(previous, "utf8"),
				"previous unexpected download\n",
			);
			assert.equal(fs.readFileSync(sibling, "utf8"), "unrelated cache\n");
			return result;
		},
		requested: () => fs.existsSync(requested),
	};
}

test("bootstrap rejects an executable installed artifact before any execution", (t) => {
	const f = fixture(t);
	fs.writeFileSync(f.installed, sentinel, { mode: 0o700 });
	f.run();
	assert.equal(f.requested(), false);
	assert.equal(fs.readFileSync(f.installed, "utf8"), sentinel);
});

test("bootstrap rejects a corrupt retained artifact without falling back to download", (t) => {
	const f = fixture(t);
	fs.writeFileSync(f.retained, sentinel, { mode: 0o700 });
	f.run();
	assert.equal(f.requested(), false);
	assert.equal(fs.existsSync(f.installed), false);
	assert.equal(fs.readFileSync(f.retained, "utf8"), sentinel);
});

for (const optimized of [false, true])
	test(`bootstrap retains rejected download bytes with Python optimization ${optimized}`, (t) => {
		const f = fixture(t);
		f.run({ PYTHONOPTIMIZE: optimized ? "1" : "" });
		assert.equal(f.requested(), true);
		assert.equal(fs.existsSync(f.installed), false);
		const downloads = fs
			.readdirSync(path.dirname(f.installed))
			.filter((name) => name !== "boat.download" && name.endsWith(".download"));
		assert.equal(downloads.length, 1);
		assert.equal(
			fs.readFileSync(
				path.join(path.dirname(f.installed), downloads[0]),
				"utf8",
			),
			sentinel,
		);
	});

for (const source of ["installed", "retained"])
	for (const kind of ["symlink", "directory", "fifo"])
		test(`bootstrap rejects ${source} ${kind} as a non-regular artifact`, (t) => {
			const f = fixture(t);
			if (kind === "symlink")
				fs.symlinkSync(path.join(f.directory, "download"), f[source]);
			if (kind === "directory") fs.mkdirSync(f[source]);
			if (kind === "fifo") {
				const result = spawnSync("mkfifo", [f[source]]);
				assert.equal(result.status, 0);
			}
			f.run();
			assert.equal(f.requested(), false);
		});

test("bootstrap verifier accepts a public SHA-256 vector and rejects changed bytes", (t) => {
	const f = fixture(t);
	// This covers the verifier, not installation of the private qualified binary.
	const result = spawnSync(
		"python",
		[
			"-B",
			"-c",
			`import pathlib, runpy, sys
verify = runpy.run_path(sys.argv[1])["verify_artifact"]
p = pathlib.Path(sys.argv[2])
p.write_bytes(b"abc")
expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
verify(p, expected)
p.write_bytes(b"abcd")
try:
    verify(p, expected)
except ValueError:
    pass
else:
    raise RuntimeError("changed bytes accepted")
`,
			path.join(scripts, "boat-artifact.py"),
			path.join(f.directory, "vector"),
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stdout + result.stderr);
});
