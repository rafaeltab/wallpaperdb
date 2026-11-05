import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { prepare547Source } from "./lib/boat-source-preparation.mjs";
import {
	sourcePreparationFixture,
	pin,
} from "./test-fixtures/source-preparation.mjs";

const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function expectedControls(f, intent) {
	const observed = intent
		? json(path.join(f.directory, "controls-after-intent.json"))
		: null;
	if (intent) assert.equal(observed.atControlledUsageBeforeReturn, true);
	return f.controlInputs.map((before) => {
		const record =
			observed?.controls.find((p) => p.path === before.path) ?? before;
		if (intent) {
			assert.equal(record.regular, true);
			assert.equal(record.mode, before.mode);
		}
		const bytes = Buffer.from(record.bodyBase64, "base64");
		if (
			intent &&
			(before.path.endsWith("/.boat/state.json") ||
				before.path.endsWith(".worker.json"))
		) {
			const after = JSON.parse(bytes),
				original = JSON.parse(Buffer.from(before.bodyBase64, "base64"));
			assert.equal(after.developmentWanted, false);
			assert.match(after.shutdownAttempt.lastInvocationId, /^[a-f0-9-]{36}$/);
			assert.equal(after.shutdownAttempt.phase, "initial");
			after.developmentWanted = original.developmentWanted;
			delete after.shutdownAttempt.lastInvocationId;
			delete after.shutdownAttempt.phase;
			assert.deepEqual(
				after,
				original,
				"Only ordinary intent bookkeeping may change",
			);
		} else assert.deepEqual(bytes, Buffer.from(before.bodyBase64, "base64"));
		return {
			path: before.path,
			bytes: bytes.length,
			sha256: digest(bytes),
			mode: before.mode,
			body: bytes,
		};
	});
}

function assertControlArchive(actual, expected) {
	assert.equal(actual.length, 11);
	assert.deepEqual(
		actual.map((x) => x.original.path).sort(),
		expected.map((x) => x.path).sort(),
	);
	for (const input of expected) {
		const archived = actual.find((x) => x.original.path === input.path);
		assert.deepEqual(
			archived.body,
			input.body,
			`Archived control bytes: ${input.path}`,
		);
		const identity = {
			path: input.path,
			bytes: input.bytes,
			sha256: input.sha256,
			mode: input.mode,
		};
		assert.deepEqual(archived.original, identity);
		for (const key of ["bytes", "sha256", "mode"])
			assert.equal(archived[key], identity[key]);
		assert.equal(archived.fileMode, input.mode);
	}
}

for (const fault of ["owner-stopped", "owner-running", "owner-admission"])
	test(`source preparation review refuses ${fault} before controller effects`, async (t) => {
		const f = sourcePreparationFixture(t, { fault });
		f.retain(fault);
		captured(f, await f.run(), 2);
		const transition = json(
			path.join(f.directory, "ownership-transition.json"),
		);
		assert.equal(transition.atLifecycleAcquisition, true);
		assert.equal(transition.guardWorker, f.state.id);
		assert.equal(transition.guardAdmission, f.state.admission.token);
		assert.equal(
			fs.readFileSync(path.join(f.root, ".boat/state.json"), "utf8"),
			transition.bytes,
		);
		assert.equal(
			fs.existsSync(f.calls),
			false,
			"No provider hook may run on a superseded owner",
		);
		assert.equal(fs.existsSync(path.join(f.evidence, "archive")), false);
		for (let i = 0; i < 28; i++)
			assert.equal(
				fs.readFileSync(f.files[i].path, "utf8"),
				`owned-change-${i}\n`,
			);
	});

for (const fault of ["missing-pid", "partial-pid", "foreign-lock"])
	test(`source preparation review preserves ownership during ${fault}`, async (t) => {
		const f = sourcePreparationFixture(t, { wanted: false, strings: true });
		f.retain(fault);
		const originalHome = process.env.HOME;
		process.env.HOME = path.join(f.directory, "home");
		t.after(() => {
			process.env.HOME = originalHome;
		});
		const lock = path.join(f.root, ".boat/source.lock"),
			pid = path.join(lock, "pid");
		const open = fs.openSync,
			write = fs.writeFileSync;
		let injected = false;
		if (fault === "missing-pid")
			t.mock.method(fs, "openSync", (file, ...args) => {
				if (file === pid) {
					injected = true;
					throw new Error("controlled PID publication failed");
				}
				return open(file, ...args);
			});
		t.mock.method(fs, "writeFileSync", (file, ...args) => {
			const target =
				file === pid ||
				(typeof file === "number" &&
					fs.readlinkSync(`/proc/self/fd/${file}`) === pid);
			if (!injected && target) {
				injected = true;
				if (fault === "foreign-lock") {
					fs.renameSync(lock, lock + ".retained-owned");
					fs.mkdirSync(lock);
					write(pid, "foreign-owner", { mode: 0o600 });
				} else if (fault === "partial-pid") {
					if (typeof file === "number") fs.writeSync(file, "12");
					else write(file, "12", { flag: "wx", mode: 0o600 });
				}
				throw new Error("controlled PID publication failed");
			}
			return write(file, ...args);
		});
		await assert.rejects(
			prepare547Source(json(f.config)),
			/controlled PID publication failed/,
		);
		assert.equal(injected, true);
		if (fault === "foreign-lock") {
			assert.equal(fs.readFileSync(pid, "utf8"), "foreign-owner");
			assert.match(
				json(path.join(f.evidence, "result.json")).cleanupError,
				/foreign lock retained/,
			);
		} else
			assert.equal(
				fs.existsSync(lock),
				false,
				"Retire the exact partially acquired lock",
			);
		assert.equal(fs.existsSync(f.calls), false);
		for (let i = 0; i < 28; i++)
			assert.equal(
				fs.readFileSync(f.files[i].path, "utf8"),
				`owned-change-${i}\n`,
			);
	});

test("source preparation archive failure retires its own lock and preserves source", async (t) => {
	const f = sourcePreparationFixture(t, { wanted: false, strings: true });
	f.retain("archive-failure");
	// A narrow filesystem failure, separate from real public-Make composition.
	const originalHome = process.env.HOME;
	process.env.HOME = path.join(f.directory, "home");
	t.after(() => {
		process.env.HOME = originalHome;
	});
	const write = fs.writeFileSync;
	t.mock.method(fs, "writeFileSync", (file, ...args) => {
		if (
			typeof file === "string" &&
			file === path.join(f.evidence, "archive/source-0")
		)
			throw new Error("controlled archive write failure");
		return write(file, ...args);
	});
	await assert.rejects(
		prepare547Source(json(f.config)),
		/controlled archive write failure/,
	);
	assert.equal(json(path.join(f.evidence, "result.json")).status, "FAIL");
	assert.equal(fs.existsSync(path.join(f.root, ".boat/source.lock")), false);
	assert.equal(fs.existsSync(f.calls), false);
	for (let i = 0; i < 28; i++)
		assert.equal(
			fs.readFileSync(f.files[i].path, "utf8"),
			`owned-change-${i}\n`,
		);
});

function captured(f, result, expected) {
	assert.equal(
		result.terminal.code,
		expected,
		fs.readFileSync(
			path.join(f.directory, "public-command/stderr.raw"),
			"utf8",
		),
	);
	assert.equal(result.captureComplete, true);
	const disposal = json(path.join(f.directory, "public-command/disposal.json"));
	assert.equal(disposal.pipesClosed, true);
	assert.deepEqual(disposal.unresolved, []);
}
for (const [name, options, calls] of [
	["legacy-intent", { wanted: true }, true],
	["canonical-quiet", { wanted: false, strings: true }, false],
])
	test(`source preparation public Make ${name} completes exact 9+19 archive/CAS`, async (t) => {
		const f = sourcePreparationFixture(t, options);
		f.retain(name);
		const original = fs.readFileSync(f.authority);
		const result = await f.run();
		captured(f, result, 0);
		const receipt = json(path.join(f.evidence, "result.json"));
		assert.equal(receipt.status, "PASS_OWNED_SOURCE_PREPARATION");
		assert.equal(receipt.archiveVerified, true);
		assert.equal(receipt.mutations, 28);
		assert.equal(receipt.makeInvocations, calls ? 1 : 0);
		assert.deepEqual(fs.readFileSync(f.authority), original);
		const archive = json(path.join(f.evidence, "archive/manifest.json"));
		assert.equal(archive.length, 39);
		for (const [i, entry] of archive.slice(0, 28).entries()) {
			assert.equal(
				fs.readFileSync(path.join(f.evidence, "archive", entry.file), "utf8"),
				`owned-change-${i}\n`,
			);
			assert.equal(entry.original.mtimeNs, "1793841786244371689");
		}
		const expected = expectedControls(f, calls);
		const controlArchive = archive
			.slice(28)
			.map((entry) => ({
				...entry,
				body: fs.readFileSync(path.join(f.evidence, "archive", entry.file)),
				fileMode:
					fs.lstatSync(path.join(f.evidence, "archive", entry.file)).mode &
					0o777,
			}));
		assertControlArchive(controlArchive, expected);
		// A self-consistent empty payload/manifest must still fail the independent
		// control oracle. The actual native archive remains unchanged.
		const bad = controlArchive.map((x) => ({ ...x }));
		bad[0] = {
			...bad[0],
			body: Buffer.alloc(0),
			bytes: 0,
			sha256: digest(Buffer.alloc(0)),
			original: {
				...bad[0].original,
				bytes: 0,
				sha256: digest(Buffer.alloc(0)),
			},
		};
		assert.throws(
			() => assertControlArchive(bad, expected),
			/Archived control bytes/,
		);
		fs.writeFileSync(
			path.join(f.directory, "control-oracle-negative.json"),
			JSON.stringify({
				selfConsistentEmptyControlRefused: true,
				path: bad[0].original.path,
				expectedBytes: expected[0].bytes,
				mutantBytes: 0,
				actualArchivePreserved: true,
			}),
			{ flag: "wx", mode: 0o600 },
		);
		for (let i = 0; i < 9; i++)
			assert.equal(
				fs.readFileSync(path.join(f.root, `tracked-${i}`), "utf8"),
				`selected-${i}\n`,
			);
		for (let i = 0; i < 19; i++)
			assert.equal(fs.existsSync(path.join(f.root, `created-${i}`)), false);
		assert.equal(
			fs.readFileSync(path.join(f.root, "unrelated"), "utf8"),
			"unrelated sibling must survive\n",
		);
		const after = json(path.join(f.root, ".boat/state.json"));
		assert.equal(after.developmentWanted, false);
		assert.equal(after.snapshotRecovery.status, "DIRTY");
		assert.equal(after.cost, 0.25);
		assert.equal(
			after.shutdownAttempt.accountingAppliedAt,
			"2026-11-05T00:00:01.000Z",
		);
		const provider = fs.existsSync(f.calls)
			? fs.readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse)
			: [];
		assert.equal(
			provider.some(
				(a) => a.includes("stop") || a.includes("new") || a.includes("ssh"),
			),
			false,
		);
		assert.equal(provider.length > 0, calls);
		assert.equal(
			receipt.restored.every((r) => typeof r.mtimeNs === "string"),
			true,
		);
		assert.equal(fs.existsSync(path.join(f.root, ".boat/source.lock")), false);
	});

for (const when of ["before-intent", "after-intent"])
	test(`source preparation refuses 1ns ${when} drift before archive or source mutation`, async (t) => {
		const f = sourcePreparationFixture(t, { fault: when });
		f.retain(when);
		const result = await f.run();
		captured(f, result, 2);
		assert.match(
			fs.readFileSync(
				path.join(f.directory, "public-command/stderr.raw"),
				"utf8",
			),
			/Owned source identity changed/,
		);
		assert.match(
			fs.readFileSync(
				path.join(f.directory, "public-command/stderr.raw"),
				"utf8",
			),
			when === "before-intent" ? /"status":"REFUSED"/ : /"status":"FAIL"/,
		);
		assert.equal(fs.existsSync(path.join(f.evidence, "archive")), false);
		for (let i = 0; i < 28; i++)
			assert.equal(
				fs.readFileSync(f.files[i].path, "utf8"),
				`owned-change-${i}\n`,
			);
		assert.equal(fs.existsSync(f.calls), when === "after-intent");
		assert.equal(
			json(path.join(f.root, ".boat/state.json")).developmentWanted,
			when === "before-intent",
		);
		assert.equal(
			fs.readFileSync(path.join(f.root, "unrelated"), "utf8"),
			"unrelated sibling must survive\n",
		);
	});

test("source preparation rejects unsafe reconstructed authority instead of rebasing it onto disk", async (t) => {
	const f = sourcePreparationFixture(t);
	f.retain("unsafe-reconstructed");
	const rounded = json(f.authority);
	assert.equal(String(rounded.files[0].mtimeNs), "1793841786244371700");
	fs.writeFileSync(f.authority, JSON.stringify(rounded));
	fs.writeFileSync(
		f.config,
		JSON.stringify({ authority: pin(f.authority), evidence: f.evidence }),
	);
	captured(f, await f.run(), 2);
	assert.equal(fs.existsSync(f.calls), false);
	assert.equal(fs.existsSync(f.evidence), false);
	for (let i = 0; i < 28; i++)
		assert.equal(
			fs.readFileSync(f.files[i].path, "utf8"),
			`owned-change-${i}\n`,
		);
});
