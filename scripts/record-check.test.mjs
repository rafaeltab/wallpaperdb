import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordCheck } from "./record-check.mjs";
test("check records distinguish expected failures, success and source changes during execution", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "record-check-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const request = {
		command: ["make", "test"],
		output: path.join(root, "evidence.json"),
		expect: "failure",
	};
	const snapshot = () => ({
		head: "a".repeat(40),
		tree: "b".repeat(40),
		sourceDigest: "c",
	});
	const red = recordCheck(
		request,
		() => ({ status: 1, stdout: "reported defect", stderr: "" }),
		snapshot,
	);
	assert.equal(red.expectationMet, true);
	assert.equal(red.checks[0].exitCode, 1);
	assert.ok(fs.existsSync(red.checks[0].artifact.path));
	assert.equal(
		recordCheck(
			{ ...request, expect: "success" },
			() => ({ status: 0, stdout: "pass", stderr: "" }),
			snapshot,
		).expectationMet,
		true,
	);
	let count = 0;
	assert.equal(
		recordCheck(
			{ ...request, expect: "success" },
			() => ({ status: 0 }),
			() => ({ ...snapshot(), sourceDigest: String(count++) }),
		).expectationMet,
		false,
	);
	assert.equal(
		recordCheck(request, () => ({ status: null, signal: "SIGTERM" }), snapshot)
			.expectationMet,
		false,
	);
});

test("a new check invalidates old evidence before execution starts", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pending-check-"));
	t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
	const output = path.join(directory, "evidence.json");
	fs.writeFileSync(output, JSON.stringify({ expectationMet: true }));
	const request = { command: ["make", "test"], output, expect: "success" };
	const result = recordCheck(
		request,
		() => {
			const pending = JSON.parse(fs.readFileSync(output, "utf8"));
			assert.equal(pending.expectationMet, false);
			assert.equal(pending.state, "running");
			assert.ok(fs.existsSync(pending.checks[0].artifact.path));
			return { status: 0, stdout: "done" };
		},
		() => ({ head: "a".repeat(40), tree: "b".repeat(40), sourceDigest: "c" }),
	);
	assert.equal(result.state, "completed");
});
