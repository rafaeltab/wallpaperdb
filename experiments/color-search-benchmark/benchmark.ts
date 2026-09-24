// PROTOTYPE benchmark; scratch backend only. See README.md for boundaries.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import {
	queries,
	productionQuery,
	l1,
	dot,
	cosine,
	squaredDistance,
	rgbHistogram,
	rgbCenters,
	mixtureKernel,
	palette,
	paletteCoverage,
} from "./models.js";
import { preparePixels, measureRelevance } from "./relevance.js";

const require = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
);
const sharp = require("sharp");
const root = new URL("./", import.meta.url);
const base = "http://127.0.0.1:19215";
async function api(
	path: string,
	body?: unknown,
	method = body ? "POST" : "GET",
) {
	const res = await fetch(base + path, {
		method,
		headers: { "content-type": "application/json" },
		...(body ? { body: JSON.stringify(body) } : {}),
	});
	const data = await res.json();
	if (!res.ok) throw Error(`${path}: ${JSON.stringify(data)}`);
	return data;
}
const features = JSON.parse(
	await readFile(new URL("output/features.json", root), "utf8"),
);
const manifest = JSON.parse(
	await readFile(new URL("corpus-manifest.json", root), "utf8"),
);
assert.equal(features.length, 100);
assert.equal(manifest.length, 100);
assert.deepEqual(
	features.map((d: any) => d.sha256),
	manifest.map((d: any) => d.sha256),
	"rerun extraction after changing corpus",
);
const descriptorStarted = performance.now();
const relevance: Record<string, Record<string, any>> = Object.fromEntries(
	queries.map((q) => [q.id, {}]),
);
for (const [i, d] of features.entries()) {
	const bytes = await readFile(new URL(d.filename, root));
	assert.equal(createHash("sha256").update(bytes).digest("hex"), d.sha256);
	const targetH = Math.max(
		1,
		Math.round(Math.sqrt(10000 / (d.width / d.height))),
	);
	const targetW = Math.round((targetH * d.width) / d.height);
	const pixels = await sharp(bytes)
		.ensureAlpha()
		.resize(targetW, targetH, { fit: "fill" })
		.raw()
		.toBuffer();
	d.rgb512 = rgbHistogram(pixels);
	d.palette32 = palette(pixels);
	d.sqrtHistogram = d.histogram.map(Math.sqrt);
	assert.ok(
		Math.abs(d.histogram.reduce((a: number, b: number) => a + b, 0) - 1) < 1e-6,
	);
	assert.ok(
		Math.abs(d.palette32.reduce((a: number, b: any) => a + b.weight, 0) - 1) <
			1e-6,
	);
	// Independent judge sees a higher-resolution sample, not the candidate palette.
	const judgePixels = await sharp(bytes)
		.ensureAlpha()
		.resize({ width: 256, height: 256, fit: "inside" })
		.raw()
		.toBuffer();
	const prepared = preparePixels(judgePixels);
	for (const q of queries)
		relevance[q.id][d.id] = measureRelevance(prepared, q.colors);
	if ((i + 1) % 20 === 0)
		console.log(`Descriptors and independent relevance: ${i + 1}/100`);
}
const descriptorMs = performance.now() - descriptorStarted;
await mkdir(new URL("output/", root), { recursive: true });
await writeFile(
	new URL("output/descriptors.json", root),
	JSON.stringify(features),
);
const protoIndex = "color-benchmark-prototypes";
const exists = await fetch(`${base}/${protoIndex}`, { method: "HEAD" });
if (exists.ok) await api("/" + protoIndex, undefined, "DELETE");
await api(
	"/" + protoIndex,
	{
		settings: {
			index: { knn: true, number_of_shards: 1, number_of_replicas: 0 },
		},
		mappings: {
			properties: {
				wallpaperId: { type: "keyword" },
				histogram: { type: "knn_vector", dimension: 64 },
				sqrtHistogram: { type: "knn_vector", dimension: 64 },
				rgb512: {
					type: "knn_vector",
					dimension: 512,
					method: {
						name: "hnsw",
						engine: "faiss",
						space_type: "innerproduct",
						parameters: { ef_construction: 128, m: 16 },
					},
				},
			},
		},
	},
	"PUT",
);
const bulk =
	features
		.flatMap((d: any) => [
			{ index: { _index: protoIndex, _id: d.id } },
			{
				wallpaperId: d.id,
				histogram: d.histogram,
				sqrtHistogram: d.sqrtHistogram,
				rgb512: d.rgb512,
			},
		])
		.map(JSON.stringify)
		.join("\n") + "\n";
const bulkRes = await fetch(base + "/_bulk?refresh=true", {
	method: "POST",
	headers: { "content-type": "application/x-ndjson" },
	body: bulk,
});
const bulkData = await bulkRes.json();
assert.ok(!bulkData.errors, JSON.stringify(bulkData).slice(0, 2000));

type Algo = {
	id: string;
	label: string;
	field: string;
	metric: string;
	sigma?: number;
	native?: "cosine" | "l2";
	normalize?: boolean;
	palette?: boolean;
};
const algorithms: Algo[] = [
	{
		id: "cosine-default",
		label: "Current: HSV cosine, sigma .30",
		field: "histogram",
		metric: "cosinesimil",
		native: "cosine",
	},
	{
		id: "l2-raw",
		label: "L2: unchanged query",
		field: "histogram",
		metric: "l2",
		native: "l2",
	},
	{
		id: "l2-normalized",
		label: "L2: unit-sum query",
		field: "histogram",
		metric: "l2",
		native: "l2",
		normalize: true,
	},
	{
		id: "l1-normalized",
		label: "L1 / histogram overlap",
		field: "histogram",
		metric: "l1",
		normalize: true,
	},
	{
		id: "linf-normalized",
		label: "L-infinity: unit-sum query",
		field: "histogram",
		metric: "linf",
		normalize: true,
	},
	{
		id: "hellinger",
		label: "Hellinger: sqrt histograms",
		field: "sqrtHistogram",
		metric: "cosinesimil",
		normalize: true,
	},
	{
		id: "cosine-narrow",
		label: "HSV cosine, sigma .08",
		field: "histogram",
		metric: "cosinesimil",
		sigma: 0.08,
	},
	{
		id: "dot-default",
		label: "HSV color coverage, sigma .30",
		field: "histogram",
		metric: "innerproduct",
	},
	{
		id: "dot-narrow",
		label: "HSV color coverage, sigma .08",
		field: "histogram",
		metric: "innerproduct",
		sigma: 0.08,
	},
	{
		id: "rgb512-08",
		label: "RGB 512 coverage, sigma .08",
		field: "rgb512",
		metric: "innerproduct",
		sigma: 0.08,
	},
	{
		id: "rgb512-12",
		label: "RGB 512 coverage, sigma .12",
		field: "rgb512",
		metric: "innerproduct",
		sigma: 0.12,
	},
	{
		id: "palette32-06",
		label: "32-color palette coverage, sigma .06",
		field: "palette32",
		metric: "application",
		sigma: 0.06,
		palette: true,
	},
	{
		id: "palette32-10",
		label: "32-color palette coverage, sigma .10",
		field: "palette32",
		metric: "application",
		sigma: 0.1,
		palette: true,
	},
	{
		id: "palette32-14",
		label: "32-color palette coverage, sigma .14",
		field: "palette32",
		metric: "application",
		sigma: 0.14,
		palette: true,
	},
];
function exactScore(metric: string, a: number[], b: number[]) {
	if (metric === "cosinesimil") return 1 + cosine(a, b);
	if (metric === "innerproduct") return 1 + dot(a, b);
	if (metric === "l2") return 1 / (1 + squaredDistance(a, b));
	if (metric === "l1")
		return 1 / (1 + a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0));
	if (metric === "linf")
		return 1 / (1 + Math.max(...a.map((x, i) => Math.abs(x - b[i]))));
	throw Error(metric);
}
const rankings: Record<string, Record<string, any>> = {};
const execution: any[] = [];
let maxScoreError = 0;
for (const q of queries) {
	rankings[q.id] = {};
	for (const a of algorithms) {
		const started = performance.now();
		let vector = productionQuery(q.colors, a.sigma);
		if (a.normalize) vector = l1(vector);
		if (a.id === "hellinger") vector = vector.map(Math.sqrt);
		if (a.field === "rgb512")
			vector = mixtureKernel(rgbCenters, q.colors, a.sigma!);
		let ranking: any[];
		if (a.palette) {
			ranking = features.map((d: any) => ({
				id: d.id,
				score: paletteCoverage(d.palette32, q.colors, a.sigma!),
			}));
		} else {
			const exact = await api("/" + protoIndex + "/_search", {
				size: 100,
				_source: false,
				query: {
					script_score: {
						query: { match_all: {} },
						script: {
							lang: "knn",
							source: "knn_score",
							params: {
								field: a.field,
								query_value: vector,
								space_type: a.metric,
							},
						},
					},
				},
				sort: [{ _score: "desc" }, { wallpaperId: "asc" }],
			});
			assert.equal(exact.hits.hits.length, 100);
			ranking = exact.hits.hits.map((h: any) => ({
				id: h._id,
				score: h._score,
			}));
			for (const hit of ranking) {
				const d = features.find((d: any) => d.id === hit.id);
				const expected = exactScore(a.metric, vector, d[a.field]);
				const error = Math.abs(hit.score - expected);
				maxScoreError = Math.max(maxScoreError, error);
				assert.ok(
					error < 3e-5,
					`${a.id} ${q.id} ${hit.id} score mismatch: ${hit.score} != ${expected}`,
				);
			}
			if (a.native) {
				const result = await api(`/color-benchmark-${a.native}/_search`, {
					size: 100,
					_source: false,
					query: {
						bool: { must: [{ knn: { colorHistogram: { vector, k: 10000 } } }] },
					},
					sort: [{ _score: "desc" }, { wallpaperId: "asc" }],
				});
				const hits = result.hits.hits;
				assert.equal(hits.length, 100);
				// Score ties may reorder at float32 precision: compare scores against formula.
				for (const h of hits) {
					const d = features.find((d: any) => d.id === h._id);
					const target =
						a.metric === "cosinesimil"
							? (1 + cosine(vector, d.histogram)) / 2
							: exactScore(a.metric, vector, d.histogram);
					assert.ok(
						Math.abs(h._score - target) < 3e-5,
						`native score mismatch ${a.id}`,
					);
				}
				const top = new Set(ranking.slice(0, 10).map((h) => h.id));
				execution.push({
					query: q.id,
					algorithm: a.id,
					mode: "Lucene HNSW",
					top10Recall:
						hits.slice(0, 10).filter((h: any) => top.has(h._id)).length / 10,
				});
				ranking = hits.map((h: any) => ({ id: h._id, score: h._score }));
			}
			if (a.field === "rgb512") {
				const ann = await api("/" + protoIndex + "/_search", {
					size: 20,
					_source: false,
					query: { knn: { rgb512: { vector, k: 20 } } },
					sort: [{ _score: "desc" }, { wallpaperId: "asc" }],
				});
				const top = new Set(ranking.slice(0, 10).map((h) => h.id));
				execution.push({
					query: q.id,
					algorithm: a.id,
					mode: "Faiss HNSW k=20",
					top10Recall:
						ann.hits.hits.slice(0, 10).filter((h: any) => top.has(h._id))
							.length / 10,
					candidates: ann.hits.hits.map((h: any) => h._id),
				});
			}
		}
		ranking.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
		rankings[q.id][a.id] = ranking;
		execution.push({
			query: q.id,
			algorithm: a.id,
			mode: a.palette
				? "application rerank of all 100"
				: "OpenSearch exact plus native verification where applicable",
			elapsedMs: performance.now() - started,
			queryVector: !a.palette ? vector : undefined,
		});
	}
	console.log(`Ranked all 100 wallpapers for ${q.id}`);
}
const metrics = ["lab20", "lab30", "lab40", "hsv"];
function dcg(ids: string[], scores: Record<string, any>, metric: string) {
	return ids
		.slice(0, 10)
		.reduce((s, id, i) => s + scores[id][metric] / Math.log2(i + 2), 0);
}
const perQuery: any[] = [];
for (const q of queries)
	for (const metric of metrics) {
		const scores = relevance[q.id];
		const ideal = features
			.map((d: any) => d.id)
			.sort(
				(a: string, b: string) =>
					scores[b][metric] - scores[a][metric] || a.localeCompare(b),
			);
		const qualifies = (id: string) =>
			scores[id].perColor.every((c: any) => c[metric] >= 0.1);
		const idealDcg = dcg(ideal, scores, metric);
		const available = ideal.filter(qualifies).length;
		for (const a of algorithms) {
			const ids = rankings[q.id][a.id].map((h: any) => h.id);
			perQuery.push({
				query: q.id,
				split: q.split,
				multi: q.colors.length > 1,
				metric,
				algorithm: a.id,
				ndcg10: idealDcg > 1e-12 ? dcg(ids, scores, metric) / idealDcg : null,
				precision10: ids.slice(0, 10).filter(qualifies).length / 10,
				available,
				attainablePrecision10: Math.min(10, available) / 10,
				meanCoverage10:
					ids
						.slice(0, 10)
						.reduce((s: number, id: string) => s + scores[id][metric], 0) / 10,
				top1Coverage: scores[ids[0]][metric],
			});
		}
	}
const mean = (values: number[]) =>
	values.reduce((a, b) => a + b, 0) / values.length;
const summaries: any[] = [];
for (const split of ["all", "development", "holdout"])
	for (const metric of metrics)
		for (const a of algorithms) {
			const rows = perQuery.filter(
				(r) =>
					r.algorithm === a.id &&
					r.metric === metric &&
					(split === "all" || r.split === split),
			);
			const ndcgRows = rows.filter((r) => r.ndcg10 !== null);
			const answerable = ndcgRows.filter((r) => r.available > 0);
			summaries.push({
				split,
				metric,
				algorithm: a.id,
				queries: ndcgRows.length,
				totalQueries: rows.length,
				answerableQueries: answerable.length,
				answerableNdcg10: mean(answerable.map((r) => r.ndcg10)),
				ndcg10: mean(ndcgRows.map((r) => r.ndcg10)),
				precision10: mean(rows.map((r) => r.precision10)),
				attainablePrecision10: mean(rows.map((r) => r.attainablePrecision10)),
				meanCoverage10: mean(rows.map((r) => r.meanCoverage10)),
				top1Coverage: mean(rows.map((r) => r.top1Coverage)),
			});
		}
const sourceHashes = Object.fromEntries(
	await Promise.all(
		[
			"benchmark.ts",
			"models.ts",
			"relevance.ts",
			"pipeline.ts",
			"corpus-manifest.json",
			"compose.yml",
			"../../apps/color-extractor/src/services/hsv-embedding-strategy.ts",
			"../../apps/color-extractor/src/services/sharp-histogram-provider.ts",
			"../../apps/gateway/src/services/color-sort.service.ts",
			"../../apps/gateway/src/repositories/wallpaper.repository.ts",
			"../../apps/gateway/src/opensearch/mappings.ts",
		].map(async (path) => [
			path,
			createHash("sha256")
				.update(await readFile(new URL(path, root)))
				.digest("hex"),
		]),
	),
);
const result = {
	generatedAt: new Date().toISOString(),
	gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	sourceHashes,
	nodeVersion: process.version,
	sharpVersions: sharp.versions,
	opensearch: await api("/"),
	descriptorMs,
	maxScoreError,
	corpus: manifest,
	queries,
	algorithms,
	relevance,
	rankings,
	perQuery,
	summaries,
	execution,
};
await writeFile(new URL("results.json", root), JSON.stringify(result));
await writeFile(
	new URL("summary.json", root),
	JSON.stringify(
		{
			generatedAt: result.generatedAt,
			gitCommit: result.gitCommit,
			count: 100,
			queryCount: queries.length,
			algorithms,
			summaries,
			maxScoreError,
			descriptorMs,
		},
		null,
		2,
	),
);
console.table(
	summaries
		.filter((s) => s.split === "holdout" && s.metric === "lab30")
		.map((s) => ({
			algorithm: s.algorithm,
			nDCG10: s.ndcg10.toFixed(3),
			P10: s.precision10.toFixed(3),
			coverage: s.meanCoverage10.toFixed(3),
		})),
);
console.log(
	`Saved results.json; max OpenSearch/local score error ${maxScoreError}`,
);
