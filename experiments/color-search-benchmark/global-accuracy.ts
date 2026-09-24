// PROTOTYPE: sampling convergence and independent hard-membership implementation checks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import { compileFamilies, measureFamilies, measureWeightedColors, pixelFamilyPreference } from "./global-pixels.mjs";
import { containsRange, distanceOutsideRange, prepareRangePalette, rgbToChannels, rgbToLab } from "./ranges.mjs";
import { jointReference } from "./global-joint.mjs";

const root = new URL("./", import.meta.url);
const sharp = createRequire(new URL("../../apps/color-extractor/package.json", import.meta.url))("sharp");
const sha = (bytes: any) => createHash("sha256").update(bytes).digest("hex");
const data = JSON.parse(await readFile(new URL("global-data.json", root), "utf8"));
assert.equal(data.wallpapers.length, 100);
const helpers = ["global-accuracy.ts", "global-pixels.mjs", "global-native.mjs", "global-joint.mjs", "ranges.mjs"];
const sourceHashes = Object.fromEntries(await Promise.all(helpers.map(async (file) => [file, sha(await readFile(new URL(file, root)))])));
const compiled = compileFamilies(NATIVE_FAMILIES);
const cacheKey = sha(JSON.stringify({ sourceHashes, families: NATIVE_FAMILIES, side: 1024, dataCacheKey: data.cacheKey }));
await mkdir(new URL("output/global-accuracy-cache/", root), { recursive: true });

// Compare two separately implemented predicates on exactly the same RGB values.
// Coordinate conversions are shared; this is not independent color-science ground truth.
let randomState = 0x20260917;
const randomByte = () => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState >>> 24;
};
const rgbs: number[][] = Array.from({ length: 4096 }, () => [randomByte(), randomByte(), randomByte()].map((v) => v / 255));
for (let channel = 0; channel < 256; channel++) rgbs.push([channel / 255, channel / 255, channel / 255]);
for (const family of NATIVE_FAMILIES) rgbs.push([1, 3, 5].map((offset) => parseInt(family.color.slice(offset, offset + 2), 16) / 255));
// Narrow-neutral boundaries and red's hue seam deserve deliberate coverage.
for (const level of [.02, .08, .25, .5, .9, .98]) for (const delta of [0, 1e-7, 1e-6, .0001, .001, .002, .01]) {
  rgbs.push([level, Math.min(1, level + delta), level]);
  rgbs.push([Math.min(1, level + delta), level, level]);
}
rgbs.push([1, 0, .001], [1, .001, 0]);
const predicateChecks = compiled.map((family: any) => ({ family: family.id, checked: 0, mismatches: 0 }));
const predicateMismatches: any[] = [];
for (const rgb of rgbs) {
  const point = { ...rgbToChannels(rgb), lab: rgbToLab(rgb) };
  compiled.forEach((family: any, i: number) => {
    const actual = pixelFamilyPreference(point, family.target) > 0;
    const expected = containsRange(rgb, family.target);
    predicateChecks[i].checked++;
    if (actual !== expected) {
      predicateChecks[i].mismatches++;
      predicateMismatches.push({ rgb, family: family.id, actual, expected, distanceOutside: distanceOutsideRange(rgb, family.target), target: family.target, point });
    }
  });
}
assert.ok(predicateMismatches.every((entry) => entry.actual && !entry.expected && entry.distanceOutside <= 1e-12), `Region predicates disagree beyond boundary roundoff: ${JSON.stringify(predicateMismatches)}`);
console.log(`Compared ${rgbs.length} RGB values × ${compiled.length} family predicates.`);
if (predicateMismatches.length) console.log(`Recorded ${predicateMismatches.length} deliberate tolerance-boundary roundoff disagreements; none beyond 1e-12.`);

const dense: any[] = [];
let recomputed = 0;
for (const [index, doc] of data.wallpapers.entries()) {
  const bytes = await readFile(new URL(doc.filename, root));
  assert.equal(sha(bytes), doc.sha256, `${doc.id} original checksum`);
  const cacheUrl = new URL(`output/global-accuracy-cache/${doc.id}-1024-${cacheKey.slice(0, 16)}.json`, root);
  let entry;
  try { entry = JSON.parse(await readFile(cacheUrl, "utf8")); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if (!entry || entry.cacheKey !== cacheKey || entry.originalSha256 !== doc.sha256) {
    const pixels = await sharp(bytes).ensureAlpha().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).raw().toBuffer();
    entry = { id: doc.id, originalSha256: doc.sha256, cacheKey, ...measureFamilies(pixels, compiled) };
    await writeFile(cacheUrl, JSON.stringify(entry));
    recomputed++;
  }
  dense.push(entry);
  if ((index + 1) % 10 === 0) console.log(`Dense color measurements: ${index + 1}/100 (${recomputed} recomputed).`);
}
const denseById = new Map(dense.map((doc) => [doc.id, doc]));
const quantile = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const familyErrors = NATIVE_FAMILIES.map((family: any) => {
  const comparisons = data.wallpapers.map((doc: any) => ({ id: doc.id, sampled256: doc.features[family.id], sampled1024: denseById.get(doc.id).features[family.id] }));
  const differences = comparisons.map((entry: any) => Math.abs(entry.sampled256 - entry.sampled1024)).sort((a: number, b: number) => a - b);
  const worst = comparisons.reduce((a: any, b: any) => Math.abs(a.sampled256 - a.sampled1024) > Math.abs(b.sampled256 - b.sampled1024) ? a : b);
  return { family: family.id, meanAbsoluteError: mean(differences), p95AbsoluteError: quantile(differences, .95), maxAbsoluteError: differences.at(-1), signedBias256Minus1024: mean(comparisons.map((entry: any) => entry.sampled256 - entry.sampled1024)), worst };
});

const queries = [
  { id: "green40", colors: [{ family: "green", amount: .4 }] },
  { id: "red70-dark30", colors: [{ family: "red", amount: .7 }, { family: "dark", amount: .3 }] },
  { id: "red50-green50", colors: [{ family: "red", amount: .5 }, { family: "green", amount: .5 }] },
  { id: "dark90", colors: [{ family: "dark", amount: .9 }] },
  { id: "grayscale40", colors: [{ family: "grayscale", amount: .4 }] },
];
const ranking = (docs: any[], colors: any[]) => docs.map((doc) => ({ id: doc.id, ...jointReference(doc, colors) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
const comparisons = queries.map((query) => {
  const coarse = ranking(data.wallpapers, query.colors), fine = ranking(dense, query.colors);
  const fineById = new Map(fine.map((entry, i) => [entry.id, { ...entry, rank: i + 1 }]));
  const first = coarse.slice(0, 10), ideal = fine.slice(0, 10), idealSet = new Set(ideal.map((entry) => entry.id));
  const coarseDenseCosts = first.map((entry) => fineById.get(entry.id).cost);
  const denseIdealCosts = ideal.map((entry) => entry.cost);
  return {
    ...query,
    top10Shared: first.filter((entry) => idealSet.has(entry.id)).length,
    top10SamePositions: first.filter((entry, i) => entry.id === ideal[i].id).length,
    meanTop10RankDisplacement: mean(first.map((entry, i) => Math.abs(fineById.get(entry.id).rank - i - 1))),
    denseMeanErrorOfCoarseTop10: mean(coarseDenseCosts),
    denseMeanErrorOfDenseTop10: mean(denseIdealCosts),
    top10MeanSelectionRegret: Math.max(0, mean(coarseDenseCosts) - mean(denseIdealCosts)),
    top1Regret: Math.max(0, fineById.get(coarse[0].id).cost - fine[0].cost),
    coarseTop10: first.map((entry) => ({ id: entry.id, error256: entry.cost, error1024: fineById.get(entry.id).cost, rank1024: fineById.get(entry.id).rank })),
    denseTop10: ideal.map((entry) => ({ id: entry.id, error1024: entry.cost })),
  };
});
const narrowDoc = data.wallpapers.find((doc: any) => doc.id === "wallpaper-088");
assert.ok(narrowDoc);
const paletteMeasurement = measureWeightedColors(prepareRangePalette(narrowDoc.palette ?? narrowDoc.palette32).points.map((point: any) => ({ point, weight: point.weight })), compiled);
const grayscale088 = {
  id: narrowDoc.id,
  definition: NATIVE_FAMILIES.find((family: any) => family.id === "grayscale"),
  palette32Coverage: paletteMeasurement.features.grayscale,
  sampled256Coverage: narrowDoc.features.grayscale,
  sampled1024Coverage: denseById.get(narrowDoc.id).features.grayscale,
  absoluteSamplingDifference: Math.abs(narrowDoc.features.grayscale - denseById.get(narrowDoc.id).features.grayscale),
};
const report = {
  generatedAt: new Date().toISOString(), dataCacheKey: data.cacheKey, cacheKey, sourceHashes,
  corpus: { wallpapers: 100, families: NATIVE_FAMILIES.length, smallerLongestSide: 256, denserLongestSide: 1024, originalsChecksumVerified: 100, denseRecomputed: recomputed },
  predicateChecks, predicateMismatches, predicateComparisons: predicateChecks.reduce((sum: number, entry: any) => sum + entry.checked, 0),
  familyErrors, queries: comparisons, grayscale088,
  notes: ["Sampling convergence, not human relevance accuracy or full-resolution ground truth.", "Both resolutions use the same region definitions and measureFamilies implementation; separate predicate checks compare two implementations while sharing coordinate conversion.", "Resize interpolation changes boundary colors as well as sampling density.", "Joint rankings use native float32 score order with ID ties; regret is measured in denser-sample double area error.", "Raw dense descriptors are regenerable ignored output artifacts; the tracked report contains aggregate/error/ranking evidence."],
};
await writeFile(new URL("global-accuracy.json", root), JSON.stringify(report, null, 2) + "\n");
const pp = (value: number) => (100 * value).toFixed(3);
const markdown = `# Source-sample convergence for global color matching

Compared the same **100 verified wallpaper originals** at longest sides of **256 and 1024 pixels**, using the existing 18-family bank. This checks whether the smaller measurement has settled sufficiently; the denser sample is not full-resolution ground truth or a human accuracy label.

## Hard-membership implementation check

Two separately implemented predicates were checked on **${report.predicateComparisons.toLocaleString("en-US")} comparisons** (${rgbs.length} RGB values × 18 families), including all 256 neutral grays, family anchors, narrow neutral boundaries, and hue-seam examples. **${predicateMismatches.length} comparisons differed**, all at deliberately constructed floating-point tolerance boundaries with outside distance below 1e-12. Their exact RGB values and results are retained in the JSON; no larger predicate disagreement was allowed. They share RGB/color-coordinate conversion helpers, so this does not independently validate color science.

## Coverage changes

Errors below are **percentage points of image area**, across 100 wallpapers per family.

| Family | Mean absolute change | p95 | Maximum | Worst wallpaper |
|---|---:|---:|---:|---|
${familyErrors.map((entry: any) => `| ${entry.family} | ${pp(entry.meanAbsoluteError)} | ${pp(entry.p95AbsoluteError)} | ${pp(entry.maxAbsoluteError)} | ${entry.worst.id} |`).join("\n")}

## Ranking changes

Both rankings use the joint hard-proportion objective and native float32 score ordering. Selection regret is the additional mean area error of the 256-pixel top ten, measured using 1024-pixel features, compared with the denser sample's own top ten.

| Query | Shared top ten | Same rank positions | Mean rank displacement | Selection regret, pp |
|---|---:|---:|---:|---:|
${comparisons.map((entry: any) => `| ${entry.id} | ${entry.top10Shared}/10 | ${entry.top10SamePositions}/10 | ${entry.meanTop10RankDisplacement.toFixed(2)} | ${pp(entry.top10MeanSelectionRegret)} |`).join("\n")}

## Narrow grayscale: wallpaper-088

For the existing grayscale family (HSL saturation within 2% of neutral, unrestricted hue and lightness):

- 32-color palette: **${pp(grayscale088.palette32Coverage)}%** coverage.
- 256-pixel source sample: **${pp(grayscale088.sampled256Coverage)}%** coverage.
- 1024-pixel source sample: **${pp(grayscale088.sampled1024Coverage)}%** coverage.
- Sampling change: **${pp(grayscale088.absoluteSamplingDifference)} percentage points**.

This separates palette compression error from sample-resolution sensitivity for the previously identified failure.

## Reproduce and interpret

Run \`make color-global-accuracy\` while latency benchmarks are idle. Source SHA256 hashes are checked. Dense measurements are cached per wallpaper under \`output/global-accuracy-cache/\`; [global-accuracy.json](global-accuracy.json) records helper hashes, per-family errors, exact result IDs, costs, and rank changes.

The two resolutions reuse \`measureFamilies\`; agreement measures sampling convergence. Sharp's resize interpolation can shift colors across hard region boundaries, so changes combine density and resampling effects. A higher-resolution reference can still be wrong about the user's intended color family, and visually similar near-ties can change order with little area-error regret.
`;
await writeFile(new URL("GLOBAL-ACCURACY.md", root), markdown);
console.log(JSON.stringify({ predicateComparisons: report.predicateComparisons, grayscale088, rankings: comparisons.map(({ id, top10Shared, top10MeanSelectionRegret }) => ({ id, top10Shared, top10MeanSelectionRegret })) }, null, 2));
