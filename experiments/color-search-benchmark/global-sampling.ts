// PROTOTYPE: original-pixel sampling, with no resize or interpolation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { NATIVE_FAMILIES } from "./global-native.mjs";
import { compileFamilies, measureFamilies } from "./global-pixels.mjs";
import { jointReference } from "./global-joint.mjs";

export const SAMPLER_VERSION = "original-rgba-continuous-strata-xorshift32-v1";
const LEVELS = [65536, 262144];
const EXACT_IDS = new Set(["wallpaper-088", "wallpaper-097", "wallpaper-016", "wallpaper-048"]);
const root = new URL("./", import.meta.url);
const sha = (value: any) => createHash("sha256").update(value).digest("hex");

export function sampleOriginalRgba(rgba: Uint8Array, width: number, height: number, requested: number, seed: number) {
  assert.ok(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0);
  assert.equal(rgba.length, width * height * 4);
  assert.ok(Number.isInteger(requested) && requested > 0);
  if (width * height <= requested) return { pixels: Buffer.from(rgba), samples: width * height, columns: width, rows: height, fullImage: true, seed: seed >>> 0 };
  let columns = Math.max(1, Math.min(width, requested, Math.floor(Math.sqrt(requested * width / height))));
  const rows = Math.max(1, Math.min(height, Math.floor(requested / columns)));
  // Extreme aspect ratios can leave unused budget after clamping the short side.
  columns = Math.max(1, Math.min(width, Math.floor(requested / rows)));
  const samples = columns * rows;
  const pixels = Buffer.allocUnsafe(samples * 4);
  let state = (seed >>> 0) || 0x6d2b79f5;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  let target = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    // Equal continuous strata give every source-pixel area equal expected weight.
    // Rounding stratum boundaries first would overweight smaller integer cells.
    const x = Math.min(width - 1, Math.floor((column + random()) * width / columns));
    const y = Math.min(height - 1, Math.floor((row + random()) * height / rows));
    const source = (y * width + x) * 4;
    pixels[target++] = rgba[source]; pixels[target++] = rgba[source + 1];
    pixels[target++] = rgba[source + 2]; pixels[target++] = rgba[source + 3];
  }
  return { pixels, samples, columns, rows, fullImage: false, seed: seed >>> 0 };
}

function selfTest() {
  const width = 127, height = 89;
  const image = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { image[i * 4] = i & 255; image[i * 4 + 1] = i >> 8; image[i * 4 + 2] = 77; image[i * 4 + 3] = i % 256; }
  const first = sampleOriginalRgba(image, width, height, 1000, 1234);
  assert.ok(first.samples <= 1000 && first.samples > 900);
  assert.deepEqual(first.pixels, sampleOriginalRgba(image, width, height, 1000, 1234).pixels);
  assert.notDeepEqual(first.pixels, sampleOriginalRgba(image, width, height, 1000, 1235).pixels);
  for (let i = 0; i < first.pixels.length; i += 4) {
    const index = first.pixels[i] | (first.pixels[i + 1] << 8);
    assert.deepEqual(first.pixels.subarray(i, i + 4), image.subarray(index * 4, index * 4 + 4));
  }
  assert.deepEqual(sampleOriginalRgba(image, width, height, width * height, 1).pixels, image);
  const check = measureFamilies(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]), compileFamilies(NATIVE_FAMILIES));
  assert.equal(check.features.dark, 0, "Transparent pixels must not add dark area");
  console.log("Original sampler checks passed: deterministic jitter, original RGBA preservation, full-image fallback, alpha weighting.");
}

function exactMeasurement(rgba: Uint8Array, compiled: any[]) {
  const accum: any = { features: {}, qualityMass: {}, unions: {}, visibleWeight: 0, pixelCount: rgba.length / 4 };
  const chunkBytes = 262144 * 4;
  for (let start = 0; start < rgba.length; start += chunkBytes) {
    const chunk = rgba.subarray(start, Math.min(rgba.length, start + chunkBytes));
    let visible = 0;
    for (let i = 3; i < chunk.length; i += 4) visible += chunk[i] / 255;
    if (!visible) continue;
    const measured = measureFamilies(chunk, compiled);
    for (const category of ["features", "qualityMass", "unions"]) for (const [key, value] of Object.entries(measured[category])) accum[category][key] = (accum[category][key] ?? 0) + Number(value) * measured.visibleWeight;
    accum.visibleWeight += measured.visibleWeight;
  }
  assert.ok(accum.visibleWeight > 0);
  for (const category of ["features", "qualityMass", "unions"]) for (const key of Object.keys(accum[category])) accum[category][key] /= accum.visibleWeight;
  return accum;
}

export async function main() {
  selfTest();
  const sharp = createRequire(new URL("../../apps/color-extractor/package.json", import.meta.url))("sharp");
  const data = JSON.parse(await readFile(new URL("global-data.json", root), "utf8"));
  const resizeAudit = JSON.parse(await readFile(new URL("global-accuracy.json", root), "utf8"));
  assert.equal(data.wallpapers.length, 100);
  assert.equal(resizeAudit.dataCacheKey, data.cacheKey, "Resize audit must use the same 256-pixel data version");
  const sourceHashes = Object.fromEntries(await Promise.all(["global-sampling.ts", "global-pixels.mjs", "global-native.mjs", "global-joint.mjs", "ranges.mjs"].map(async (file) => [file, sha(await readFile(new URL(file, root)))])));
  const cacheKey = sha(JSON.stringify({ sourceHashes, families: NATIVE_FAMILIES, sampler: SAMPLER_VERSION, levels: LEVELS, sharp: sharp.versions.sharp, vips: sharp.versions.vips }));
  const compiled = compileFamilies(NATIVE_FAMILIES);
  await mkdir(new URL("output/global-sampling-cache/", root), { recursive: true });
  const records: any[] = [];
  for (const [index, doc] of data.wallpapers.entries()) {
    const bytes = await readFile(new URL(doc.filename, root));
    assert.equal(sha(bytes), doc.sha256, `${doc.id} original checksum`);
    const cacheUrl = new URL(`output/global-sampling-cache/${doc.id}-${cacheKey.slice(0, 16)}.json`, root);
    let record: any;
    try { record = JSON.parse(await readFile(cacheUrl, "utf8")); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    if (!record || record.originalSha256 !== doc.sha256 || record.cacheKey !== cacheKey) {
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = decoded.info;
      assert.equal(channels, 4);
      record = { id: doc.id, originalSha256: doc.sha256, cacheKey, width, height, samples: {} };
      for (const requested of LEVELS) {
        const seed = parseInt(sha(`${SAMPLER_VERSION}|${doc.sha256}|${requested}|0`).slice(0, 8), 16);
        const { pixels, ...sampling } = sampleOriginalRgba(decoded.data, width, height, requested, seed);
        record.samples[requested] = { id: doc.id, requested, ...sampling, ...measureFamilies(pixels, compiled) };
      }
      if (EXACT_IDS.has(doc.id)) {
        console.log(`Counting every original pixel for ${doc.id}: ${width}×${height}.`);
        record.exact = { id: doc.id, ...exactMeasurement(decoded.data, compiled) };
        record.replicates = [];
        for (const requested of LEVELS) for (const replicate of [1, 2]) {
          const seed = parseInt(sha(`${SAMPLER_VERSION}|${doc.sha256}|${requested}|${replicate}`).slice(0, 8), 16);
          const { pixels, ...sampling } = sampleOriginalRgba(decoded.data, width, height, requested, seed);
          record.replicates.push({ requested, replicate, ...sampling, ...measureFamilies(pixels, compiled) });
        }
      }
      await writeFile(cacheUrl, JSON.stringify(record));
    }
    const resized1024 = JSON.parse(await readFile(new URL(`output/global-accuracy-cache/${doc.id}-1024-${resizeAudit.cacheKey.slice(0, 16)}.json`, root), "utf8"));
    records.push({ ...record, resize256: doc, resize1024: resized1024 });
    if ((index + 1) % 10 === 0) console.log(`Original-pixel sampling: ${index + 1}/100.`);
  }
  const methodIds = ["resize256", "resize1024", "jitter65536", "jitter262144"];
  const methods: any = Object.fromEntries(methodIds.map((method) => [method, records.map((record) => method.startsWith("jitter") ? record.samples[method.slice(6)] : record[method])]));
  const reference = methods.jitter262144;
  const refById = new Map(reference.map((doc: any) => [doc.id, doc]));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { mean: mean(values), p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) };
  };
  const familyErrors = methodIds.slice(0, 3).flatMap((method) => NATIVE_FAMILIES.map((family: any) => {
    const values = methods[method].map((doc: any) => ({ id: doc.id, difference: doc.features[family.id] - refById.get(doc.id).features[family.id] }));
    const worst = values.reduce((a: any, b: any) => Math.abs(a.difference) > Math.abs(b.difference) ? a : b);
    return { method, family: family.id, absoluteError: stats(values.map((entry: any) => Math.abs(entry.difference))), signedBias: mean(values.map((entry: any) => entry.difference)), worst };
  }));
  const aggregateErrors = methodIds.slice(0, 3).map((method) => ({ method, ...stats(familyErrors.filter((entry: any) => entry.method === method).flatMap((entry: any) => methods[method].map((doc: any) => Math.abs(doc.features[entry.family] - refById.get(doc.id).features[entry.family])))) }));
  const queries = [
    { id: "green40", colors: [{ family: "green", amount: .4 }] },
    { id: "red70-dark30", colors: [{ family: "red", amount: .7 }, { family: "dark", amount: .3 }] },
    { id: "red50-green50", colors: [{ family: "red", amount: .5 }, { family: "green", amount: .5 }] },
    { id: "dark90", colors: [{ family: "dark", amount: .9 }] },
    { id: "grayscale40", colors: [{ family: "grayscale", amount: .4 }] },
  ];
  const rank = (docs: any[], colors: any[]) => docs.map((doc) => ({ id: doc.id, ...jointReference(doc, colors) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const rankings = queries.flatMap((query) => {
    const ideal = rank(reference, query.colors), idealTop = ideal.slice(0, 10);
    const lookup = new Map(ideal.map((entry, i) => [entry.id, { ...entry, rank: i + 1 }]));
    return methodIds.slice(0, 3).map((method) => {
      const top = rank(methods[method], query.colors).slice(0, 10);
      return { query: query.id, colors: query.colors, method,
        top10Shared: top.filter((entry) => idealTop.some((candidate) => candidate.id === entry.id)).length,
        top10SamePositions: top.filter((entry, i) => entry.id === idealTop[i].id).length,
        meanRankDisplacement: mean(top.map((entry, i) => Math.abs(lookup.get(entry.id).rank - i - 1))),
        top10MeanSelectionRegret: Math.max(0, mean(top.map((entry) => lookup.get(entry.id).cost)) - mean(idealTop.map((entry) => entry.cost))),
        top1Regret: Math.max(0, lookup.get(top[0].id).cost - ideal[0].cost),
        top10: top.map((entry) => ({ id: entry.id, methodError: entry.cost, referenceError: lookup.get(entry.id).cost, referenceRank: lookup.get(entry.id).rank })),
        referenceTop10: idealTop.map(({ id, cost }) => ({ id, cost })),
      };
    });
  });
  const exactChecks = records.filter((record) => record.exact).map((record) => {
    const estimates = [...methodIds.map((method) => ({ method, measurement: method.startsWith("jitter") ? record.samples[method.slice(6)] : record[method] })), ...record.replicates.map((sample: any) => ({ method: `jitter${sample.requested}-replicate${sample.replicate}`, measurement: sample }))];
    return { id: record.id, originalPixels: record.width * record.height, visibleWeight: record.exact.visibleWeight, exactFeatures: record.exact.features,
      errors: estimates.map(({ method, measurement }) => ({ method, absoluteError: stats(NATIVE_FAMILIES.map((family: any) => Math.abs(measurement.features[family.id] - record.exact.features[family.id]))), familyDifferences: Object.fromEntries(NATIVE_FAMILIES.map((family: any) => [family.id, measurement.features[family.id] - record.exact.features[family.id]])), seed: measurement.seed, samples: measurement.samples })),
    };
  });
  const gray = records.find((record) => record.id === "wallpaper-088");
  const grayscale088 = { palette32: resizeAudit.grayscale088.palette32Coverage, resize256: gray.resize256.features.grayscale, resize1024: gray.resize1024.features.grayscale, jitter65536: gray.samples[65536].features.grayscale, jitter262144: gray.samples[262144].features.grayscale, exact: gray.exact.features.grayscale };
  const report = {
    generatedAt: new Date().toISOString(), samplerVersion: SAMPLER_VERSION, cacheKey, sourceHashes, dataCacheKey: data.cacheKey, resizeAuditCacheKey: resizeAudit.cacheKey,
    corpus: { wallpapers: 100, originalsChecksumVerified: 100, levels: LEVELS, exactIds: [...EXACT_IDS], originalHashes: Object.fromEntries(records.map((record) => [record.id, record.originalSha256])) },
    sampling: records.map((record) => ({ id: record.id, width: record.width, height: record.height, levels: LEVELS.map((level) => { const sample = record.samples[level]; return { requested: level, actual: sample.samples, columns: sample.columns, rows: sample.rows, fullImage: sample.fullImage, seed: sample.seed }; }) })),
    aggregateErrors, familyErrors, rankings, exactChecks, grayscale088,
    notes: ["262,144-target jittered samples are a statistical reference, not exact counts except where fullImage is true.", "Original RGBA pixels are copied without interpolation; alpha remains the original byte and area fractions are alpha-weighted.", "Equal continuous strata plus deterministic pseudorandom jitter avoid unequal-integer-cell weighting and regular-grid aliasing.", "Exact counts on four diagnostics distinguish sample fluctuation from resize color mixing, but do not prove whole-corpus error limits.", "Three seeds per level on the exact subset provide a limited variability check; they do not establish a universal confidence interval.", "All measurements use the same declared family predicates; this is pixel-area accuracy, not human assessment of family definitions."],
  };
  await writeFile(new URL("global-sampling.json", root), JSON.stringify(report, null, 2) + "\n");
  const pp = (value: number) => (value * 100).toFixed(4);
  const markdown = `# Original-pixel sampling versus resizing

Compared all **100 checksum-verified wallpapers** using deterministic jittered samples of original decoded RGBA pixels. No resize or interpolation occurs in the new sampler. Nominal sample counts are **65,536** and **262,144**, adjusted slightly to a rectangular grid; images smaller than a target are counted in full.

## How it samples

Sampler version: \`${SAMPLER_VERSION}\`. The seed is derived from the version, original SHA256, requested sample count, and replicate number. Each equal continuous image stratum contributes one uniformly jittered location; its containing original pixel is copied verbatim. Equal continuous strata avoid overweighting smaller cells caused by rounding cell boundaries to integer pixels. Alpha bytes are preserved, and the existing area measurement weights each sample by alpha.

## Whole-corpus comparison

The high-density original-pixel sample is the reference here, **not full-image ground truth**. Errors aggregate 100 wallpapers × 18 families and are percentage points of visible image area.

| Method | Mean absolute error, pp | p95, pp | Maximum, pp |
|---|---:|---:|---:|
${aggregateErrors.map((entry: any) => `| ${entry.method} | ${pp(entry.mean)} | ${pp(entry.p95)} | ${pp(entry.max)} |`).join("\n")}

## Joint proportion ranking

Selection regret is the additional mean high-density-reference error of the method's top ten relative to the reference top ten. Native float32 score ordering and ID ties are preserved.

| Query | Method | Shared top ten | Same positions | Selection regret, pp |
|---|---|---:|---:|---:|
${rankings.map((entry: any) => `| ${entry.query} | ${entry.method} | ${entry.top10Shared}/10 | ${entry.top10SamePositions}/10 | ${pp(entry.top10MeanSelectionRegret)} |`).join("\n")}

## Exact diagnostic counts

Every original pixel was counted for wallpapers 088, 097, 016, and 048, in bounded memory chunks. Two extra independent jitter seeds at each sample level supplement the main seed on these four images. The table shows each main method's worst error among the 18 families, in percentage points.

| Wallpaper | Original pixels | Resize 256 | Resize 1024 | Jitter 65k | Jitter 262k |
|---|---:|---:|---:|---:|---:|
${exactChecks.map((entry: any) => `| ${entry.id} | ${entry.originalPixels.toLocaleString("en-US")} | ${methodIds.map((method) => pp(entry.errors.find((error: any) => error.method === method).absoluteError.max)).join(" | ")} |`).join("\n")}

## Wallpaper-088: strict grayscale coverage

| Measurement | Coverage |
|---|---:|
${Object.entries(grayscale088).map(([method, value]) => `| ${method} | ${pp(Number(value))}% |`).join("\n")}

This separates palette compression, resized-color bias, and original-pixel sampling error for the known narrow-neutral failure.

## Reproduce and interpret

Run \`make color-global-sampling\` only when latency benchmarks are idle. [global-sampling.json](global-sampling.json) records every original hash, sampler seed and grid, per-family errors, complete top-ten comparisons, and exact-subset replicate errors. Regenerable raw measurements live in \`output/global-sampling-cache/\`; prior data and OpenSearch indexes are unchanged.

Full decoding still has an ingestion cost even when only a sample is classified. Jitter removes interpolation and regular-grid aliasing, but the finite sample remains variable. Four exact diagnostics and three seeds do not establish a universal error bound. The family membership definitions are held fixed, so this evaluates their pixel-area measurement rather than whether people agree with those definitions.
`;
  await writeFile(new URL("GLOBAL-SAMPLING.md", root), markdown);
  console.log(JSON.stringify({ aggregateErrors, grayscale088, exactChecks: exactChecks.map((entry: any) => ({ id: entry.id, errors: entry.errors.map(({ method, absoluteError }: any) => ({ method, max: absoluteError.max })) })) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else await main();
}
