import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	executeRun,
	expandCandidates,
	loadCorpus,
	searchQuery,
} from "./runner.mjs";

const cases = [
	{
		id: "red",
		category: "Perceived color",
		query: { text: "Red" },
		judgedIds: ["a", "b"],
		expectedRankedIds: ["a", "b"],
		preferencePairs: [{ preferred: "a", other: "b", uncertain: false }],
		notes: ["human-only"],
		groupId: "g1",
		inputKind: "image",
	},
	{
		id: "vibe",
		category: "Vibe",
		query: { text: "Almost grayscale" },
		judgedIds: ["a", "b"],
		expectedRankedIds: ["a", "b"],
		preferencePairs: [{ preferred: "b", other: "a", uncertain: true }],
		notes: [],
		groupId: "g1",
		inputKind: "image",
	},
];
const dataset = {
	schemaVersion: 1,
	cases,
	sourceFiles: [],
	evidenceContext: { caveat: "Provisional development evidence" },
};
const corpus = [
	{ id: "a", sha256: "a".repeat(64) },
	{ id: "b", sha256: "b".repeat(64) },
];
const config = {
	schemaVersion: 1,
	workload: {
		warmup: 1,
		repeats: 2,
		concurrency: 1,
		limit: 1,
		accuracyLimit: 10,
		timeoutMs: 100,
	},
	candidates: [{ id: "test", module: "unused.mjs" }],
};

test("runs accuracy separately from timings, strips judgments, persists immutable comparable evidence", async () => {
	const outputRoot = await mkdtemp(path.join(tmpdir(), "color-eval-runner-"));
	let prepared = 0,
		closed = 0;
	const requests = [];
	const createCandidate = async ({ context }) => {
		assert.equal("dataset" in context, false);
		return {
			metadata: {
				id: "test",
				label: "Fixture candidate",
				execution: "local-exhaustive",
				sourceFiles: [],
			},
			supports: (c) => ({
				supported: c.id === "red",
				reason: c.id === "red" ? undefined : "Unsupported vibe",
			}),
			prepare: async () => {
				prepared++;
				return { documentCount: 2 };
			},
			search: async (request) => {
				requests.push(request);
				assert.equal("preferencePairs" in request.caseData, false);
				assert.equal("notes" in request.caseData, false);
				return {
					hits: [
						{ id: "a", score: 1 },
						{ id: "b", score: 0 },
					].slice(0, request.limit),
					totalEligible: 2,
					complete: true,
				};
			},
			close: async () => {
				closed++;
			},
		};
	};
	try {
		const first = await executeRun({
			config,
			dataset,
			corpus,
			outputRoot,
			createCandidate,
		});
		assert.equal(prepared, 1);
		assert.equal(closed, 1);
		assert.deepEqual(
			requests.map((r) => r.limit),
			[10, 1, 1, 1],
		);
		const result = first.run.candidates[0];
		assert.equal(result.cases[0].accuracy.allPairs.agreement, 1);
		assert.equal(result.cases[0].performance.samplesMs.length, 2);
		assert.equal(result.cases[0].timedAccuracy.allPairs.assessedPairs, 0);
		assert.equal(result.cases[0].performance.trials.length, 2);
		assert.equal(
			result.summary.timedAccuracy.allPairs.queryMacroAgreement,
			null,
		);
		assert.equal(result.cases[1].status, "unsupported");
		assert.equal(result.cases[1].accuracy.allPairs.assessedPairs, 0);
		assert.equal(result.summary.coverage.total, 2);
		assert.equal(result.summary.coverage.unsupported, 1);
		assert.equal(result.summary.performance.samplesMs.length, 2);
		assert.equal(result.summary.performance.failures, 0);
		assert.ok(first.run.dataset.hash);
		assert.ok(first.run.dataset.corpusHash);
		assert.equal(first.run.workload.timingScope, "adapter-end-to-end");
		const bytes = await readFile(
			path.join(first.directory, "run.json"),
			"utf8",
		);
		assert.equal(JSON.parse(bytes).id, first.run.id);
		assert.match(
			await readFile(path.join(first.directory, "report.md"), "utf8"),
			/Fixture candidate/,
		);
		await executeRun({ config, dataset, corpus, outputRoot, createCandidate });
		assert.equal(
			await readFile(path.join(first.directory, "run.json"), "utf8"),
			bytes,
		);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test("normalizes old search intent without forwarding embedded judgment annotations", () => {
	const query = searchQuery({
		userText: "40% green",
		specifiedPercentages: [{ colorName: "green", targetImagePercent: 40 }],
		unspecifiedRemainderPercent: 60,
		preciseHex: null,
		priorEvidence: { summary: "A beats B" },
		priorClarification: "20 beats60",
		intent: "Gather preferences",
	});
	assert.deepEqual(query, {
		text: "40% green",
		colorTargets: [{ colorName: "green", targetImagePercent: 40 }],
		unspecifiedRemainderPercent: 60,
	});
	assert.throws(
		() => searchQuery({ text: "red", hueDistance: 0.2 }),
		/Unrecognized search-input/,
	);
});

test("records search failures without scoring missing results as a bad ranking or crashing other candidates", async () => {
	const outputRoot = await mkdtemp(path.join(tmpdir(), "color-eval-failure-"));
	let closed = 0;
	try {
		const result = await executeRun({
			config,
			dataset,
			corpus,
			outputRoot,
			createCandidate: async () => ({
				metadata: { id: "test", execution: "local-exhaustive" },
				prepare: async () => ({}),
				supports: () => ({ supported: true }),
				search: async () => {
					throw Error("backend failed");
				},
				close: async () => {
					closed++;
				},
			}),
		});
		assert.equal(closed, 1);
		assert.equal(result.run.candidates[0].summary.coverage.error, 2);
		assert.equal(
			result.run.candidates[0].summary.accuracy.allPairs.queryMacroAgreement,
			null,
		);
		assert.equal(result.run.candidates[0].summary.performance.p95Ms, null);
		assert.match(result.run.candidates[0].cases[0].reason, /backend failed/);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test("timeout aborts the adapter and is preserved as failure, not successful low latency", async () => {
	const outputRoot = await mkdtemp(path.join(tmpdir(), "color-eval-timeout-"));
	let aborted = false;
	try {
		const result = await executeRun({
			config: { ...config, workload: { ...config.workload, timeoutMs: 10 } },
			dataset: { ...dataset, cases: cases.slice(0, 1) },
			corpus,
			outputRoot,
			createCandidate: async () => ({
				metadata: { id: "test", execution: "local-exhaustive" },
				prepare: async () => ({}),
				supports: () => ({ supported: true }),
				search: ({ signal }) =>
					new Promise((resolve, reject) =>
						signal.addEventListener(
							"abort",
							() => {
								aborted = true;
								reject(signal.reason);
							},
							{ once: true },
						),
					),
				close: async () => {},
			}),
		});
		assert.equal(aborted, true);
		assert.equal(result.run.candidates[0].cases[0].status, "error");
		assert.match(result.run.candidates[0].cases[0].reason, /timed out/i);
		assert.equal(
			result.run.candidates[0].cases[0].performance.samplesMs.length,
			0,
		);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test("expands parameter sweeps without selecting methods and rejects conflicting identities", () => {
	const expanded = expandCandidates([
		{
			id: "method",
			module: "./custom.mjs",
			parameters: { fixed: 1 },
			sweep: { sigma: [0.06, 0.1], weight: [1, 2] },
		},
	]);
	assert.equal(expanded.length, 4);
	assert.equal(new Set(expanded.map((c) => c.id)).size, 4);
	assert.deepEqual(
		expanded.map((c) => c.parameters),
		[
			{ fixed: 1, sigma: 0.06, weight: 1 },
			{ fixed: 1, sigma: 0.06, weight: 2 },
			{ fixed: 1, sigma: 0.1, weight: 1 },
			{ fixed: 1, sigma: 0.1, weight: 2 },
		],
	);
	assert.throws(
		() => expandCandidates([{ id: "same" }, { id: "same" }]),
		/duplicate/i,
	);
	assert.throws(
		() => expandCandidates([{ id: "method", sweep: { sigma: [] } }]),
		/empty/i,
	);
});

test("corpus preparation verifies image hashes before performance work", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "color-eval-corpus-"));
	try {
		await writeFile(path.join(root, "image.png"), "changed bytes");
		await writeFile(
			path.join(root, "corpus-manifest.json"),
			JSON.stringify([
				{ id: "a", filename: "image.png", sha256: "0".repeat(64) },
			]),
		);
		await assert.rejects(loadCorpus(root, { cases: [] }), /hash.*mismatch/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("concurrent warmups finish before timing, and first issued trial determines timed accuracy", async () => {
	const outputRoot = await mkdtemp(
		path.join(tmpdir(), "color-eval-concurrent-"),
	);
	let calls = 0,
		warmupsDone = 0;
	try {
		const result = await executeRun({
			config: {
				...config,
				workload: {
					...config.workload,
					warmup: 2,
					repeats: 2,
					concurrency: 2,
					limit: 2,
				},
			},
			dataset: { ...dataset, cases: cases.slice(0, 1) },
			corpus,
			outputRoot,
			createCandidate: async () => ({
				metadata: { id: "test", execution: "local-exhaustive" },
				supports: () => ({ supported: true }),
				async search() {
					const index = calls++;
					if (index === 1 || index === 2) {
						await new Promise((resolve) => setTimeout(resolve, 5));
						warmupsDone++;
					}
					if (index >= 3) assert.equal(warmupsDone, 2);
					if (index === 3)
						await new Promise((resolve) => setTimeout(resolve, 10));
					return {
						hits:
							index === 4
								? [
										{ id: "b", score: 1 },
										{ id: "a", score: 0 },
									]
								: [
										{ id: "a", score: 1 },
										{ id: "b", score: 0 },
									],
					};
				},
			}),
		});
		const row = result.run.candidates[0].cases[0];
		assert.equal(row.performance.trials.length, 2);
		assert.equal(row.timedAccuracy.allPairs.agreement, 1);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});
