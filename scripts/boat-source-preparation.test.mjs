import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { prepare547Source } from "./lib/boat-source-preparation.mjs";
import {
	sourcePreparationFixture,
	pin,
} from "./test-fixtures/source-preparation.mjs";

const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

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
