import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { captureCommand } from "./boat-capture.mjs";

const helper = fileURLToPath(
	new URL("boat-engine-baseline.mjs", import.meta.url),
);

for (const changed of [false, true])
	test(`Engine worker helper ${changed ? "refuses changed" : "accepts exact"} source authority before endpoint access`, async (t) => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "boat-engine-helper-"),
		);
		t.after(() => {
			fs.rmSync(directory, { recursive: true });
			assert.equal(fs.existsSync(directory), false);
			t.diagnostic(JSON.stringify({ fixture: directory, removed: true }));
		});
		const bytes = fs.readFileSync(helper);
		const expected = {
			path: "scripts/lib/boat-engine-baseline.mjs",
			bytes: bytes.length,
			sha256: changed
				? "0".repeat(64)
				: createHash("sha256").update(bytes).digest("hex"),
			mode: fs.statSync(helper).mode & 0o777,
		};
		const owner = {
			version: "547-engine-baseline-v1",
			root: directory,
			round: "worker-source-control",
			worker: "fixture-worker",
			admission: "fixture-admission",
		};
		const receipt = await captureCommand({
			argv: [
				process.execPath,
				helper,
				"--worker",
				JSON.stringify(owner),
				JSON.stringify(expected),
			],
			cwd: directory,
			directory: path.join(directory, "capture"),
			deadline: Number(process.hrtime.bigint()) / 1e9 + 2,
			disposalMs: 1000,
			limit: 32768,
			env: {
				...process.env,
				WALLPAPERDB_BOAT_WORKER: "1",
				DOCKER_HOST: `unix://${directory}/absent-owned-endpoint`,
			},
		});
		const disposal = JSON.parse(
			fs.readFileSync(path.join(directory, "capture/disposal.json")),
		);
		const stdout = fs.readFileSync(
			path.join(directory, "capture/stdout.raw"),
			"utf8",
		);
		const stderr = fs.readFileSync(
			path.join(directory, "capture/stderr.raw"),
			"utf8",
		);
		t.diagnostic(JSON.stringify({ receipt, disposal, stdout, stderr }));
		assert.equal(receipt.captureComplete, true);
		assert.deepEqual(disposal.unresolved, []);
		assert.equal(disposal.pipesClosed, true);
		assert.deepEqual(receipt.terminal, { code: changed ? 1 : 0, signal: null });
		if (changed) {
			assert.equal(stdout, "");
			assert.equal(stderr, "Engine baseline worker helper changed\n");
		} else {
			assert.match(stdout, /^BOAT_ENGINE_VERSION_V1 /);
			assert.equal(
				JSON.parse(stdout.slice("BOAT_ENGINE_VERSION_V1 ".length)).status,
				"UNAVAILABLE_ENDPOINT",
			);
		}
	});
