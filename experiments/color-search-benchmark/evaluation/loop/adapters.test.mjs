import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import {
	createCandidate,
	hsvHistogram,
	buildQueryVector,
	interpretQuery,
} from "./adapters.mjs";

const experimentRoot = path.resolve(import.meta.dirname, "../..");

test("production HSV histogram preserves area, alpha weighting, and achromatic bins", () => {
	const histogram = hsvHistogram(
		Uint8Array.from([
			255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 128,
		]),
	);
	const total = 2 + 128 / 255;
	assert.equal(histogram.length, 64);
	assert.equal(histogram[3], 1 / total);
	assert.equal(histogram[19], 1 / total);
	assert.equal(histogram[63], 128 / 255 / total);
	assert.equal(histogram[48], 0);
});

test("baseline amount scaling is preserved and normalized-L2 declares its loss of absolute amount", () => {
	const forty = interpretQuery({
		colorTargets: [{ colorName: "green", targetImagePercent: 40 }],
		unspecifiedRemainderPercent: 60,
	});
	const eighty = interpretQuery({
		colorTargets: [{ colorName: "green", targetImagePercent: 80 }],
		unspecifiedRemainderPercent: 20,
	});
	assert.equal(forty.supported, true);
	assert.ok(forty.warnings.some((s) => s.includes("whole-image")));
	const a = buildQueryVector(forty.colors);
	const b = buildQueryVector(eighty.colors);
	a.forEach((n, i) => assert.ok(Math.abs(b[i] - 2 * n) < 1e-12));
	const normalized = buildQueryVector(forty.colors, {
		queryNormalization: "unit-sum",
	});
	assert.ok(Math.abs(normalized.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("query interpretation refuses unsupported vibe and grayscale semantics", () => {
	for (const query of [
		{ text: "Dark" },
		{ text: "Grayscale with red accents" },
		{
			colorTargets: [
				{ colorName: "grayscale", targetImagePercent: 80 },
				{ colorName: "red", targetImagePercent: 20 },
			],
		},
		{ colors: [{ color: "#FF0000", amount: 1, hueDistance: 0.2 }] },
	])
		assert.equal(interpretQuery(query).supported, false);
	assert.equal(interpretQuery({ text: "Red" }).supported, true);
	assert.equal(
		interpretQuery({ swatchHex: "#FF2200" }).colors[0].color,
		"#FF2200",
	);
});

test("unknown top-level semantic constraints cannot be silently ignored", () => {
	for (const query of [
		{ swatchHex: "#FF0000", hueDistance: 0.2 },
		{ text: "Red", lightnessRange: [0, 0.2] },
		{
			colorTargets: [{ colorName: "green", targetImagePercent: 40 }],
			qualityFalloff: 0.5,
		},
		{ text: "Red", subjectRequest: "city" },
		{ text: "Red", subjectConstraint: { tag: "city" } },
		{ swatchHex: "#FF0000", colorSpace: "Display P3" },
		null,
		{ text: 42 },
	])
		assert.equal(interpretQuery(query).supported, false, JSON.stringify(query));
	assert.equal(
		interpretQuery({
			text: "Red",
			detail: "An image that feels red",
			colorSpace: "sRGB",
			subjectRequest: null,
			subjectConstraint: null,
			swatchHex: null,
			colorTargets: null,
		}).supported,
		true,
	);
});

test("real image preparation and exact ranking honor eligibility, exclusions and deterministic ties", async () => {
	const runDirectory = await mkdtemp(
		path.join(tmpdir(), "color-eval-adapters-"),
	);
	try {
		const files = [
			["red", "#ff0000"],
			["green", "#00ff00"],
			["red-copy", "#ff0000"],
		];
		for (const [id, color] of files) {
			await writeFile(
				path.join(runDirectory, `${id}.svg`),
				`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${color}"/></svg>`,
			);
		}
		const corpus = files.map(([id]) => ({
			id,
			filename: path.join(runDirectory, `${id}.svg`),
		}));
		const candidate = await createCandidate({
			config: {
				id: "test",
				metric: "cosine",
				execution: "local-exhaustive",
				sigma: 0.06,
			},
			context: { experimentRoot, corpus, runDirectory },
		});
		await assert.rejects(
			candidate.search({ caseData: { query: { text: "Red" } }, limit: 3 }),
			/prepare/,
		);
		const prepared = await candidate.prepare();
		assert.equal(prepared.documents, 3);
		const result = await candidate.search({
			caseData: {
				query: { text: "Red" },
				eligibleIds: ["green", "red-copy"],
				excludedIds: ["red-copy"],
			},
			limit: 3,
		});
		assert.deepEqual(
			result.hits.map((h) => h.id),
			["green"],
		);
		assert.equal(result.totalEligible, 1);
		const all = await candidate.search({
			caseData: { query: { text: "Red" } },
			limit: 3,
		});
		assert.deepEqual(
			all.hits.map((h) => h.id),
			["red", "red-copy", "green"],
		);
		assert.equal(all.exhaustive, true);
		await assert.rejects(
			candidate.search({ caseData: { query: { text: "Red" } }, limit: 0 }),
			/limit/,
		);
		await candidate.close();
	} finally {
		await rm(runDirectory, { recursive: true, force: true });
	}
});

test("OpenSearch index mutation requires an isolated name and explicit creation opt-in", async () => {
	await assert.rejects(
		createCandidate({
			config: {
				id: "unsafe",
				execution: "opensearch-exact",
				opensearch: {
					url: "http://127.0.0.1:9200",
					index: "wallpapers",
					allowCreateIndex: true,
				},
			},
			context: { experimentRoot, corpus: [], runDirectory: tmpdir() },
		}),
		/color-eval-/,
	);
	await assert.rejects(
		createCandidate({
			config: {
				id: "unsafe",
				execution: "opensearch-exact",
				opensearch: {
					url: "http://127.0.0.1:9200",
					index: "color-eval-test",
					allowCreateIndex: false,
				},
			},
			context: { experimentRoot, corpus: [], runDirectory: tmpdir() },
		}),
		/allowCreateIndex/,
	);
});

test("sweep parameters override metric and normalization without changing adapter code", async () => {
	const candidate = await createCandidate({
		config: {
			id: "sweep",
			metric: "cosine",
			parameters: { metric: "l2", queryNormalization: "unit-sum", sigma: 0.08 },
		},
		context: { experimentRoot, corpus: [], runDirectory: tmpdir() },
	});
	assert.equal(candidate.metadata.config.metric, "l2");
	assert.equal(candidate.metadata.config.queryNormalization, "unit-sum");
	assert.equal(candidate.metadata.config.sigma, 0.08);
});

test("unsupported sweep parameters fail rather than generating duplicate ineffective experiments", async () => {
	await assert.rejects(
		createCandidate({
			config: { id: "unknown-sweep", parameters: { weight: 2 } },
			context: { experimentRoot, corpus: [], runDirectory: tmpdir() },
		}),
		/Unsupported HSV adapter parameter: weight/,
	);
});

test("OpenSearch exact requests score every eligible document and retain the isolated index", async () => {
	const requests = [];
	let created = false;
	const server = createServer(async (request, response) => {
		let raw = "";
		for await (const chunk of request) raw += chunk;
		const body = raw && !request.url.endsWith("_bulk") ? JSON.parse(raw) : raw;
		requests.push({ method: request.method, url: request.url, body });
		response.setHeader("content-type", "application/json");
		if (request.url === "/")
			return response.end(JSON.stringify({ version: { number: "2.11.0" } }));
		if (request.method === "PUT") {
			if (created) {
				response.statusCode = 400;
				return response.end(
					JSON.stringify({ error: "resource_already_exists_exception" }),
				);
			}
			created = true;
		}
		const result = request.url.endsWith("_search")
			? {
					hits: {
						total: { value: 1 },
						hits: [{ _source: { wallpaperId: "red" }, _score: 1.99 }],
					},
					took: 2,
					_shards: { failed: 0 },
				}
			: request.url.endsWith("_stats/store")
				? { _all: { total: { store: { size_in_bytes: 500 } } } }
				: { acknowledged: true, errors: false };
		response.end(JSON.stringify(result));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const runDirectory = await mkdtemp(
		path.join(tmpdir(), "color-eval-opensearch-contract-"),
	);
	try {
		const filename = path.join(runDirectory, "red.svg");
		await writeFile(
			filename,
			'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>',
		);
		const options = {
			config: {
				id: "exact-contract",
				execution: "opensearch-exact",
				opensearch: {
					url: `http://127.0.0.1:${server.address().port}`,
					index: "color-eval-contract-test",
					allowCreateIndex: true,
				},
			},
			context: {
				experimentRoot,
				corpus: [{ id: "red", filename }],
				runDirectory,
			},
		};
		const candidate = await createCandidate(options);
		const setup = await candidate.prepare();
		assert.equal(setup.serverVersion, "2.11.0");
		assert.equal(setup.execution.kind, "opensearch-exact");
		const result = await candidate.search({
			caseData: {
				query: { text: "Red" },
				eligibleIds: ["red", "other"],
				excludedIds: ["other"],
			},
			limit: 2,
		});
		assert.deepEqual(result.hits, [{ id: "red", score: 1.99 }]);
		const sent = requests.find((r) => r.url.endsWith("_search")).body;
		assert.deepEqual(sent.query.script_score.query.bool, {
			filter: [{ terms: { wallpaperId: ["red", "other"] } }],
			must_not: [{ terms: { wallpaperId: ["other"] } }],
		});
		assert.equal(sent.query.script_score.script.lang, "knn");
		assert.equal(sent.query.script_score.script.params.query_value.length, 64);
		assert.equal(
			sent.query.script_score.script.params.space_type,
			"cosinesimil",
		);
		assert.equal(sent.track_total_hits, true);
		const again = await createCandidate(options);
		await assert.rejects(again.prepare(), /resource_already_exists/);
		await candidate.close();
		assert.equal(
			requests.some((request) => request.method === "DELETE"),
			false,
		);
	} finally {
		server.close();
		server.closeAllConnections();
		await rm(runDirectory, { recursive: true, force: true });
	}
});
