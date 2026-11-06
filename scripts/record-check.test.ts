import { expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { recordCheck } from "./record-check.ts";
test("check records distinguish expected failures, success and source changes during execution", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "record-check-"));
	t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
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
	expect(red.expectationMet).toBe(true);
	expect(red.checks[0].exitCode).toBe(1);
	expect(fs.existsSync(red.checks[0].artifact.path)).toBeTruthy();
	expect(
		recordCheck(
			{ ...request, expect: "success" },
			() => ({ status: 0, stdout: "pass", stderr: "" }),
			snapshot,
		).expectationMet,
	).toBe(true);
	let count = 0;
	expect(
		recordCheck(
			{ ...request, expect: "success" },
			() => ({ status: 0 }),
			() => ({ ...snapshot(), sourceDigest: String(count++) }),
		).expectationMet,
	).toBe(false);
	expect(
		recordCheck(request, () => ({ status: null, signal: "SIGTERM" }), snapshot)
			.expectationMet,
	).toBe(false);
});

test("a new check invalidates old evidence before execution starts", (t) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pending-check-"));
	t.onTestFinished(() =>
		fs.rmSync(directory, { recursive: true, force: true }),
	);
	const output = path.join(directory, "evidence.json");
	fs.writeFileSync(output, JSON.stringify({ expectationMet: true }));
	const request = { command: ["make", "test"], output, expect: "success" };
	const result = recordCheck(
		request,
		() => {
			const pending = JSON.parse(fs.readFileSync(output, "utf8"));
			expect(pending.expectationMet).toBe(false);
			expect(pending.state).toBe("running");
			expect(fs.existsSync(pending.checks[0].artifact.path)).toBeTruthy();
			return { status: 0, stdout: "done" };
		},
		() => ({ head: "a".repeat(40), tree: "b".repeat(40), sourceDigest: "c" }),
	);
	expect(result.state).toBe("completed");
});
