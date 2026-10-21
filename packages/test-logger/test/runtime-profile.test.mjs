import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { measureTestPhase } from "../src/index.ts";

describe("measureTestPhase", { concurrency: false }, () => {
	let directory;
	let previousDirectory;
	let previousProfiling;

	beforeEach(() => {
		previousDirectory = process.cwd();
		previousProfiling = process.env.CI_RUNTIME_PROFILE;
		directory = mkdtempSync(join(tmpdir(), "wallpaperdb-runtime-profile-"));
		process.chdir(directory);
		delete process.env.CI_RUNTIME_PROFILE;
	});

	afterEach(() => {
		mock.restoreAll();
		process.chdir(previousDirectory);
		if (previousProfiling === undefined) delete process.env.CI_RUNTIME_PROFILE;
		else process.env.CI_RUNTIME_PROFILE = previousProfiling;
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
			join(directory, "test-results", `ci-runtime-${process.pid}.jsonl`),
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

	it("preserves results and errors when the profile output cannot be created", async () => {
		const warning = mock.method(console, "warn", () => {});
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
		assert.equal(warning.mock.callCount(), 1);
		assert.match(
			warning.mock.calls[0].arguments[0],
			/phase evidence could not be written/,
		);
	});
});
