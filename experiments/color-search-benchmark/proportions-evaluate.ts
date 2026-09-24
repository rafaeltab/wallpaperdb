// THROWAWAY PROTOTYPE: representation convergence and independent pixel proxies.
// No production calls, index mutations, downloads, or human-ground-truth claims.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { palette, type PalettePoint } from "./models.js";
import { preparePixels, hexToRgb8, rgb8ToLab } from "./relevance.js";
import { scorePalette } from "./proportions.mjs";

type Color = { color: string; amount: number };
type Query = {
	id: string;
	label: string;
	colors: Color[];
	group: "fixed12" | "uiPresets";
};
type Method = {
	id: string;
	method: "transport" | "coverage" | "legacy";
	size: 32 | 64 | 128;
};
type Document = {
	id: string;
	filename: string;
	sha256: string;
	width: number;
	height: number;
	palette32: PalettePoint[];
};
type RichDocument = {
	id: string;
	sha256: string;
	palette64: PalettePoint[];
	palette128: PalettePoint[];
	pixelRatios: Record<
		string,
		Record<string, { fractions: number[]; cost: number }>
	>;
};
type Ranked = { id: string; cost: number };

const root = new URL("./", import.meta.url);
await mkdir(new URL("output/", root), { recursive: true });
const require = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
);
const sharp = require("sharp");
const tolerance = 0.06;
const thresholds = [20, 30, 40];
const query = (
	id: string,
	label: string,
	pairs: [string, number][],
): Query => ({
	id,
	label,
	group: "fixed12",
	colors: pairs.map(([color, amount]) => ({ color, amount })),
});
// Defined before reading rankings. Hexes represent shades, not whole named hue families.
const fixedQueries = [
	query("green40", "40% green; 60% other", [["#00B040", 0.4]]),
	query("green80", "80% green; 20% other", [["#00B040", 0.8]]),
	query("green50-red50", "50% green / 50% red", [
		["#00B040", 0.5],
		["#FF0000", 0.5],
	]),
	query("red80-black20", "80% red / 20% black", [
		["#FF0000", 0.8],
		["#101010", 0.2],
	]),
	query("rainbow20", "20% each red, orange, yellow, green, blue", [
		["#FF0000", 0.2],
		["#FF8000", 0.2],
		["#FFFF00", 0.2],
		["#00B040", 0.2],
		["#0040FF", 0.2],
	]),
	query("red20-orange20", "20% red / 20% orange; 60% other", [
		["#FF0000", 0.2],
		["#FF8000", 0.2],
	]),
	query("sky60", "60% sky blue; 40% other", [["#60BFFF", 0.6]]),
	query("blue50-orange50", "50% blue / 50% orange", [
		["#2080D0", 0.5],
		["#FF9020", 0.5],
	]),
	query("black70-white30", "70% black / 30% white", [
		["#101010", 0.7],
		["#F0F0F0", 0.3],
	]),
	query("rose30-gray30", "30% rose / 30% gray; 40% other", [
		["#C06070", 0.3],
		["#808080", 0.3],
	]),
	query("forest40-cream40", "40% forest / 40% cream; 20% other", [
		["#205030", 0.4],
		["#FFF0C0", 0.4],
	]),
	query("teal25-pink25", "25% teal / 25% pink; 50% other", [
		["#008080", 0.25],
		["#FF80B0", 0.25],
	]),
];
// The original twelve remain unchanged. UI presets are a separately reported group.
const data = JSON.parse(
	await readFile(new URL("proportions-data.json", root), "utf8"),
);
const presetQueries: Query[] = data.presets.map(
	(preset: Omit<Query, "group">) => ({
		...preset,
		id: `ui:${preset.id}`,
		group: "uiPresets",
	}),
);
const queries: Query[] = [...fixedQueries, ...presetQueries];
assert.equal(fixedQueries.length, 12);
assert.equal(new Set(queries.map((q) => q.id)).size, queries.length);
const methods: Method[] = [
	{ id: "legacy32", method: "legacy", size: 32 },
	{ id: "coverage32", method: "coverage", size: 32 },
	{ id: "transport32", method: "transport", size: 32 },
	{ id: "transport64", method: "transport", size: 64 },
	{ id: "transport128", method: "transport", size: 128 },
];
const docs: Document[] = data.wallpapers.map(
	(doc: Document & { palette: PalettePoint[] }) => ({
		...doc,
		palette32: doc.palette,
	}),
);
assert.equal(docs.length, 100);
assert.equal(new Set(docs.map((d) => d.id)).size, 100);
const extractionStarted = performance.now();
const cacheKey = createHash("sha256")
	.update(await readFile(new URL("models.ts", root)))
	.update(await readFile(new URL("relevance.ts", root)))
	.update(
		JSON.stringify({
			version: 1,
			sources: docs.map((d) => d.sha256),
			queries,
			thresholds,
			sample: 10000,
			proxySide: 256,
		}),
	)
	.digest("hex");
let rich: RichDocument[] = [];
let cached = false;
try {
	const previous = JSON.parse(
		await readFile(
			new URL("output/proportions-palettes128.json", root),
			"utf8",
		),
	);
	if (previous.cacheKey === cacheKey) {
		rich = previous.documents;
		cached = true;
	}
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

if (!cached) {
	const canonicalPalette = (points: PalettePoint[]) =>
		[...points].sort(
			(a, b) =>
				a.lab[0] - b.lab[0] ||
				a.lab[1] - b.lab[1] ||
				a.lab[2] - b.lab[2] ||
				a.weight - b.weight,
		);
	const queryLabs = queries.map((q) =>
		q.colors.map((c) => rgb8ToLab(...hexToRgb8(c.color))),
	);
	for (const [index, doc] of docs.entries()) {
		const bytes = await readFile(new URL(doc.filename, root));
		assert.equal(createHash("sha256").update(bytes).digest("hex"), doc.sha256);
		const height = Math.max(
			1,
			Math.round(Math.sqrt(10000 / (doc.width / doc.height))),
		);
		const width = Math.round((height * doc.width) / doc.height);
		const pixels = await sharp(bytes)
			.ensureAlpha()
			.resize(width, height, { fit: "fill" })
			.raw()
			.toBuffer();
		assert.deepEqual(
			canonicalPalette(palette(pixels, 32)),
			canonicalPalette(doc.palette32),
			"Saved 32-color descriptor must match the current sampler and clustering regardless of ordering",
		);
		const proxyPixels = await sharp(bytes)
			.ensureAlpha()
			.resize({ width: 256, height: 256, fit: "inside" })
			.raw()
			.toBuffer();
		const prepared = preparePixels(proxyPixels);
		const pixelRatios: RichDocument["pixelRatios"] = {};
		for (const [queryIndex, q] of queries.entries()) {
			const buckets = thresholds.map(() =>
				new Array(q.colors.length + 1).fill(0),
			);
			const centers = queryLabs[queryIndex];
			for (let i = 0; i < prepared.count; i++) {
				const offset = i * 7; // PreparedPixels documented interleaved Lab/HSV/alpha layout.
				let nearest = -1,
					best = Infinity;
				for (const [j, center] of centers.entries()) {
					const distance =
						(prepared.values[offset] - center[0]) ** 2 +
						(prepared.values[offset + 1] - center[1]) ** 2 +
						(prepared.values[offset + 2] - center[2]) ** 2;
					if (distance < best) {
						nearest = j;
						best = distance;
					}
				}
				thresholds.forEach((threshold, j) => {
					buckets[j][best <= threshold ** 2 ? nearest : centers.length] +=
						prepared.values[offset + 6] / prepared.totalWeight;
				});
			}
			const targets = [
				...q.colors.map((c) => c.amount),
				1 - q.colors.reduce((sum, c) => sum + c.amount, 0),
			];
			pixelRatios[q.id] = Object.fromEntries(
				thresholds.map((threshold, j) => {
					assert.ok(Math.abs(buckets[j].reduce((a, b) => a + b, 0) - 1) < 1e-8);
					return [
						threshold,
						{
							fractions: buckets[j],
							cost:
								buckets[j].reduce(
									(sum, fraction, k) => sum + Math.abs(fraction - targets[k]),
									0,
								) / 2,
						},
					];
				}),
			);
		}
		rich.push({
			id: doc.id,
			sha256: doc.sha256,
			palette64: palette(pixels, 64),
			palette128: palette(pixels, 128),
			pixelRatios,
		});
		if ((index + 1) % 10 === 0)
			console.log(`Proportion representation extraction: ${index + 1}/100`);
	}
	await writeFile(
		new URL("output/proportions-palettes128.json", root),
		JSON.stringify({
			cacheKey,
			generatedAt: new Date().toISOString(),
			documents: rich,
		}),
	);
}
assert.deepEqual(
	rich.map((d) => [d.id, d.sha256]),
	docs.map((d) => [d.id, d.sha256]),
);
for (const [i, doc] of docs.entries())
	for (const points of [doc.palette32, rich[i].palette64, rich[i].palette128]) {
		assert.ok(
			Math.abs(points.reduce((sum, point) => sum + point.weight, 0) - 1) < 1e-6,
		);
	}
const extractionMs = performance.now() - extractionStarted;
const average = (values: number[]) =>
	values.reduce((sum, value) => sum + value, 0) / values.length;
const sorted = (values: Ranked[]) =>
	values.sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
function compare(ranking: Ranked[], reference: Ranked[]) {
	const costs = new Map(reference.map((d) => [d.id, d.cost]));
	const top = ranking.slice(0, 10);
	const ideal = reference.slice(0, 10);
	const selectedCost = average(top.map((d) => costs.get(d.id)!));
	const idealCost = average(ideal.map((d) => d.cost));
	const cutoff = reference[9].cost;
	return {
		meanReferenceCostAt10: selectedCost,
		idealMeanReferenceCostAt10: idealCost,
		regretAt10: Math.max(0, selectedCost - idealCost),
		top10Recall:
			top.filter((d) => ideal.some((r) => r.id === d.id)).length / 10,
		// Tie-safe relevance at reference cutoff; ordinary top-10 recall breaks ties by ID.
		fractionWithinReferenceTop10Cutoff:
			top.filter((d) => costs.get(d.id)! <= cutoff + 1e-10).length / 10,
	};
}
function rank(q: Query, m: Method): Ranked[] {
	return sorted(
		docs.map((doc, i) => {
			const points =
				m.size === 32
					? doc.palette32
					: m.size === 64
						? rich[i].palette64
						: rich[i].palette128;
			const result = scorePalette(points, q.colors, {
				method: m.method,
				mode: "target",
				tolerance,
			});
			assert.ok(
				Number.isFinite(result.cost) &&
					result.cost >= -1e-9 &&
					result.cost <= 1 + 1e-9,
			);
			return { id: doc.id, cost: result.cost };
		}),
	);
}
const details = [];
for (const q of queries) {
	const rankings = Object.fromEntries(methods.map((m) => [m.id, rank(q, m)]));
	const reference = rankings.transport128;
	const proxies = Object.fromEntries(
		thresholds.map((threshold) => [
			threshold,
			sorted(
				rich.map((d) => ({
					id: d.id,
					cost: d.pixelRatios[q.id][threshold].cost,
				})),
			),
		]),
	);
	const measurements = Object.fromEntries(
		methods.map((m) => {
			const ranking = rankings[m.id];
			const referenceCosts = new Map(reference.map((d) => [d.id, d.cost]));
			return [
				m.id,
				{
					transport128: compare(ranking, reference),
					transport128AbsoluteCostDifference:
						m.method === "transport"
							? average(
									ranking.map((d) =>
										Math.abs(d.cost - referenceCosts.get(d.id)!),
									),
								)
							: null,
					pixelProxies: Object.fromEntries(
						thresholds.map((threshold) => [
							threshold,
							compare(ranking, proxies[threshold]),
						]),
					),
				},
			];
		}),
	);
	const firstId = rankings.transport32[0].id;
	const firstIndex = docs.findIndex((d) => d.id === firstId);
	const firstScore = scorePalette(docs[firstIndex].palette32, q.colors, {
		method: "transport",
		mode: "target",
		tolerance,
	});
	details.push({
		...q,
		measurements,
		rankings,
		pixelProxyRankings: proxies,
		firstTransport32: {
			id: firstId,
			cost: firstScore.cost,
			observed: firstScore.observed,
			other: firstScore.other,
			pixelProxy30: rich[firstIndex].pixelRatios[q.id][30],
		},
	});
	console.log(`Proportion evaluation: ${q.id}`);
}
function summarize(groupDetails: typeof details) {
	return Object.fromEntries(
		methods.map((m) => [
			m.id,
			{
				transport128: {
					meanRegretAt10: average(
						groupDetails.map(
							(q) => q.measurements[m.id].transport128.regretAt10,
						),
					),
					meanTop10Recall: average(
						groupDetails.map(
							(q) => q.measurements[m.id].transport128.top10Recall,
						),
					),
					meanAbsoluteCostDifference:
						m.method === "transport"
							? average(
									groupDetails.map(
										(q) =>
											q.measurements[m.id].transport128AbsoluteCostDifference!,
									),
								)
							: null,
				},
				pixelProxies: Object.fromEntries(
					thresholds.map((threshold) => [
						threshold,
						{
							meanRegretAt10: average(
								groupDetails.map(
									(q) =>
										q.measurements[m.id].pixelProxies[threshold].regretAt10,
								),
							),
							meanReferenceCostAt10: average(
								groupDetails.map(
									(q) =>
										q.measurements[m.id].pixelProxies[threshold]
											.meanReferenceCostAt10,
								),
							),
							meanTop10Recall: average(
								groupDetails.map(
									(q) =>
										q.measurements[m.id].pixelProxies[threshold].top10Recall,
								),
							),
							meanFractionWithinReferenceTop10Cutoff: average(
								groupDetails.map(
									(q) =>
										q.measurements[m.id].pixelProxies[threshold]
											.fractionWithinReferenceTop10Cutoff,
								),
							),
						},
					]),
				),
			},
		]),
	);
}
const fixedDetails = details.filter((q) => q.group === "fixed12");
const presetDetails = details.filter((q) => q.group === "uiPresets");
const summaries = {
	fixed12: summarize(fixedDetails),
	uiPresets: summarize(presetDetails),
};
// Preserve the original summary field meaning for consumers of the first report.
const summary = summaries.fixed12;

// One complete local 100-document score+sort pass, three warmups then five runs.
// Includes JS validation/allocation and sorting; excludes extraction/network/database.
const timing: Record<
	string,
	Record<string, { medianMs: number; minMs: number; maxMs: number }>
> = {};
for (const q of queries.filter((q) =>
	["green40", "rainbow20"].includes(q.id),
)) {
	timing[q.id] = {};
	for (const m of methods) {
		for (let i = 0; i < 3; i++) rank(q, m);
		const samples = Array.from({ length: 5 }, () => {
			const start = performance.now();
			rank(q, m);
			return performance.now() - start;
		}).sort((a, b) => a - b);
		timing[q.id][m.id] = {
			medianMs: samples[2],
			minMs: samples[0],
			maxMs: samples[4],
		};
	}
}
const generatedAt = new Date().toISOString();
const output = {
	generatedAt,
	corpusSize: docs.length,
	tolerance,
	mode: "target",
	cachedExtraction: cached,
	extractionMs,
	scorerSha256: createHash("sha256")
		.update(await readFile(new URL("proportions.mjs", root)))
		.digest("hex"),
	evaluatorSha256: createHash("sha256")
		.update(await readFile(new URL("proportions-evaluate.ts", root)))
		.digest("hex"),
	methodology: {
		paletteSample:
			"Same deterministic approximately 10,000-pixel sampler and weighted OKLab clustering as earlier prototype; 32 vs 64 vs 128 representatives.",
		transportReference:
			"128-palette transport is a representation-convergence reference, not independent semantic ground truth. 128 self-comparison is intentionally tautological.",
		pixelProxy:
			"Independent <=256x256 source pixels converted to CIELAB D65, exclusive nearest requested shade within Delta E 76 threshold 20/30/40, remainder bucket, half-L1 target fraction error. Ratios sum to one and pixels cannot double count.",
		regret:
			"Mean reference cost of selected top ten minus mean reference cost of best ten available (0 is ideal); costs range 0..1, lower is better. Raw cost scales differ between references.",
		timing:
			"100-document local score+sort including JS validation/allocation; 3 warmups and 5 measured runs, excludes extraction and all network/database work.",
		limitations:
			"No human judgments; only 100 wallpapers; no guarantee that desired compositions exist; thresholds change hue/shade semantics; 128 still compressed; same pixel sampler cannot reveal sampling bias; no production retrieval/candidate-recall check.",
	},
	summary,
	summaries,
	queryGroups: {
		fixed12: fixedQueries.length,
		uiPresets: presetQueries.length,
	},
	timing,
	queries: details,
};
await writeFile(
	new URL("proportions-evaluation.json", root),
	JSON.stringify(output, null, 2) + "\n",
);
const fmt = (value: number) => value.toFixed(4);
const comparisonTable = (groupSummary: typeof summary) =>
	methods
		.map((m) => {
			const s = groupSummary[m.id];
			return `| ${m.id} | ${fmt(s.transport128.meanRegretAt10)} | ${(s.transport128.meanTop10Recall * 100).toFixed(1)}% | ${thresholds.map((threshold) => fmt(s.pixelProxies[threshold].meanRegretAt10)).join(" | ")} |`;
		})
		.join("\n");
const accuracy = ["transport32", "transport64"]
	.map(
		(id) =>
			`- ${id}: mean absolute score-cost deviation from 128 is ${fmt(summary[id].transport128.meanAbsoluteCostDifference!)}; mean top-10 overlap ${(summary[id].transport128.meanTop10Recall * 100).toFixed(1)}%.`,
	)
	.join("\n");
const queryTable = fixedDetails
	.map(
		(q) =>
			`| ${q.label} | ${fmt(q.measurements.transport32.transport128.regretAt10)} | ${(q.measurements.transport32.transport128.top10Recall * 100).toFixed(0)}% | ${fmt(q.pixelProxyRankings[30][0].cost)} | ${q.rankings.transport32[0].id} |`,
	)
	.join("\n");
const presetQueryTable = presetDetails
	.map(
		(q) =>
			`| ${q.label} | ${q.colors.map((c) => `${c.color} ${(c.amount * 100).toFixed(0)}%`).join(", ")} | ${q.firstTransport32.id} | ${q.firstTransport32.observed.map((value: number) => `${(value * 100).toFixed(1)}%`).join(" / ")} | ${fmt(q.firstTransport32.pixelProxy30.cost)} | ${fmt(q.pixelProxyRankings[30][0].cost)} |`,
	)
	.join("\n");
const timingTable = methods
	.map(
		(m) =>
			`| ${m.id} | ${timing.green40[m.id].medianMs.toFixed(2)} ms | ${timing.rainbow20[m.id].medianMs.toFixed(2)} ms |`,
	)
	.join("\n");
await writeFile(
	new URL("PROPORTIONS-EVALUATION.md", root),
	`# Proportion prototype: corpus evaluation

Generated ${generatedAt}. Run with \`make color-proportions-evaluate\`.

## Findings

The following four findings refer to the **original fixed 12-query group**. Actual interactive UI presets are evaluated separately below; their later addition does not change the original group or its reported averages.

- 32 representatives retained ${(summary.transport32.transport128.meanTop10Recall * 100).toFixed(1)}% average top-ten overlap with 128; 64 retained ${(summary.transport64.transport128.meanTop10Recall * 100).toFixed(1)}%. Palette compression was a small source of ranking change in this corpus.
- Transport32 reduced mean composition regret against the independent narrow and middle pixel proxies compared with legacy presence scoring (ΔE20: ${fmt(summary.legacy32.pixelProxies[20].meanRegretAt10)} → ${fmt(summary.transport32.pixelProxies[20].meanRegretAt10)}; ΔE30: ${fmt(summary.legacy32.pixelProxies[30].meanRegretAt10)} → ${fmt(summary.transport32.pixelProxies[30].meanRegretAt10)}).
- At the broad ΔE40 threshold, legacy performed better (${fmt(summary.legacy32.pixelProxies[40].meanRegretAt10)} vs ${fmt(summary.transport32.pixelProxies[40].meanRegretAt10)}). Which shades count as the selected color materially affects results; this is not a universal semantic winner.
- Several saturated mixtures have no close match in these 100 images. The top result must be presented as the closest available, with its estimated proportions visible. Controlled synthetic examples are needed to demonstrate exact compositions that the natural corpus does not contain.

## What was evaluated

The same 100 varied wallpapers, 12 original fixed queries plus ${presetQueries.length} actual UI presets as a second group, exact target proportions (40% green should prefer approximately 40%, not 80%), tolerance ${tolerance} OKLab. Queries include partial, complete, neighboring-color, neutral, and five-color mixtures. Absolute requested amounts are preserved; an explicit remainder fills the difference to 100%.

The evaluator reads the self-contained \`proportions-data.json\` prepared by the proportion prototype. It does not depend on descriptors from the earlier OpenSearch experiment. Fresh preparation downloads checksum-pinned originals when needed, and the evaluation uses those originals for richer palettes and pixel references.

This evaluation separates two questions:

1. **Compression accuracy:** how closely do 32 or 64 representative colors reproduce the same transport objective with 128 colors? All three use the same approximately 10,000 source-pixel sample, so this does not assess sample-size bias.
2. **A different proxy for intended composition:** source images are separately sampled at up to 256×256. Every visible pixel goes to its nearest requested color in CIELAB D65 only if within ΔE76 20, 30, or 40; otherwise it goes to “other.” Compare those exclusive area proportions with the requested proportions, including the remainder, using half the sum of absolute errors. No pixel is counted twice. These hard thresholds are intentionally independent of the scorer’s smooth OKLab affinity, but they remain imperfect mathematical proxies, not human judgments.

## Original fixed 12 queries: ranking comparison

Regret is the mean reference cost of the selected ten minus that of the best ten available. Zero is ideal; lower is better. Reference costs are bounded 0–1. A regret of 0.01 means one percentage point of average excess cost **under that particular proxy**, not 1% human error. Raw cost scales should not be compared across reference types.

| Method | Regret vs 128 transport | Top-10 overlap vs 128 | Pixel regret ΔE20 | Pixel regret ΔE30 | Pixel regret ΔE40 |
|---|---:|---:|---:|---:|---:|
${comparisonTable(summaries.fixed12)}

The 128-transport row comparing against itself is an identity check. It cannot establish that transport is the best semantic algorithm. Legacy uses amount as importance; coverage and transport are new proportion objectives. They therefore answer different questions; the comparison exposes consequences rather than proving a universal winner.

### Palette convergence

${accuracy}

| Query | 32-palette regret vs 128 | Top-10 overlap | Best available pixel cost ΔE30 | First 32-palette result |
|---|---:|---:|---:|---|
${queryTable}

High “best available” cost means this small corpus lacks a close match under that pixel proxy; ranking still returns the nearest available wallpapers. A top result is not a claim that the requested composition exists. Top-10 overlap breaks ties deterministically by wallpaper ID; machine-readable results also include a tie-safe reference-cutoff measure.

## Actual interactive UI presets: separate ${presetQueries.length}-query evaluation

These presets are loaded directly from \`proportions-data.json\`; their shades differ from some original fixed queries. They were added after the initial 12-query run, so they are reported separately. The scorer, tolerance, corpus, and references are identical; these results must not be silently pooled with the original average.

| Method | Regret vs 128 transport | Top-10 overlap vs 128 | Pixel regret ΔE20 | Pixel regret ΔE30 | Pixel regret ΔE40 |
|---|---:|---:|---:|---:|---:|
${comparisonTable(summaries.uiPresets)}

The estimate column lists exclusive smooth OKLab affinity proportions for the first result, in query-color order. It is not an exact pixel percentage. Pixel cost is the separate ΔE30 hard-assignment composition error; “best available” is the smallest such error across all 100 images, irrespective of transport rank.

| UI preset | Exact requested shades | First 32-palette result | Estimated selected-color proportions | First-result pixel cost | Best available pixel cost |
|---|---|---|---|---:|---:|
${presetQueryTable}

## Local performance

Median of five 100-wallpaper score-and-sort passes after three warmups per method/query on this machine. Includes scorer validation, allocations, and sorting; excludes palette extraction, network, OpenSearch, and candidate retrieval. This is a prototype reranking measurement, not production throughput.

| Method | One-color partial query | Five-color complete query |
|---|---:|---:|
${timingTable}

## Evidence and limits

- [Machine-readable scores, full rankings, and timing](proportions-evaluation.json)
- Reusable richer palettes and independent pixel proportions: \`output/proportions-palettes128.json\` (local generated cache; keyed by source hashes, palette implementation, proxy implementation, and query definitions).
- The original pinned source files are reused when present. Cache creation verifies each source SHA256 and the prepared 32-color palettes against recomputation, allowing palette order differences; reruns reuse the keyed cache.
- 128 representatives remain an approximation. This is a convergence assessment, not proof of an exact optimum over full-resolution pixels.
- ΔE76 thresholds and OKLab tolerance can disagree about what counts as green, red, neutral, or a neighboring shade. Named-color-family matching would require a separate product decision and validation.
- Only 12 fixed queries, ${presetQueries.length} UI presets, and 100 images; no human relevance labels, no large-index candidate-recall experiment, and no guarantee this corpus contains close matches for complex five-color requests.
`,
);
console.log(
	JSON.stringify({ summaries, timing, extractionMs, cached }, null, 2),
);
