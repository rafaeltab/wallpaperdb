// THROWAWAY PROTOTYPE: range boundaries vs uncompressed source-pixel membership.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { palette } from "./models.js";
import { minCostTransport } from "./proportions.mjs";
import {
	RANGE_PRESETS,
	compileRangeQuery,
	prepareRangePalette,
	scoreRangePalette,
	rgbToLab,
} from "./ranges.mjs";

const root = new URL("./", import.meta.url);
const sharp = createRequire(
	new URL("../../apps/color-extractor/package.json", import.meta.url),
)("sharp");
const read = (path: string) => readFile(new URL(path, root));
const sha = (bytes: any) => createHash("sha256").update(bytes).digest("hex");
await mkdir(new URL("output/", root), { recursive: true });
const data = JSON.parse((await read("proportions-data.json")).toString());
assert.equal(data.wallpapers.length, 100);
for (const [path, hash] of Object.entries(data.sourceHashes))
	assert.equal(sha(await read(path)), hash, path);
const queries = RANGE_PRESETS.map((q: any) => ({
	...q,
	query: compileRangeQuery(q.colors),
}));
const sources = Object.fromEntries(
	await Promise.all(
		[
			"ranges.mjs",
			"ranges-evaluate.ts",
			"models.ts",
			"corpus-manifest.json",
		].map(async (path) => [path, sha(await read(path))]),
	),
);

// Separate membership implementation over separately sampled raw pixels.
// It shares the requested mathematical region definitions, not human labels.
function pixelCoordinates(r: number, g: number, b: number) {
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b),
		d = max - min,
		l = (max + min) / 2;
	let h: null | number = null;
	if (d > 1e-6) {
		if (max === r) h = (((g - b) / d + 6) % 6) / 6;
		else if (max === g) h = ((b - r) / d + 2) / 6;
		else h = ((r - g) / d + 4) / 6;
	}
	return {
		rgb: [r, g, b],
		lab: rgbToLab([r, g, b]),
		hsl: { h, s: d <= 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1)), l },
		hsv: { h, s: d <= 1e-6 ? 0 : d / max, v: max },
	};
}
function member(point: any, target: any) {
	for (const range of target.ranges) {
		if (range.space === "oklab") {
			if (
				Math.hypot(
					...point.lab.map((v: number, i: number) => v - target.lab[i]),
				) >
				range.distance + 1e-7
			)
				return false;
		} else if (range.space === "rgb") {
			if (
				["r", "g", "b"].some(
					(axis, i) =>
						Math.abs(point.rgb[i] - target.rgb[i]) > range[axis] + 1e-7,
				)
			)
				return false;
		} else {
			const p = point[range.space],
				t = target[range.space];
			if (range.h < 1) {
				if (p.h === null) return false;
				const hue = Math.abs(p.h - t.h);
				if (2 * Math.min(hue, 1 - hue) > range.h + 1e-7) return false;
			}
			const axis = range.space === "hsl" ? "l" : "v";
			if (
				Math.abs(p.s - t.s) > range.s + 1e-7 ||
				Math.abs(p[axis] - t[axis]) > range[axis] + 1e-7
			)
				return false;
		}
	}
	return true;
}
function referenceForMasks(masses: number[], query: any) {
	const targets = query.targets,
		available = targets.map(() => 0),
		rows: number[][] = [],
		supply: number[] = [];
	let overlap = 0,
		outside = 0;
	const total = masses.reduce((s, m) => s + m, 0);
	masses.forEach((mass, mask) => {
		if (!mass) return;
		mass /= total;
		let matches = 0;
		const costs = targets.map((_: any, j: number) => {
			if (mask & (1 << j)) {
				available[j] += mass;
				matches++;
				return 0;
			}
			return 1;
		});
		if (!matches) outside += mass;
		if (matches > 1) overlap += mass;
		if (query.remainder > 0) costs.push(matches ? 1 : 0);
		rows.push(costs);
		supply.push(mass);
	});
	const demand = targets.map((t: any) => t.amount);
	if (query.remainder > 0) demand.push(query.remainder);
	return {
		cost: minCostTransport(supply, demand, rows).cost,
		available,
		overlap,
		outside,
	};
}
function measurePixels(pixels: Buffer) {
	const histograms = queries.map((q: any) =>
		Array(2 ** q.colors.length).fill(0),
	);
	for (let p = 0; p < pixels.length; p += 4) {
		const weight = pixels[p + 3] / 255;
		if (!weight) continue;
		const point = pixelCoordinates(
			pixels[p] / 255,
			pixels[p + 1] / 255,
			pixels[p + 2] / 255,
		);
		queries.forEach((q: any, j: number) => {
			let mask = 0;
			q.query.compiled.forEach((target: any, k: number) => {
				if (member(point, target)) mask |= 1 << k;
			});
			histograms[j][mask] += weight;
		});
	}
	return Object.fromEntries(
		queries.map((q: any, j: number) => [
			q.id,
			referenceForMasks(histograms[j], q.query),
		]),
	);
}
const cacheKey = sha(
	JSON.stringify({
		sources,
		queries: RANGE_PRESETS,
		originals: data.wallpapers.map((d: any) => d.sha256),
		sample: 10000,
		pixelSide: 256,
	}),
);
let rich: any[] = [],
	cached = false;
try {
	const cache = JSON.parse(
		(await read("output/ranges-reference.json")).toString(),
	);
	if (cache.cacheKey === cacheKey) {
		rich = cache.documents;
		cached = true;
	}
} catch (error: any) {
	if (error.code !== "ENOENT") throw error;
}
const extractionStart = performance.now();
if (!cached) {
	for (const [i, doc] of data.wallpapers.entries()) {
		const bytes = await read(doc.filename);
		assert.equal(sha(bytes), doc.sha256, doc.id);
		const h = Math.max(
				1,
				Math.round(Math.sqrt(10000 / (doc.width / doc.height))),
			),
			w = Math.round((h * doc.width) / doc.height);
		const sampled = await sharp(bytes)
			.ensureAlpha()
			.resize(w, h, { fit: "fill" })
			.raw()
			.toBuffer();
		const fine = palette(sampled, 128);
		const pixels = await sharp(bytes)
			.ensureAlpha()
			.resize({
				width: 256,
				height: 256,
				fit: "inside",
				withoutEnlargement: true,
			})
			.raw()
			.toBuffer();
		rich.push({
			id: doc.id,
			sha256: doc.sha256,
			palette128: fine,
			pixels: measurePixels(pixels),
			pixelsAtPaletteSample: measurePixels(sampled),
		});
		if ((i + 1) % 10 === 0) console.log(`Range references: ${i + 1}/100`);
	}
	await writeFile(
		new URL("output/ranges-reference.json", root),
		JSON.stringify({ cacheKey, documents: rich }),
	);
}
const extractionMs = performance.now() - extractionStart;
const richById = new Map(rich.map((d) => [d.id, d]));
const docs = data.wallpapers.map((doc: any) => ({
	...doc,
	prepared32: prepareRangePalette(doc.palette),
	prepared128: prepareRangePalette(richById.get(doc.id).palette128),
	reference: richById.get(doc.id).pixels,
	referenceAtPaletteSample: richById.get(doc.id).pixelsAtPaletteSample,
}));
const methods = [
	{ id: "hard32", boundary: "hard", size: 32 },
	{ id: "graded32", boundary: "graded", size: 32 },
	{ id: "soft32", boundary: "soft", size: 32 },
	{ id: "graded128", boundary: "graded", size: 128 },
];
const order = (a: any, b: any) =>
	Math.abs(a.cost - b.cost) > 1e-10
		? a.cost - b.cost
		: (a.colorCost ?? 0) - (b.colorCost ?? 0) || a.id.localeCompare(b.id);
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const evaluations = [];
for (const q of queries) {
	const references = docs
		.map((d: any) => ({ id: d.id, ...d.reference[q.id] }))
		.sort(order);
	const referenceMap = new Map(references.map((r: any) => [r.id, r]));
	const sameSampleReferences = docs.map((d: any) => ({
		id: d.id,
		...d.referenceAtPaletteSample[q.id],
	}));
	const sameSampleMap = new Map(
		sameSampleReferences.map((r: any) => [r.id, r]),
	);
	const referenceBest = mean(references.slice(0, 10).map((r: any) => r.cost));
	const rankings: any = {};
	for (const method of methods) {
		rankings[method.id] = docs
			.map((doc: any) => {
				const s = scoreRangePalette(doc[`prepared${method.size}`], q.query, {
					boundary: method.boundary,
				});
				return {
					id: doc.id,
					cost: s.cost,
					colorCost: s.colorCost,
					preference: s.preference,
					available: s.available,
					assigned: s.assigned,
					overlap: s.overlap,
					groups: s.groups,
				};
			})
			.sort(order);
	}
	const metrics = Object.fromEntries(
		methods.map((method) => {
			const rows = rankings[method.id],
				selected = rows.slice(0, 10),
				fineTop = new Set(
					rankings.graded128.slice(0, 10).map((r: any) => r.id),
				);
			return [
				method.id,
				{
					meanAbsoluteAreaDifference: mean(
						rows.flatMap((r: any) =>
							r.available.map((v: number, j: number) =>
								Math.abs(v - referenceMap.get(r.id).available[j]),
							),
						),
					),
					meanClusteringAreaDifference: mean(
						rows.flatMap((r: any) =>
							r.available.map((v: number, j: number) =>
								Math.abs(v - sameSampleMap.get(r.id).available[j]),
							),
						),
					),
					meanSamplingAreaDifference: mean(
						rows.flatMap((r: any) =>
							r.available.map((_: number, j: number) =>
								Math.abs(
									referenceMap.get(r.id).available[j] -
										sameSampleMap.get(r.id).available[j],
								),
							),
						),
					),
					maxAbsoluteAreaDifference: Math.max(
						...rows.flatMap((r: any) =>
							r.available.map((v: number, j: number) =>
								Math.abs(v - referenceMap.get(r.id).available[j]),
							),
						),
					),
					pixelRegretAt10:
						mean(selected.map((r: any) => referenceMap.get(r.id).cost)) -
						referenceBest,
					top10OverlapWithGraded128:
						selected.filter((r: any) => fineTop.has(r.id)).length / 10,
				},
			];
		}),
	);
	evaluations.push({
		id: q.id,
		label: q.label,
		colors: q.colors,
		metrics,
		rankings,
		references,
		sameSampleReferences,
	});
	console.log(`Range ranking: ${q.id}`);
}
// Warmed scoring only: all descriptors and each query are prepared once.
const timing: any = {};
for (const q of queries) {
	timing[q.id] = {};
	for (const boundary of ["hard", "graded", "soft"]) {
		const run = () =>
			docs
				.map((d: any) => ({
					id: d.id,
					...scoreRangePalette(d.prepared32, q.query, { boundary }),
				}))
				.sort(order);
		run();
		run();
		const runs = [];
		for (let i = 0; i < 7; i++) {
			const started = performance.now();
			run();
			runs.push(performance.now() - started);
		}
		runs.sort((a, b) => a - b);
		timing[q.id][boundary] = {
			medianMs: runs[3],
			minMs: runs[0],
			maxMs: runs[6],
			documents: 100,
		};
	}
}
const summary = Object.fromEntries(
	methods.map((method) => [
		method.id,
		Object.fromEntries(
			Object.keys(evaluations[0].metrics[method.id]).map((key) => [
				key,
				key.startsWith("max")
					? Math.max(...evaluations.map((q: any) => q.metrics[method.id][key]))
					: mean(evaluations.map((q: any) => q.metrics[method.id][key])),
			]),
		),
	]),
);
const result = {
	generatedAt: new Date().toISOString(),
	corpusSize: 100,
	queryCount: queries.length,
	sources,
	cached,
	extractionMs,
	methodology: {
		regions:
			"Seven actual UI presets; exact proportions; graded center1/edge.5, hard rejection outside; 100% channel tolerance means unrestricted for preference.",
		reference:
			"Up to256x256 uncompressed pixels, independently implemented hard membership, same requested mathematical regions. Group by membership bitmask and solve joint area allocation. Shared OKLab conversion and transport solver; not independent human relevance.",
		palette:
			"32 and128 from same~10k pixels; sharp samples independently at256side for reference.",
		ranking:
			"Composition cost first, center color cost only among ties; graded area proportions remain literal.",
		timing:
			"Prepared32 descriptors and compiled query, 2warmups7runs, score+sort100docs; excludes extraction/network/OpenSearch/retrieval/rendering.",
		limitations:
			"Boundary discontinuities and compression can change area-first rankings. No human labels; no production-scale retrieval recall or load testing.",
	},
	summary,
	timing,
	queries: evaluations,
};
await writeFile(
	new URL("ranges-evaluation.json", root),
	JSON.stringify(result, null, 2),
);
const fmt = (v: number) => v.toFixed(4),
	pct = (v: number) => (100 * v).toFixed(1) + "%";
const lines = [
	"# Color range prototype: evaluation",
	`Generated ${result.generatedAt}. Reproduce with \`make color-ranges-evaluate\`.`,
	"## Scope",
	"All seven editor presets run against the same 100 real wallpapers. The reference classifies a separate sample of up to 256×256 pixels from each original image into the actual requested regions, including overlapping memberships. It independently implements membership, then uses the same transport solver to calculate the best possible joint area error. A second reference classifies the exact approximately 10,000 pixels used to build palettes, separating clustering error from sampling error. This checks approximation for the defined regions, not whether people agree with those regions. Graded matching keeps hard region areas and uses center preference only after minimizing composition error.",
	"## Summary",
	"| Method | Mean absolute region-area difference vs pixels | Mean pixel composition regret@10 | Mean top10 overlap with graded128 |",
	"|---|---:|---:|---:|",
	...methods.map(
		(m) =>
			`| ${m.id} | ${pct(summary[m.id].meanAbsoluteAreaDifference)} | ${fmt(summary[m.id].pixelRegretAt10)} | ${pct(summary[m.id].top10OverlapWithGraded128)} |`,
	),
	"Regret is the selected top10 mean reference cost minus the best10 available mean reference cost. Lower is better; this is not a human accuracy percentage. Graded128 self-overlap is an identity, not proof of relevance. Hard32 and graded32 use identical raw region memberships; only tie-breaking differs.",
	"### Clustering and sampling errors",
	"| Method | Mean area difference vs exact palette-input pixels | Mean difference between the two pixel samples |",
	"|---|---:|---:|",
	...methods.map(
		(m) =>
			`| ${m.id} | ${pct(summary[m.id].meanClusteringAreaDifference)} | ${pct(summary[m.id].meanSamplingAreaDifference)} |`,
	),
	"These two absolute errors do not add algebraically: they can reinforce or offset each other. Per-image values in the JSON identify boundary outliers.",
	"## Each query",
	"| Query | First graded32 result | Palette available areas | Pixel available areas | Palette area error | Pixel area error | Worst32 region-area error across corpus |",
	"|---|---|---|---|---:|---:|---:|",
	...evaluations.map((q: any) => {
		const first = q.rankings.graded32[0],
			pixel = q.references.find((r: any) => r.id === first.id);
		return `| ${q.label} | ${first.id} | ${first.available.map(pct).join(" / ")} | ${pixel.available.map(pct).join(" / ")} | ${fmt(first.cost)} | ${fmt(pixel.cost)} | ${pct(q.metrics.graded32.maxAbsoluteAreaDifference)} |`;
	}),
	"Available region areas can overlap. They are not the non-overlapping allocated amounts. Detailed rankings, allocation estimates, pixel references, and all hashes are in [ranges-evaluation.json](ranges-evaluation.json).",
	"## Local scoring cost",
	"Milliseconds to score and sort100 already prepared32-color palettes. Each query is compiled once. Median of seven runs after two warmups; timings exclude extraction, retrieval, network, and UI. These are local measurements, not1M/100M benchmarks.",
	"| Query | Hard | Graded center preference | Soft outside boundary |",
	"|---|---:|---:|---:|",
	...queries.map(
		(q: any) =>
			`| ${q.label} | ${timing[q.id].hard.medianMs.toFixed(2)} | ${timing[q.id].graded.medianMs.toFixed(2)} | ${timing[q.id].soft.medianMs.toFixed(2)} |`,
	),
	"Hard mode combines identical membership patterns before solving; graded mode must also preserve different center preferences. The extra work is bounded by the palette size rather than source-image pixel count. The architecture still requires candidate retrieval; these timings do not justify scanning an entire collection for each query.",
	"## Limitations",
	"- A32-color centroid can sit on a different side of a narrow range boundary from some pixels it represents. Graded center preference does not remove this hard membership error.",
	"- The128-color descriptor is still compressed and uses the same~10k sample. Compare its direct pixel error as well as rank overlap.",
	"- Area-first ranking deliberately refuses to trade a worse proportion match for a prettier center shade. Small area differences, including approximation errors, can dominate center preference.",
	"- The soft-outside alternative reduces abrupt boundaries but trades literal membership for a smooth objective. Its soft cost is not directly comparable with a hard area error.",
	"- Real rankings are exploratory, with only100 images and no human relevance judgments. Production candidate recall, p95latency, throughput, and storage overhead are unmeasured.",
	"- The source-pixel reference shares the declared region definitions, the OKLab conversion, and the transport solver. Agreement is representation accuracy for this model, not independent perceptual validation.",
];
await writeFile(
	new URL("RANGES-EVALUATION.md", root),
	lines
		.map(
			(line, i) =>
				line +
				(line.startsWith("|") && lines[i + 1]?.startsWith("|") ? "\n" : "\n\n"),
		)
		.join(""),
);
console.log(JSON.stringify({ summary, timing, cached, extractionMs }, null, 2));
