// Read-only audit of frozen descriptor checkpoints, independent of search ranking.
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { shadeCoordinates } from './shade-definition.mjs';
import { CUTOFF_LEVELS } from './cutoff-definition.mjs';
import { STORE, hash } from './service.mjs';

async function prepared(folder) {
  const pointer = JSON.parse(await readFile(path.join(STORE, folder, 'current.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(path.join(pointer.directory, 'metadata.json'), 'utf8'));
  if (pointer.identityHash !== metadata.identityHash || hash(metadata.identity) !== metadata.identityHash
    || hash(metadata.assets) !== metadata.descriptorHash || metadata.assets.length !== metadata.count) throw Error(`Invalid ${folder} preparation identity.`);
  for (const [name, expected] of Object.entries(metadata.identity.sourceHashes)) {
    if (hash(await readFile(path.join(pointer.directory, 'sources', name))) !== expected) throw Error(`Changed ${folder} source snapshot: ${name}.`);
  }
  return { directory: pointer.directory, metadata, assets: new Map(metadata.assets.map(asset => [asset.id, asset])) };
}
async function descriptor(preparation, asset) {
  const filename = path.join(preparation.directory, 'descriptors', hash(asset.id).slice(0, 32) + '.json');
  const bytes = await readFile(filename);
  if (hash(bytes) !== asset.descriptorHash) throw Error(`Changed descriptor: ${asset.id}.`);
  const data = JSON.parse(bytes);
  if (data.id !== asset.id || data.sha256 !== asset.sha256 || data.identityHash !== preparation.metadata.identityHash) throw Error(`Descriptor provenance differs: ${asset.id}.`);
  return data.descriptor;
}
const started = performance.now(), shade = await prepared('hues'), original = await prepared('shades');
if (shade.assets.size !== original.assets.size || shade.assets.size !== shade.metadata.count) throw Error('Descriptor corpus counts differ.');
const anchors = OVERLAP_REGIONS.filter(region => shadeCoordinates(region.lab).strength === 0);
let comparedValues = 0, differingValues = 0, maximumQualityDifference = 0, coverageComparisons = 0, coverageIncreases = 0;
const examples = [];
for (const [id, asset] of shade.assets) {
  const priorAsset = original.assets.get(id);
  if (!priorAsset || priorAsset.sha256 !== asset.sha256) throw Error(`Source image provenance differs: ${id}.`);
  const measured = await descriptor(shade, asset), prior = await descriptor(original, priorAsset);
  if (measured.pixelCount !== prior.pixelCount) throw Error(`Preprocessing pixel count differs: ${id}.`);
  for (const { cutoff } of CUTOFF_LEVELS) {
    const next = measured.measurements.find(entry => entry.kernel === 'hard' && entry.cutoff === cutoff);
    const previous = prior.measurements.find(entry => entry.kernel === 'hard' && entry.cutoff === cutoff);
    if (!next || !previous) throw Error(`Missing level: ${id}/${cutoff}.`);
    for (const anchor of OVERLAP_REGIONS) {
      coverageComparisons++;
      if (next.coverage[anchor.index] > previous.coverage[anchor.index]) {
        coverageIncreases++;
        if (examples.length < 20) examples.push({ id, regionIndex: anchor.index, cutoff, field: 'coverage-increase', actual: next.coverage[anchor.index], expectedMaximum: previous.coverage[anchor.index] });
      }
    }
    for (const anchor of anchors) for (const field of ['coverage', 'quality']) {
      const actual = next[field][anchor.index], expected = previous[field][anchor.index];
      comparedValues++;
      if (field === 'quality') maximumQualityDifference = Math.max(maximumQualityDifference, Math.abs(actual - expected));
      if (actual !== expected) {
        differingValues++;
        if (examples.length < 20) examples.push({ id, anchor: anchor.hex, regionIndex: anchor.index, cutoff, field, actual, expected });
      }
    }
  }
}
const result = { generatedAt: new Date().toISOString(), count: shade.assets.size,
  hueIdentity: shade.metadata.identityHash, shadeIdentity: original.metadata.identityHash,
  anchors: anchors.map(({ index, hex, lab }) => ({ index, hex, lab })),
  comparedValues, differingValues, maximumQualityDifference, exactNeutralParity: differingValues === 0,
  coverageComparisons, coverageIncreases, everyCoverageIsSubset: coverageIncreases === 0,
  allSourceAndDescriptorHashesVerified: true, examples, wallMs: performance.now() - started,
};
await writeFile(path.join(shade.directory, 'hue-subset-audit.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.exactNeutralParity || !result.everyCoverageIsSubset) process.exitCode = 1;

