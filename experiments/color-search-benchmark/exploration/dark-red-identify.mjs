// Read-only diagnostic replay. No corpus, indexes or scoring definitions change.
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadExpandedCorpus, STORE, hash } from './service.mjs';
import { createOverlapInspectorProvider } from './overlap-inspector-provider.mjs';

const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 20 });
const args = process.argv.slice(2);
const argument = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const attachment = argument('--image') ?? '/home/rafaeltab/.t3/userdata/attachments/2e3d9373-52f7-4563-8387-0de843690bfe-d63b0812-971c-45c5-b37a-0a5300402a78.webp';
const directory = argument('--output-directory') ?? path.join(STORE, 'dark-red', '2026-09-21');
const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
await mkdir(directory, { recursive: true });
const save = async (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const corpus = await loadExpandedCorpus();
const thumb = filename => sharp(filename).rotate().toColourspace('srgb').flatten({ background: '#000000' }).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
const attachmentBytes = await readFile(attachment);
const attachmentPixels = await thumb(attachment);
const attachmentMetadata = await sharp(attachment).metadata();
const comparisons = [];
for (const asset of corpus) {
  if (asset.cohort === 'controlled-fixture') continue;
  const thumbnail = typeof asset.thumbnail === 'string' ? asset.thumbnail : asset.thumbnail?.filename;
  const pixels = await thumb(thumbnail ?? asset.filename);
  if (pixels.length !== attachmentPixels.length) throw Error('Unexpected thumbnail channels');
  let absolute = 0, squared = 0;
  for (let i = 0; i < pixels.length; i++) {
    const delta = pixels[i] - attachmentPixels[i]; absolute += Math.abs(delta); squared += delta * delta;
  }
  comparisons.push({ id: asset.id, meanAbsoluteRgbError: absolute / pixels.length, rootMeanSquareRgbError: Math.sqrt(squared / pixels.length), exactSourceHash: asset.sha256 === hash(attachmentBytes) });
}
comparisons.sort((a, b) => a.rootMeanSquareRgbError - b.rootMeanSquareRgbError || a.id.localeCompare(b.id));
const match = corpus.find(asset => asset.id === comparisons[0].id);
const originalPixels = await thumb(match.filename);
let originalAbsolute = 0, originalSquared = 0;
for (let i = 0; i < originalPixels.length; i++) {
  const delta = originalPixels[i] - attachmentPixels[i]; originalAbsolute += Math.abs(delta); originalSquared += delta * delta;
}
const originalMetadata = await sharp(match.filename).metadata();
const identification = { createdAt: new Date().toISOString(), attachment: { path: attachment, sha256: hash(attachmentBytes), width: attachmentMetadata.width, height: attachmentMetadata.height, bytes: attachmentBytes.length }, matchedAsset: match,
  sourceMetadata: { width: originalMetadata.width, height: originalMetadata.height, format: originalMetadata.format },
  method: 'Every real corpus thumbnail compared at auto-oriented sRGB64x64 fill RGB, followed by original-source verification. Errors use byte-valued RGB, 0..255.',
  sourceComparison: { meanAbsoluteRgbError: originalAbsolute / originalPixels.length, rootMeanSquareRgbError: Math.sqrt(originalSquared / originalPixels.length) },
  comparisons, limitations: ['Visual identification only when source hashes differ; resize and recompression can change exact pixel statistics.', 'Ranking replay assumes picked red, vibe mode, power quality, minimum average quality0. Exact user controls are unknown.'] };
await save('identification.json', identification);
await sharp(match.filename).rotate().resize({ width: 900, height: 900, fit: 'inside' }).jpeg({ quality: 90 }).toFile(path.join(directory, 'matched-wallpaper.jpg'));
console.log(JSON.stringify({ identification: { id: match.id, attachmentSha256: identification.attachment.sha256, sourceSha256: match.sha256, sourceComparison: identification.sourceComparison, best: comparisons.slice(0, 3), originalFilename: match.filename } }));
if (process.argv.includes('--identify-only')) process.exit(0);
if (comparisons[0].rootMeanSquareRgbError > 15 || identification.sourceComparison.rootMeanSquareRgbError > 15) throw Error('Image identification insufficiently close; review before ranking');

const provider = await createOverlapInspectorProvider();
const runs = [];
for (const bucketCount of [16, 64, 256, 1024]) {
  for (const qualityInfluence of [1, 3]) {
    for (const cutoffBlendExponent of [0, 3, 6]) runs.push({ method: 'cutoff-all-levels', parameters: { bucketCount, qualityInfluence, qualityCurve: 'power', minimumQuality: 0, pixelCutoff: 0, namedMode: 'concrete-swatches', cutoffBlendExponent } });
    runs.push({ method: 'overlap-quality-dense', parameters: { bucketCount, qualityInfluence, qualityCurve: 'power', minimumQuality: 0 } });
  }
}
const matrix = [];
for (const run of runs) {
  const result = await provider.search({ ...run, query, limit: corpus.length });
  const targetIndex = result.hits.findIndex(hit => hit.id === match.id);
  if (targetIndex < 0 || result.hits.length !== 523) throw Error(`Incomplete replay: ${result.hits.length} hits, target at ${targetIndex}`);
  const target = result.hits[targetIndex];
  const inspection = await provider.inspect({ ...run, query, id: match.id });
  if (Math.abs(target.score - inspection.score.actual) > 1e-6) throw Error('Inspection and search scores differ');
  const greater = result.hits.filter(hit => hit.score > target.score).length;
  const tied = result.hits.filter(hit => hit.score === target.score).length;
  const entry = { ...run, query, parameters: result.parameters, rank: targetIndex + 1, rankIntervalIgnoringIdTieBreak: [greater + 1, greater + tied], hitCount: result.hits.length, score: target.score,
    terms: inspection.score.terms, formula: inspection.score.formula, reconstructionDifference: inspection.score.difference,
    evidence: result.evidence, orderedHits: result.hits, inspectionEvidence: inspection.evidence,
    selectedRegion: inspection.regions.find(region => region.selectedBy?.length) };
  matrix.push(entry);
  console.log(JSON.stringify({ method: run.method, bucketCount: run.parameters.bucketCount, qualityInfluence: run.parameters.qualityInfluence, cutoffBlendExponent: run.parameters.cutoffBlendExponent, rank: entry.rank, score: entry.score, topIds: result.hits.slice(0, 5).map(hit => hit.id) }));
}
const sources = ['dark-red-identify.mjs','overlap-inspector-provider.mjs','registry.mjs','methods-overlap.mjs','methods-cutoff.mjs','quality-curve.mjs','overlap-diagnostics.mjs','cutoff-diagnostics.mjs','cutoff-blend.mjs','cutoff-definition.mjs','overlap-banks.mjs','overlap-regions.mjs'];
const sourceHashes = {};
await mkdir(path.join(directory, 'identification-sources'), { recursive: true });
for (const name of sources) {
  const filename = fileURLToPath(new URL(name, import.meta.url));
  sourceHashes[name] = hash(await readFile(filename));
  await copyFile(filename, path.join(directory, 'identification-sources', name));
}
await save('rank-matrix.json', { createdAt: new Date().toISOString(), identificationFile: 'identification.json', query, matchedId: match.id, sourceHashes, matrix,
  notes: ['Scores and ordering returned by real OpenSearch; no application reranking.', 'All523real wallpapers retained; controlled fixtures excluded by the existing provider inside OpenSearch.', '32replays:24all-level bank/influence/blend combinations and8originalfixed-cutoffreferences.', 'This is an explanatory replay, not a latency benchmark or a human preference judgment.'] });
console.log(JSON.stringify({ directory, matchedId: match.id, runs: matrix.length }));
