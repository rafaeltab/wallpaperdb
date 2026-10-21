import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateReview, summarize } from "./protocol.mjs";

test("offline corpus controls execute green and the live runner requires explicit opt-in", () => {
	const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
	const offline = spawnSync(process.execPath, [cli, "controls"], {
		encoding: "utf8",
		timeout: 30000,
	});
	assert.equal(offline.status, 0, offline.stderr + offline.stdout);
	assert.match(offline.stdout, /seed suites passed/);
	const denied = spawnSync(process.execPath, [cli, "run"], {
		encoding: "utf8",
		timeout: 5000,
	});
	assert.notEqual(denied.status, 0);
	assert.match(denied.stderr, /--live/);
});

test("live runner records usage and rejects bad model citations through its public CLI", () => {
	const dir = mkdtempSync(join(tmpdir(), "review-control-"));
	try {
		const fake = join(dir, "fake-codex");
		writeFileSync(
			fake,
			`#!/usr/bin/env node\nconst fs=require('node:fs'); const a=process.argv.slice(2); if(a.includes('--version')){console.log('fixture 1');process.exit(0);} fs.writeFileSync(a[a.indexOf('-o')+1],process.env.FIXTURE_REVIEW); console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:0,output_tokens:2}}));`,
			{ mode: 0o700 },
		);
		const cli = fileURLToPath(new URL("./cli.mjs", import.meta.url));
		const bundle = join(dir, "packet.json");
		writeFileSync(bundle, JSON.stringify(packet));
		for (const [name, reply, success] of [
			["valid", { findings: [finding] }, true],
			[
				"invalid",
				{
					findings: [
						{ ...finding, test: { ...finding.test, quote: "invented" } },
					],
				},
				false,
			],
		]) {
			const output = join(dir, name);
			const r = spawnSync(
				process.execPath,
				[
					cli,
					"run",
					"--live",
					"--packet",
					bundle,
					"--out",
					output,
					"--repeats",
					"1",
				],
				{
					encoding: "utf8",
					timeout: 10000,
					env: {
						...process.env,
						REVIEW_CODEX_BIN: fake,
						FIXTURE_REVIEW: JSON.stringify(reply),
					},
				},
			);
			assert.equal(r.status === 0, success, r.stderr);
			const saved = JSON.parse(
				readFileSync(join(output, "run-1.json"), "utf8"),
			);
			assert.equal(saved.valid, success);
			assert.equal(saved.usage.input_tokens, 10);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

const packet = {
	cases: [
		{
			id: "C1",
			files: [
				{
					path: "case.test.mjs",
					role: "test",
					text: "assert.equal(actual, actual);",
				},
				{
					path: "requirement.md",
					role: "requirement",
					text: "Return the specified independent value.",
				},
			],
		},
	],
};
const finding = {
	caseId: "C1",
	category: "self-derived",
	title: "Circular expectation",
	test: {
		path: "case.test.mjs",
		line: 1,
		quote: "assert.equal(actual, actual);",
	},
	support: {
		path: "requirement.md",
		line: 1,
		quote: "Return the specified independent value.",
	},
	failure: "A wrong result passes when compared with itself.",
	correction: "Assert the literal specified value.",
};

test("accepts a supported finding and a clean result", () => {
	assert.deepEqual(validateReview({ findings: [finding] }, packet), {
		findings: [finding],
	});
	assert.deepEqual(validateReview({ findings: [] }, packet), { findings: [] });
});
test("rejects fabricated citations, missing evidence, unknown cases and categories", () => {
	for (const change of [
		{ test: { ...finding.test, quote: "not in source" } },
		{ support: null },
		{ caseId: "unknown" },
		{ category: "too-long" },
		{ test: { ...finding.test, line: 2 } },
		{ failure: "" },
	])
		assert.throws(() =>
			validateReview({ findings: [{ ...finding, ...change }] }, packet),
		);
});
test("repeat copies do not increase independently judged denominator and pending is not precision", () => {
	const runs = [
		{
			findings: [finding],
			elapsedMs: 10,
			usage: { input_tokens: 100, output_tokens: 20 },
		},
		{
			findings: [finding],
			elapsedMs: 20,
			usage: { input_tokens: 100, output_tokens: 20 },
		},
	];
	const pending = summarize(runs, []);
	assert.equal(pending.uniqueFindings.length, 1);
	assert.equal(pending.humanPrecision, null);
	const judged = summarize(runs, [
		{
			key: pending.uniqueFindings[0].key,
			verdict: "false-positive",
			judgeKind: "human",
			rationale: "This is a contract fixture.",
		},
	]);
	assert.equal(judged.humanPrecision, 0);
	assert.equal(judged.humanJudged, 1);
	assert.equal(judged.thresholdValidated, false);
	assert.equal(judged.totalMs, 30);
});
test("agent judgments cannot masquerade as human judgments", () => {
	const result = summarize(
		[{ findings: [finding], elapsedMs: 1, usage: {} }],
		[],
	);
	const key = result.uniqueFindings[0].key;
	assert.equal(
		summarize(
			[{ findings: [finding], elapsedMs: 1, usage: {} }],
			[
				{
					key,
					verdict: "actionable",
					judgeKind: "agent",
					rationale: "Provisional.",
				},
			],
		).humanPrecision,
		null,
	);
});
