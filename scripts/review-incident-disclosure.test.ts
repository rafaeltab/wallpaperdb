import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("review-evidence CLI verifies remote incident state, assignment and label before completion", (t) => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const temporary = fs.mkdtempSync(
		path.join(os.tmpdir(), "review-disclosure-"),
	);
	t.onTestFinished(() =>
		fs.rmSync(temporary, { recursive: true, force: true }),
	);
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	const artifact = path.join(temporary, "review.txt");
	fs.writeFileSync(artifact, "Independent fixture review\n");
	const current = { head, baseRef: head, baseSha: head, mergeBase: head };
	const evidence = {
		current,
		automationIncidents: [
			{
				url: "https://github.com/rafaeltab/wallpaperdb/issues/123",
				userNotified: true,
				outcome: "fixed",
			},
		],
		reviews: ["Standards", "Spec", "Defects"].map((axis) => ({
			...current,
			axis,
			reviewer: "fixture",
			task: "disclosure contract",
			diffCommand: "fixture comparison",
			requirements: "Verify incident metadata",
			scope: "CLI disclosure validation",
			outcome: "clean",
			findings: [],
			artifacts: [
				{
					path: artifact,
					sha256: createHash("sha256")
						.update(fs.readFileSync(artifact))
						.digest("hex"),
				},
			],
		})),
	};
	const file = path.join(temporary, "evidence.json");
	fs.writeFileSync(file, JSON.stringify(evidence));
	const calls = path.join(temporary, "calls.jsonl");
	fs.writeFileSync(
		path.join(temporary, "gh"),
		"#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.TOOLING_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.stdout.write(process.env.TOOLING_RESPONSE);\n",
		{ mode: 0o755 },
	);
	const valid = {
		state: "OPEN",
		assignees: [{ login: "rafaeltab" }],
		labels: [{ name: "automation-impact" }],
	};
	for (const [metadata, expected] of [
		[valid, 0],
		[{ ...valid, state: "CLOSED" }, 1],
		[{ ...valid, assignees: [] }, 1],
		[{ ...valid, labels: [] }, 1],
	] as const) {
		const result = spawnSync(
			process.execPath,
			[path.join(root, "scripts/agent-workflow.ts"), "review-evidence", file],
			{
				cwd: root,
				encoding: "utf8",
				timeout: 10000,
				env: {
					...process.env,
					PATH: `${temporary}${path.delimiter}${process.env.PATH}`,
					TOOLING_CALLS: calls,
					TOOLING_RESPONSE: JSON.stringify(metadata),
				},
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(expected);
		if (expected)
			expect(result.stdout).toContain(
				"not an open, labeled report assigned to the user",
			);
	}
	const requests = fs
		.readFileSync(calls, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(requests).toHaveLength(4);
	expect(requests[0]).toContain(evidence.automationIncidents[0].url);
});
