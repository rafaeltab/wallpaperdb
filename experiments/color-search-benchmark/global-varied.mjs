// Changing-query workload on the existing scratch index; never builds or mutates data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
	ROOT,
	api,
	readJson,
	saveJson,
	distribution,
	randomGenerator,
	waitForIdle,
} from "./global-common.mjs";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import { multiQuery, boundedMultiSearch } from "./global-multi.mjs";
import { closePit } from "./global-bounded.mjs";

const INDEX = "color-global-multi-1000000-v1";
const SEED = 0x6016a71e;
const SIZE = 20;
const SOURCE_FILES = [
	"global-varied.mjs",
	"global-multi.mjs",
	"global-multi-fast-source.mjs",
	"global-joint.mjs",
	"global-joint-bounded.mjs",
	"global-bounded.mjs",
	"global-common.mjs",
	"global-native.mjs",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashes = async () =>
	Object.fromEntries(
		await Promise.all(
			SOURCE_FILES.map(async (file) => [
				file,
				sha(await readFile(new URL(file, ROOT))),
			]),
		),
	);

function shuffle(items, random) {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

export function buildQueries() {
	const random = randomGenerator(SEED);
	const queries = [];
	let partitionNumber = 0;
	for (let i = 0; i < 60; i++) {
		const regions = [1, 2, 3, 5][i % 4];
		const families = shuffle(
			NATIVE_FAMILIES.map((f) => f.id),
			random,
		).slice(0, regions);
		// Spans both endpoints and 58 distinct intermediate totals, independent of region count.
		const totalPercent = 40 + ((i * 17) % 61);
		const amounts = Array(regions).fill(1);
		for (let point = regions; point < totalPercent; point++)
			amounts[Math.floor(random() * regions)]++;
		const filtered = (Math.floor(i / 4) + (i % 4)) % 2 === 1;
		const partition = filtered ? (11 + partitionNumber++ * 37) % 100 : null;
		const colors = families.map((family, j) => ({
			family,
			amount: amounts[j] / 100,
		}));
		queries.push({
			id: `varied-${String(i + 1).padStart(2, "0")}`,
			regions,
			totalPercent,
			colors,
			selectivity: filtered ? "one_percent" : "all",
			partition,
			filters: filtered ? [{ term: { partition } }] : [],
		});
	}
	shuffle(queries, random);
	queries.forEach((query, order) => {
		query.order = order;
		query.methodOrder =
			order % 2 ? ["exhaustive", "adaptive"] : ["adaptive", "exhaustive"];
	});
	assert.equal(queries.length, 60);
	assert.equal(
		new Set(
			queries.map((q) =>
				JSON.stringify(
					[...q.colors].sort((a, b) => a.family.localeCompare(b.family)),
				),
			),
		).size,
		60,
	);
	assert.equal(queries.filter((q) => q.selectivity === "all").length, 30);
	assert.equal(
		new Set(queries.filter((q) => q.partition !== null).map((q) => q.partition))
			.size,
		30,
	);
	assert.equal(
		new Set(queries.flatMap((q) => q.colors.map((c) => c.family))).size,
		NATIVE_FAMILIES.length,
	);
	for (const regions of [1, 2, 3, 5])
		assert.equal(queries.filter((q) => q.regions === regions).length, 15);
	for (const q of queries) {
		assert.equal(new Set(q.colors.map((c) => c.family)).size, q.regions);
		assert.ok(
			q.colors.every(
				(c) =>
					c.amount > 0 &&
					Math.abs(c.amount * 100 - Math.round(c.amount * 100)) < 1e-10,
			),
		);
		assert.ok(q.totalPercent >= 40 && q.totalPercent <= 100);
		assert.ok(
			Math.abs(
				q.colors.reduce((sum, c) => sum + c.amount, 0) * 100 - q.totalPercent,
			) < 1e-10,
		);
	}
	return queries;
}

async function indexState() {
	const stats = (await api(`/${INDEX}/_stats/docs,indexing`)).body.indices[
		INDEX
	];
	return {
		uuid: stats.uuid,
		documents: stats.primaries.docs.count,
		deleted: stats.primaries.docs.deleted,
		indexedOperations: stats.primaries.indexing.index_total,
		deletedOperations: stats.primaries.indexing.delete_total,
	};
}

function normalizedHits(hits) {
	assert.equal(
		hits.length,
		SIZE,
		"Every selected partition has enough documents for 20 hits.",
	);
	assert.equal(
		new Set(hits.map((h) => h._id)).size,
		SIZE,
		"Duplicate hit IDs.",
	);
	return hits.map((hit) => {
		assert.ok(Number.isFinite(hit._score), "Missing score.");
		return { id: hit._id, score: Math.fround(hit._score) };
	});
}

async function run(method, query) {
	const started = performance.now();
	if (method === "adaptive") {
		const result = await boundedMultiSearch(INDEX, query.colors, {
			size: SIZE,
			filter: query.filters,
			scriptVariant: "typed",
			timeout: "15s",
		});
		let hits;
		try {
			hits = normalizedHits(result.hits);
		} finally {
			await closePit(result.pitId);
		}
		return {
			hits,
			wallMs: performance.now() - started,
			requests: result.timing.requests + 1,
			searchQueries: result.diagnostics.iterations.length,
			threshold: result.threshold,
			iterations: result.diagnostics.iterations,
			pitClosed: true,
		};
	}
	const response = await api(
		`/${INDEX}/_search?allow_partial_search_results=false`,
		multiQuery(query.colors, {
			size: SIZE,
			filters: query.filters,
			scriptVariant: "typed",
			timeout: "15s",
		}),
	);
	assert.equal(
		response.body.timed_out,
		false,
		"Timed-out exhaustive reference.",
	);
	assert.equal(
		response.body._shards.failed,
		0,
		"Partial exhaustive reference.",
	);
	assert.ok(
		!response.body.terminated_early,
		"Terminated exhaustive reference.",
	);
	return {
		hits: normalizedHits(response.body.hits.hits),
		wallMs: performance.now() - started,
		took: response.body.took,
		requests: 1,
		searchQueries: 1,
	};
}

function summarize(report) {
	const queries = new Map(report.queries.map((q) => [q.id, q]));
	const groups = [];
	for (const [stage, rows] of [
		["sequential", report.sequential],
		["concurrency4", report.concurrent],
	]) {
		for (const method of stage === "sequential"
			? ["exhaustive", "adaptive"]
			: ["adaptive"]) {
			const measures = rows
				.filter((row) => row[method])
				.map((row) => ({ ...queries.get(row.query), ...row[method] }));
			for (const regions of [null, 1, 2, 3, 5])
				for (const selectivity of regions === null
					? [null]
					: ["all", "one_percent"]) {
					const subset = measures.filter(
						(row) =>
							(regions === null || row.regions === regions) &&
							(selectivity === null || row.selectivity === selectivity),
					);
					if (subset.length)
						groups.push({
							stage,
							method,
							regions,
							selectivity,
							wallMs: distribution(subset.map((row) => row.wallMs)),
							requests: distribution(subset.map((row) => row.requests)),
							searchQueries: distribution(
								subset.map((row) => row.searchQueries),
							),
							...(method === "adaptive"
								? {
										threshold: distribution(subset.map((row) => row.threshold)),
									}
								: {}),
						});
				}
		}
	}
	report.summary = groups;
}

function markdown(report) {
	const lines = [
		"# Changing-query OpenSearch workload",
		"",
		`Status: **${report.status}**. Generated ${report.generatedAt}; ${report.completedAt ? `completed ${report.completedAt}` : "execution is not complete"}.`,
		"",
		"## Scope",
		"",
		"This changes the color families, requested amounts, and metadata partitions between searches. It does **not** measure a cold node: the existing index, operating-system page cache, compiled scripts, and some fields were already exercised by earlier experiments. No caches were flushed. Ordinary OpenSearch query caches may reuse metadata or range filters.",
		"",
		"- One million synthetic descriptors made from mixtures of the 100 original-image/20 fixture descriptors; this is not one million independent wallpapers.",
		"- 60 deterministic unique queries: 15 each with 1, 2, 3, or 5 distinct families, covering all 18 experimental families. Positive integer-percentage amounts total 40–100%.",
		"- 30 queries search the full index; 30 use distinct partitions, each selecting 10,000 documents (1%).",
		"- Deterministically shuffled query order, alternating which method runs first. Each method runs each query once in the sequential pass; the second method can benefit from the first method accessing the same fields.",
		"- Both methods request the typed scoring variant and use the same hard membership model and target-amount objective. One/two-family queries retain the existing numeric fast path. No service reranking or fixed candidate limit.",
		"- Preflight checks read index statistics and aggregate partition counts; that aggregation can warm metadata. They do not execute any of the color queries.",
		"- Every ordered top 20 ID and float32 score is compared. Adaptive query latency includes PIT creation, widening searches, and PIT cleanup; exhaustive latency includes its single search request. Index mutation counters are checked before and after the pass.",
		"- The concurrency 4 pass repeats the same 60 queries once with adaptive search only, after the sequential pass has warmed some fields and filters. Each concurrent result is also checked against its exhaustive reference.",
		"",
		`Index: \`${report.index}\`; recorded count: ${report.indexCount ?? "pending"}. Data cache key: \`${report.dataCacheKey ?? "pending"}\`. The JSON artifact records source/data hashes, index fingerprint, method order, all results, timings, request counts, thresholds, and failures.`,
		"",
		"## Results",
		"",
		`Sequential comparisons passed: **${report.sequential.filter((row) => row.passed).length}/60**. Concurrent results verified: **${report.concurrent.filter((row) => row.passed).length}/60**. Failures: **${report.failures.length}**.`,
		"",
		"| Pass | Method | Regions | Filter | n | Median ms | p95 ms | Max ms | Median requests |",
		"| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
	];
	for (const row of report.summary)
		lines.push(
			`| ${row.stage} | ${row.method} | ${row.regions ?? "all"} | ${row.selectivity ?? "mixed"} | ${row.wallMs.samples} | ${row.wallMs.median.toFixed(1)} | ${row.wallMs.p95.toFixed(1)} | ${row.wallMs.max.toFixed(1)} | ${row.requests.median} |`,
		);
	lines.push(
		"",
		"Per-group samples are only 7 or 8 changing queries; their p95 is the largest observation, not a stable production tail estimate. The distribution represents this generated query mix. The family bank remains experimental and has not been validated by human relevance judgments.",
		"",
	);
	if (report.concurrentElapsedMs !== undefined)
		lines.push(
			`Concurrency 4 elapsed: ${(report.concurrentElapsedMs / 1000).toFixed(2)} s; ${(report.concurrent.length / (report.concurrentElapsedMs / 1000)).toFixed(1)} completed queries/s for this one finite pass.`,
			"",
		);
	if (report.failures.length) {
		lines.push("### Failures", "");
		for (const failure of report.failures)
			lines.push(
				`- ${failure.stage}${failure.query ? ` / ${failure.query}` : ""}${failure.method ? ` / ${failure.method}` : ""}: ${String(failure.error).replaceAll("\n", " ").replaceAll("|", "\\|")}`,
			);
		lines.push("");
	}
	lines.push(
		"## Reproduce",
		"",
		"```sh",
		"make color-global-varied",
		"```",
		"",
		"Requires the existing isolated OpenSearch 2.11 instance and populated `color-global-multi-1000000-v1` index. Run after other benchmarking/indexing work is idle. The command reads that index and creates temporary PITs; it does not rebuild data or flush caches. It skips concurrency if any sequential reference or equality check fails. Results: [global-varied.json](global-varied.json).",
		"",
	);
	return lines.join("\n");
}

async function checkpoint(report) {
	summarize(report);
	await saveJson("global-varied.json", report);
	await writeFile(new URL("GLOBAL-VARIED.md", ROOT), markdown(report));
}

export async function main() {
	const queries = buildQueries();
	const dataBytes = await readFile(new URL("global-multi-data.json", ROOT));
	const data = JSON.parse(dataBytes),
		indexing = await readJson("global-multi-indexing.json");
	assert.equal(
		data.cacheKey,
		indexing.dataCacheKey,
		"Dataset/index manifest mismatch.",
	);
	assert.ok(
		indexing.indexes.some(
			(row) => row.index === INDEX && row.count === 1_000_000,
		),
		"Missing million-document index manifest.",
	);
	await waitForIdle();
	const before = await indexState();
	assert.equal(before.documents, 1_000_000);
	assert.equal((await api(`/${INDEX}/_count`)).body.count, 1_000_000);
	const partitions = (
		await api(`/${INDEX}/_search`, {
			size: 0,
			track_total_hits: false,
			aggs: { partitions: { terms: { field: "partition", size: 100 } } },
		})
	).body.aggregations.partitions.buckets;
	const partitionCounts = new Map(
		partitions.map((bucket) => [bucket.key, bucket.doc_count]),
	);
	for (const query of queries)
		if (query.partition !== null)
			assert.equal(partitionCounts.get(query.partition), 10_000);
	const report = {
		generatedAt: new Date().toISOString(),
		status: "sequential running",
		seed: SEED,
		index: INDEX,
		indexCount: before.documents,
		indexBefore: before,
		indexFingerprint: indexing.fingerprint,
		dataCacheKey: data.cacheKey,
		dataSha256: sha(dataBytes),
		sourceHashes: await hashes(),
		opensearchVersion: (await api("/")).body.version,
		queries,
		sequential: [],
		concurrent: [],
		failures: [],
		summary: [],
		cachePolicy:
			"No flush. Previously used shared node and index. Preflight partition aggregation may warm metadata. Changing query parameters; metadata/range filters may still be cached. Concurrent pass follows the sequential pass.",
	};
	await checkpoint(report);
	for (const query of queries) {
		const row = {
			query: query.id,
			methodOrder: query.methodOrder,
			passed: false,
		};
		for (const method of query.methodOrder) {
			const started = performance.now();
			try {
				row[method] = await run(method, query);
			} catch (error) {
				report.failures.push({
					stage: "sequential",
					query: query.id,
					method,
					elapsedMs: performance.now() - started,
					error: error.message,
				});
			}
		}
		if (row.adaptive && row.exhaustive) {
			try {
				assert.deepEqual(
					row.adaptive.hits,
					row.exhaustive.hits,
					"Global ordered IDs/scores differ.",
				);
				row.passed = true;
			} catch (error) {
				report.failures.push({
					stage: "comparison",
					query: query.id,
					error: error.message,
				});
			}
		}
		report.sequential.push(row);
		console.log(
			`${query.id}: ${query.regions} regions ${query.selectivity}, adaptive ${row.adaptive?.wallMs.toFixed(1) ?? "FAILED"}ms, exhaustive ${row.exhaustive?.wallMs.toFixed(1) ?? "FAILED"}ms, ${row.passed ? "matched" : "FAILED"}`,
		);
		await checkpoint(report);
	}
	report.indexAfterSequential = await indexState();
	if (JSON.stringify(report.indexAfterSequential) !== JSON.stringify(before))
		report.failures.push({
			stage: "snapshot",
			error:
				"Index mutation counters changed; sequential comparisons cannot be certified against one unchanged collection.",
		});
	if (!report.failures.length && report.sequential.every((row) => row.passed)) {
		report.status = "concurrency4 running";
		await checkpoint(report);
		const references = new Map(
			report.sequential.map((row) => [row.query, row.exhaustive.hits]),
		);
		const started = performance.now();
		let next = 0;
		await Promise.all(
			Array.from({ length: 4 }, async () => {
				while (next < queries.length) {
					const query = queries[next++],
						row = { query: query.id, passed: false };
					const started = performance.now();
					try {
						row.adaptive = await run("adaptive", query);
						assert.deepEqual(row.adaptive.hits, references.get(query.id));
						row.passed = true;
					} catch (error) {
						report.failures.push({
							stage: "concurrency4",
							query: query.id,
							elapsedMs: performance.now() - started,
							error: error.message,
						});
					}
					report.concurrent.push(row);
				}
			}),
		);
		report.concurrentElapsedMs = performance.now() - started;
		report.concurrent.sort(
			(a, b) =>
				queries.findIndex((q) => q.id === a.query) -
				queries.findIndex((q) => q.id === b.query),
		);
	} else
		report.concurrencySkipped =
			"Sequential correctness or completeness failed.";
	report.indexAfter = await indexState();
	if (JSON.stringify(report.indexAfter) !== JSON.stringify(before))
		report.failures.push({
			stage: "snapshot",
			error: "Index changed during the workload.",
		});
	const finalHashes = await hashes();
	if (JSON.stringify(finalHashes) !== JSON.stringify(report.sourceHashes))
		report.failures.push({
			stage: "provenance",
			error:
				"Scoring or runner sources changed during execution; rerun with stable sources.",
		});
	report.completedAt = new Date().toISOString();
	report.status = report.failures.length
		? "completed with failures"
		: "completed";
	await checkpoint(report);
	console.log(
		JSON.stringify(
			{
				status: report.status,
				sequentialPassed: report.sequential.filter((row) => row.passed).length,
				concurrentPassed: report.concurrent.filter((row) => row.passed).length,
				failures: report.failures.length,
				summary: report.summary.filter((row) => row.regions === null),
			},
			null,
			2,
		),
	);
	if (report.failures.length) process.exitCode = 1;
	return report;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	if (process.argv.includes("--plan"))
		console.log(
			JSON.stringify({ seed: SEED, queries: buildQueries() }, null, 2),
		);
	else await main();
}
