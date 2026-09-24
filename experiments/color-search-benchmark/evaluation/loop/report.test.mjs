import test from "node:test";
import assert from "node:assert/strict";
import { compareRuns, renderHtml, renderMarkdown } from "./report.mjs";
import { evaluateRanking } from "./metrics.mjs";

test("legacy query.userText appears as readable query text in tables and galleries", () => {
	const run = fixture();
	const row = run.candidates[0].cases[0];
	row.query = {
		userText: "40% green, the rest unrestricted",
		targets: [{ color: "green", amount: 40 }],
	};
	row.inputKind = "image";
	row.availableImageIds = ["a"];
	row.orderGroups = [["a"]];
	assert.match(
		renderMarkdown(run),
		/\| case-one \| 40% green, the rest unrestricted \|/,
	);
	assert.match(
		renderHtml(run),
		/<summary>case-one · ok · 40% green, the rest unrestricted<\/summary>/,
	);
});

const accuracy = (agreement) => ({
	totalCases: 1,
	allPairs: {
		queryMacroAgreement: agreement,
		completeCaseMacroAgreement: agreement,
		assessedCases: 1,
		totalCases: 1,
		assessedPairs: 6,
		totalPairs: 6,
		pairCoverage: 1,
	},
	withoutUncertain: {
		queryMacroAgreement: agreement,
		completeCaseMacroAgreement: agreement,
		assessedCases: 1,
		totalCases: 1,
		assessedPairs: 5,
		totalPairs: 5,
		pairCoverage: 1,
	},
	imageCoverage: { expected: 4, returned: 4, fraction: 1 },
	eligibilityViolations: 0,
});

function fixture(agreement = 0.75, p95Ms = 12) {
	const caseAccuracy = {
		allPairs: { agreement, assessedPairs: 6, totalPairs: 6, coverage: 1 },
		withoutUncertain: {
			agreement,
			assessedPairs: 5,
			totalPairs: 5,
			coverage: 1,
		},
		coverage: {
			expectedIds: ["a", "b", "c", "d"],
			returnedIds: ["a", "b", "c", "d"],
			missingIds: [],
			fraction: 1,
		},
		eligibility: { violations: 0, excludedReturned: [] },
		discrepancies: [
			{ preferred: "a", other: "b", outcome: "discordant", uncertain: false },
		],
	};
	return {
		schemaVersion: 1,
		id: "run-current",
		createdAt: "2026-09-19T00:00:00.000Z",
		dataset: {
			hash: "dataset-hash",
			corpusHash: "corpus-hash",
			caseCount: 1,
			sourceHashes: { judgments: "judgment-hash" },
			evidenceContext: {
				reviewerCount: 1,
				independentSampleCount: null,
				quickPass: {
					rawUserMessage:
						"I went quite quickly; people may rank these differently.",
				},
				notes: ["Development evidence only."],
			},
		},
		environment: {
			node: "v22.0.0",
			platform: "linux",
			cpuCount: 8,
			cpuModel: "test-cpu",
			totalMemoryBytes: 123456,
		},
		workload: { warmup: 2, repeats: 10, concurrency: 1, limit: 20 },
		candidates: [
			{
				id: "candidate",
				label: "Example method",
				configuration: { weight: 1 },
				execution: { kind: "local-reference" },
				sourceHashes: { adapter: "source-hash" },
				setup: { elapsedMs: 5 },
				cases: [
					{
						caseId: "case-one",
						category: "Proportions",
						query: { text: "40% green" },
						status: "ok",
						accuracy: caseAccuracy,
						hits: [{ id: "a", score: 1 }],
						performance: {
							samplesMs: [10, p95Ms],
							p50Ms: 10,
							p95Ms,
							maxMs: p95Ms,
							failures: 0,
						},
					},
				],
				summary: {
					accuracy: {
						...accuracy(agreement),
						categories: { Proportions: accuracy(agreement) },
					},
					performance: {
						samplesMs: [10, p95Ms],
						p50Ms: 10,
						p95Ms,
						maxMs: p95Ms,
						failures: 0,
					},
					coverage: { ok: 1, unsupported: 0, error: 0, total: 1 },
				},
			},
		],
	};
}

test("reports accuracy, coverage and latency separately with original evidence caveats", () => {
	const run = fixture();
	run.candidates[0].cases[0].rankingCondition =
		"Assuming C matches the city tag.";
	const markdown = renderMarkdown(run);
	assert.match(markdown, /75\.0%/);
	assert.match(markdown, /12\.00 ms/);
	assert.match(markdown, /Proportions/);
	assert.match(
		markdown,
		/I went quite quickly; people may rank these differently\./,
	);
	assert.match(markdown, /No combined score/i);
	assert.match(markdown, /local-reference/);
	assert.match(markdown, /100 million/i);
	assert.match(markdown, /discordant/);
	assert.match(markdown, /Condition: Assuming C matches the city tag\./);
	assert.match(markdown, /Resource observations/);
	assert.match(markdown, /not isolated candidate peaks/);
});

test("allows intentional configuration and implementation changes while exposing regressions", () => {
	const previous = fixture(1, 10);
	previous.id = "run-previous";
	const run = fixture(0.5, 14);
	run.candidates[0].configuration.weight = 2;
	run.candidates[0].sourceHashes.adapter = "new-source";
	const comparison = compareRuns(run, previous);
	const candidate = comparison.candidates[0];
	assert.equal(comparison.accuracy.comparable, true);
	assert.equal(candidate.configurationChanged, true);
	assert.equal(candidate.sourceChanged, true);
	assert.equal(candidate.accuracy.delta, -0.5);
	assert.equal(candidate.performance.comparable, true);
	assert.equal(candidate.performance.p95DeltaMs, 4);
	assert.equal(candidate.cases[0].delta, -0.5);
	assert.match(renderMarkdown(run, previous), /-50\.0 pp/);
	assert.match(renderMarkdown(run, previous), /configuration changed/i);
});

test("blocks invalid latency comparisons without hiding same-evidence accuracy comparisons", () => {
	for (const mutate of [
		(run) => {
			run.candidates[0].execution = {
				kind: "opensearch",
				version: "2.11.0",
				topology: { shards: 1 },
			};
		},
		(run) => {
			run.workload.limit = 40;
		},
		(run) => {
			run.environment.cpuModel = "different-cpu";
		},
		(run) => {
			delete run.candidates[0].execution;
		},
		(run) => {
			run.candidates[0].summary.performance.failures = 1;
		},
	]) {
		const previous = fixture();
		const run = fixture();
		mutate(run);
		const comparison = compareRuns(run, previous).candidates[0];
		assert.equal(comparison.accuracy.comparable, true);
		assert.equal(comparison.performance.comparable, false);
		assert.equal(comparison.performance.p95DeltaMs, null);
		assert.ok(comparison.performance.reasons.length);
	}
});

test("dataset or corpus changes block ranking and latency deltas", () => {
	for (const field of ["hash", "corpusHash"]) {
		const previous = fixture();
		const run = fixture();
		run.dataset[field] = "changed";
		const comparison = compareRuns(run, previous);
		assert.equal(comparison.accuracy.comparable, false);
		assert.equal(comparison.candidates[0].accuracy.delta, null);
		assert.equal(comparison.candidates[0].performance.p95DeltaMs, null);
		assert.equal(comparison.candidates[0].cases[0].delta, null);
	}
});

test("changed ranking discrepancies allow deltas while changed assessed pairs do not", () => {
	const previous = fixture();
	const run = fixture();
	const caseData = {
		id: "case-one",
		category: "Proportions",
		judgedIds: ["a", "b", "c"],
		preferencePairs: [
			{ preferred: "a", other: "b" },
			{ preferred: "a", other: "c" },
			{ preferred: "b", other: "c" },
		],
	};
	previous.candidates[0].cases[0].accuracy = evaluateRanking(caseData, [
		{ id: "a", score: 3 },
		{ id: "b", score: 2 },
		{ id: "c", score: 1 },
	]);
	run.candidates[0].cases[0].accuracy = evaluateRanking(caseData, [
		{ id: "a", score: 2 },
		{ id: "b", score: 3 },
		{ id: "c", score: 1 },
	]);
	assert.equal(
		compareRuns(run, previous).candidates[0].cases[0].delta,
		2 / 3 - 1,
	);
	run.candidates[0].cases[0].accuracy = evaluateRanking(caseData, [
		{ id: "a", score: 3 },
		{ id: "b", score: 2 },
	]);
	const result = compareRuns(run, previous).candidates[0];
	assert.equal(result.accuracy.comparable, false);
	assert.equal(result.accuracy.delta, null);
	assert.equal(result.cases[0].delta, null);
});

test("OpenSearch latency deltas require matching version and topology metadata", () => {
	const previous = fixture();
	const run = fixture();
	previous.candidates[0].execution = {
		kind: "opensearch",
		version: "2.11.0",
		topology: { shards: 1 },
	};
	run.candidates[0].execution = structuredClone(
		previous.candidates[0].execution,
	);
	assert.equal(
		compareRuns(run, previous).candidates[0].performance.comparable,
		true,
	);
	run.candidates[0].execution.version = "2.19.2";
	assert.equal(
		compareRuns(run, previous).candidates[0].performance.comparable,
		false,
	);
	delete previous.candidates[0].execution.topology;
	run.candidates[0].execution = structuredClone(
		previous.candidates[0].execution,
	);
	assert.equal(
		compareRuns(run, previous).candidates[0].performance.comparable,
		false,
	);
});

test("ClickHouse reports retain backend identity and require version/topology for latency comparisons", () => {
	const previous = fixture();
	const run = fixture();
	previous.candidates[0].execution = { kind: "clickhouse", version: "26.3", topology: { replicas: 1 } };
	run.candidates[0].execution = structuredClone(previous.candidates[0].execution);
	assert.equal(compareRuns(run, previous).candidates[0].performance.comparable, true);
	delete previous.candidates[0].execution.topology;
	run.candidates[0].execution = structuredClone(previous.candidates[0].execution);
	assert.equal(compareRuns(run, previous).candidates[0].performance.comparable, false);
	const markdown = renderMarkdown(run);
	assert.match(markdown, /clickhouse/);
	assert.match(markdown, /Backend CPU/);
	assert.doesNotMatch(markdown, /\| OpenSearch CPU \|/);
});

test("new and removed methods and unsupported cases stay visible without fake zero measurements", () => {
	const previous = fixture();
	const run = fixture(null, null);
	run.candidates[0].id = "new-method";
	run.candidates[0].cases[0].status = "unsupported";
	run.candidates[0].cases[0].reason = "Arbitrary hue range unavailable";
	run.candidates[0].cases[0].performance.samplesMs = [];
	run.candidates[0].summary.performance = {
		samplesMs: [],
		p50Ms: null,
		p95Ms: null,
		maxMs: null,
		failures: 0,
	};
	run.candidates[0].summary.coverage = {
		ok: 0,
		unsupported: 1,
		error: 0,
		total: 1,
	};
	const comparison = compareRuns(run, previous);
	assert.deepEqual(
		comparison.candidates.map((row) => row.status),
		["new", "removed"],
	);
	const markdown = renderMarkdown(run, previous);
	assert.match(markdown, /unsupported/);
	assert.match(markdown, /Arbitrary hue range unavailable/);
	assert.match(markdown, /n\/a/);
	assert.doesNotMatch(markdown, /null ms|0\.00 ms/);
});

test("HTML escapes all data and remains standalone without scripts or remote assets", () => {
	const run = fixture();
	run.candidates[0].label = '<script>alert("label")</script>';
	run.candidates[0].cases[0].query.text = "<img src=x onerror=alert(1)>";
	run.dataset.evidenceContext.notes.push("</pre><script>alert(2)</script>");
	const html = renderHtml(run);
	assert.match(html, /&lt;script&gt;/);
	assert.match(html, /&lt;img/);
	assert.doesNotMatch(html, /<script|<img|<link|<iframe/i);
	assert.match(html, /<table/);
	assert.match(html, /<details/);
});

test("large diagnostics stay in the raw run artifact without bloating or mutating reports", () => {
	const run = fixture();
	run.candidates[0].setup.largeMeasurement = "diagnostic-payload-".repeat(10000);
	const original = JSON.stringify(run);
	for (const output of [renderMarkdown(run), renderHtml(run)]) {
		assert.match(output, /Large diagnostic payload omitted/);
		assert.match(output, /run\.json/);
		assert.ok(output.length < 100000);
	}
	assert.equal(JSON.stringify(run), original);
});

test("method limitations and per-query approximation warnings remain visible", () => {
	const run = fixture();
	run.candidates[0].metadata = {
		approximation: "Exhaustive HSV reference only",
		limitations: ["Whole-image remainder semantics are unsupported."],
	};
	run.candidates[0].cases[0].searchEvidence = {
		semanticsWarnings: ["Amounts are historical mixture weights."],
		index: "color-eval-example",
	};
	for (const output of [renderMarkdown(run), renderHtml(run)]) {
		assert.match(output, /Exhaustive HSV reference only/);
		assert.match(output, /Whole-image remainder semantics are unsupported\./);
		assert.match(output, /Amounts are historical mixture weights\./);
		assert.match(output, /color-eval-example/);
	}
});

test("visual comparison preserves partial human ties and model ties without gallerying unjudged hits", () => {
	const run = fixture();
	const row = run.candidates[0].cases[0];
	row.inputKind = "image";
	row.availableImageIds = ["a", "b", "c", "d"];
	row.orderGroups = [["a"], ["b", "c"]];
	row.hits = [
		{ id: "unjudged", score: 10 },
		{ id: "a", score: 3 },
		{ id: "b", score: 2 },
		{ id: "c", score: 2 },
	];
	const html = renderHtml(run);
	assert.match(html, /Submitted preference groups/);
	assert.match(html, /Human tie/);
	assert.match(html, /Model score tie/);
	assert.match(html, /No submitted ordering for/);
	assert.match(html, /Not returned by this method/);
	assert.match(html, /src="\.\/images\/a"/);
	assert.match(html, /src="\.\/images\/d"/);
	assert.doesNotMatch(html, /src="\.\/images\/unjudged"/);
	assert.match(html, /Unjudged retrieved IDs/);
	assert.match(html, /img-src 'self'/);
});

test("gallery skips conceptual cases and unavailable assets, and safely encodes image IDs", () => {
	const run = fixture();
	const row = run.candidates[0].cases[0];
	row.inputKind = "conceptual";
	row.availableImageIds = ["a"];
	row.orderGroups = [["a"]];
	assert.doesNotMatch(renderHtml(run), /<img/);
	row.inputKind = "image";
	row.availableImageIds = [];
	assert.doesNotMatch(renderHtml(run), /<img/);
	row.availableImageIds = ["a/<test>"];
	row.orderGroups = [["a/<test>"]];
	row.accuracy.coverage.expectedIds = ["a/<test>"];
	const html = renderHtml(run);
	assert.match(html, /src="\.\/images\/a%2F%3Ctest%3E"/);
	assert.doesNotMatch(html, /<test>/);
});

test("separates large-window diagnostic accuracy from the first sample at the timed search limit", () => {
	const run = fixture(1);
	const previous = fixture(1);
	run.workload.accuracyLimit = 1000;
	previous.workload.accuracyLimit = 1000;
	run.candidates[0].summary.timedAccuracy = accuracy(0.5);
	previous.candidates[0].summary.timedAccuracy = accuracy(0.75);
	run.candidates[0].cases[0].timedAccuracy = structuredClone(
		run.candidates[0].cases[0].accuracy,
	);
	previous.candidates[0].cases[0].timedAccuracy = structuredClone(
		previous.candidates[0].cases[0].accuracy,
	);
	run.candidates[0].cases[0].timedAccuracy.allPairs.agreement = 0.5;
	previous.candidates[0].cases[0].timedAccuracy.allPairs.agreement = 0.75;
	const markdown = renderMarkdown(run, previous);
	assert.match(markdown, /Large-window ranking diagnostic/);
	assert.match(markdown, /Timed-search accuracy \(first measured sample\)/);
	assert.match(markdown, /50\.0%/);
	assert.match(markdown, /-25\.0 pp/);
	assert.equal(
		compareRuns(run, previous).candidates[0].timedAccuracy.delta,
		-0.25,
	);
	run.workload.limit = 10;
	assert.equal(
		compareRuns(run, previous).candidates[0].timedAccuracy.delta,
		null,
	);
});
