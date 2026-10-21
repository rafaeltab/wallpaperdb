import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { measureTestPhase } from "../src/index.ts";

describe("measureTestPhase", { concurrency: false }, () => {
	let directory;
	let previousDirectory;
	let previousProfiling;
	let previousLifecycle;

	beforeEach(() => {
		previousDirectory = process.cwd();
		previousProfiling = process.env.CI_RUNTIME_PROFILE;
		previousLifecycle = process.env.npm_lifecycle_event;
		directory = mkdtempSync(join(tmpdir(), "wallpaperdb-runtime-profile-"));
		process.chdir(directory);
		delete process.env.CI_RUNTIME_PROFILE;
		delete process.env.npm_lifecycle_event;
	});

	afterEach(() => {
		process.chdir(previousDirectory);
		if (previousProfiling === undefined) delete process.env.CI_RUNTIME_PROFILE;
		else process.env.CI_RUNTIME_PROFILE = previousProfiling;
		if (previousLifecycle === undefined) delete process.env.npm_lifecycle_event;
		else process.env.npm_lifecycle_event = previousLifecycle;
		rmSync(directory, { recursive: true, force: true });
	});

	it("preserves result and error identity without emitting disabled profiles", async () => {
		const result = { value: "retained" };
		const failure = new Error("operation failed");

		assert.equal(
			await measureTestPhase("disabled.success", async () => result),
			result,
		);
		await assert.rejects(
			measureTestPhase("disabled.failure", async () => {
				throw failure;
			}),
			(actual) => actual === failure,
		);
		assert.deepEqual(readdirSync(directory), []);
	});

	it("records successful and failed operations without changing their outcomes", async () => {
		process.env.CI_RUNTIME_PROFILE = "true";
		const result = { value: "retained" };
		const failure = new Error("operation failed");

		assert.equal(
			await measureTestPhase("enabled.success", async () => result),
			result,
		);
		await assert.rejects(
			measureTestPhase("enabled.failure", async () => {
				throw failure;
			}),
			(actual) => actual === failure,
		);

		const records = readFileSync(
			join(directory, "test-results", `ci-runtime-all-${process.pid}.jsonl`),
			"utf8",
		)
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		assert.deepEqual(
			records.map(({ phase, status, pid }) => ({ phase, status, pid })),
			[
				{ phase: "enabled.success", status: "passed", pid: process.pid },
				{ phase: "enabled.failure", status: "failed", pid: process.pid },
			],
		);
		for (const record of records) {
			assert.equal(new Date(record.startedAt).toISOString(), record.startedAt);
			assert.ok(Number.isFinite(record.durationMs));
			assert.ok(record.durationMs >= 0);
		}
	});

	for (const [event, phase] of [
		["test:unit", "unit"],
		["test:integration", "integration"],
		[undefined, "all"],
	]) {
		it(`owns ${phase} evidence separately for lifecycle ${event}`, async () => {
			process.env.CI_RUNTIME_PROFILE = "true";
			if (event !== undefined) process.env.npm_lifecycle_event = event;
			await measureTestPhase("fixture.phase", async () => "retained");
			assert.deepEqual(readdirSync(join(directory, "test-results")), [
				`ci-runtime-${phase}-${process.pid}.jsonl`,
			]);
		});
	}

	it("preserves results and errors when the profile output cannot be created", async () => {
		process.env.CI_RUNTIME_PROFILE = "true";
		writeFileSync(join(directory, "test-results"), "blocked output");
		const result = { value: "retained" };
		const failure = new Error("operation failed");

		assert.equal(
			await measureTestPhase("blocked.success", async () => result),
			result,
		);
		await assert.rejects(
			measureTestPhase("blocked.failure", async () => {
				throw failure;
			}),
			(actual) => actual === failure,
		);
		assert.equal(
			readFileSync(join(directory, "test-results"), "utf8"),
			"blocked output",
		);
	});

	it("preserves operation outcomes when both evidence and warning output fail", () => {
		writeFileSync(join(directory, "test-results"), "blocked output");
		const child = spawnSync(
			process.execPath,
			[
				"--experimental-strip-types",
				"--input-type=module",
				"-e",
				`
import assert from 'node:assert/strict';
import { closeSync } from 'node:fs';
const { measureTestPhase } = await import(process.argv[1]);
closeSync(2);
const result = { retained: true };
const failure = new Error('original operation failure');
assert.equal(await measureTestPhase('blocked.success', async () => result), result);
await assert.rejects(measureTestPhase('blocked.failure', async () => { throw failure; }), error => error === failure);
`,
				new URL("../src/index.ts", import.meta.url).href,
			],
			{
				cwd: directory,
				env: { ...process.env, CI_RUNTIME_PROFILE: "true" },
				encoding: "utf8",
				timeout: 10_000,
			},
		);
		assert.equal(child.error, undefined);
		assert.equal(child.status, 0, child.stdout + child.stderr);
		assert.equal(
			readFileSync(join(directory, "test-results"), "utf8"),
			"blocked output",
		);
	});
});
