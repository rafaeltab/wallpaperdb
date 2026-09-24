// Read-only pixel diagnostics. Counterfactual scores never enter search or gallery ranking.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rgbToLab, rgbToHsv } from './corpus-colors.mjs';
import { shadeCoordinates, shadeQualityForCoordinates, shadeIndexForCount } from './shade-definition.mjs';
import { CUTOFF_LEVELS, cutoffFields } from './cutoff-definition.mjs';
import { cutoffQueryComponents } from './cutoff-blend.mjs';
import { OVERLAP_REGIONS } from './overlap-regions.mjs';
import { loadExpandedCorpus, STORE, hash, api } from './service.mjs';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const directory = path.resolve(option('--directory', path.join(STORE, 'shade-pair', '2026-09-21')));
const ids = option('--ids', 'madness-wallhaven-ogg7ql,wallpaper-031,madness-wallhaven-gww23l,madness-wallhaven-9oov2d').split(',');
const interventions = args.includes('--variants');
const sharp = createRequire(new URL('../../../apps/color-extractor/package.json', import.meta.url))('sharp');
sharp.concurrency(1);
const target = OVERLAP_REGIONS.find(region => region.hex === '#ff0000'), anchor = shadeCoordinates(target.lab);
const clamp = value => Math.min(1, Math.max(0, value));
const smoothstep = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const rgbFor = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const hexFor = rgb => '#' + rgb.map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
const variants = [{ id: 'baseline', angularMultiplier: 1 }, ...(interventions ? [
  { id: 'angular-1.5', angularMultiplier: 1.5 }, { id: 'angular-2', angularMultiplier: 2 }, { id: 'angular-3', angularMultiplier: 3 },
  { id: 'hue-gate-15-45', angularMultiplier: 1, hueCore: 15, hueEdge: 45 },
  { id: 'hue-gate-10-30', angularMultiplier: 1, hueCore: 10, hueEdge: 30 },
] : [])];

function measure(rgb) {
  const lab = rgbToLab(rgb), pixel = shadeCoordinates(lab), current = shadeQualityForCoordinates(pixel, anchor);
  const cp = Math.hypot(pixel.a, pixel.b), ct = Math.hypot(anchor.a, anchor.b);
  const cosine = cp * ct > 0 ? Math.max(-1, Math.min(1, (pixel.a * anchor.a + pixel.b * anchor.b) / (cp * ct))) : 1;
  const hueGapDegrees = cp * ct > 1e-14 ? Math.acos(cosine) * 180 / Math.PI : null;
  const relativeCp = Math.hypot(pixel.relativeA, pixel.relativeB), relativeCt = Math.hypot(anchor.relativeA, anchor.relativeB);
  const lightnessSquared = (anchor.lightnessWeight * (pixel.l - anchor.l)) ** 2;
  const radialRaw = (1 - anchor.beta) * (cp - ct) ** 2;
  const angularRaw = (1 - anchor.beta) * 2 * cp * ct * (1 - cosine);
  const radialNormalized = anchor.beta * anchor.l ** 2 * (relativeCp - relativeCt) ** 2;
  const angularNormalized = anchor.beta * anchor.l ** 2 * 2 * relativeCp * relativeCt * (1 - cosine);
  const radialSquared = radialRaw + radialNormalized, angularSquared = angularRaw + angularNormalized;
  const squared = lightnessSquared + radialSquared + angularSquared;
  assert.ok(Math.abs(squared - current.distance ** 2) < 2e-14, 'Polar decomposition must reproduce frozen shade geometry.');
  const values = variants.map(variant => {
    if (variant.id === 'baseline') return { id: variant.id, ...current };
    const distance = Math.sqrt(lightnessSquared + radialSquared + angularSquared * variant.angularMultiplier ** 2);
    const hueGate = variant.hueEdge === undefined ? 1 : (hueGapDegrees === null ? 0 : smoothstep((variant.hueEdge - hueGapDegrees) / (variant.hueEdge - variant.hueCore)));
    const gate = 1 - anchor.strength + anchor.strength * hueGate;
    return { id: variant.id, distance, referenceQuality: gate * current.visibility * Math.max(0, 1 - distance / .24),
      support: distance / .24 <= 1 + 1e-12 && current.visibility > 0 && gate > 0, hueGate: gate };
  });
  return { hex: hexFor(rgb), lab, hsv: rgbToHsv(rgb), chroma: cp, relativeChroma: relativeCp, hueGapDegrees,
    lightnessSquared, radialSquared, angularSquared, radialRaw, radialNormalized, angularRaw, angularNormalized,
    current, variants: values };
}
function diagnostics(pixels) {
  const selected = [], groups = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    const rgb = [0, 1, 2].map(channel => Math.round(pixels[i + channel] * alpha) / 255);
    selected.push(measure(rgb));
    const key = rgb.map(channel => Math.min(15, Math.floor(channel * 16))).join(',');
    if (!groups.has(key)) groups.set(key, { count: 0, rgb: [0, 0, 0] });
    const group = groups.get(key); group.count++; rgb.forEach((channel, index) => { group.rgb[index] += channel; });
  }
  function summarizeGroup(name, definition, predicate) {
    const chosen = selected.filter(predicate), count = chosen.length;
    const sums = Object.fromEntries(['lightnessSquared', 'radialSquared', 'angularSquared'].map(key => [key, chosen.reduce((sum, pixel) => sum + pixel[key], 0)]));
    const total = Object.values(sums).reduce((sum, value) => sum + value, 0);
    const hueDefined = chosen.filter(pixel => pixel.hueGapDegrees !== null);
    return { name, definition, count, area: count / selected.length,
      squaredDistanceShares: Object.fromEntries(Object.entries(sums).map(([key, value]) => [key, total ? value / total : 0])),
      meanHueGapDegrees: hueDefined.length ? hueDefined.reduce((sum, pixel) => sum + pixel.hueGapDegrees, 0) / hueDefined.length : null,
      meanQuality: count ? chosen.reduce((sum, pixel) => sum + pixel.current.referenceQuality, 0) / count : 0,
    };
  }
  const summaries = variants.map(variant => {
    const values = selected.map(pixel => pixel.variants.find(value => value.id === variant.id));
    const levels = CUTOFF_LEVELS.map(({ cutoff }) => {
      const accepted = values.filter(value => value.support && value.referenceQuality + 1e-12 >= cutoff);
      const quality = accepted.length ? accepted.reduce((sum, value) => sum + Math.max(cutoff, value.referenceQuality), 0) / accepted.length : 0;
      return { cutoff, pixels: accepted.length, physicalArea: accepted.length / selected.length,
        coverage: Math.round(accepted.length / selected.length * 10000), quality: Math.fround(quality) };
    });
    const scores = [0, 3, 6].flatMap(cutoffBlendExponent => [1, 3].map(qualityInfluence => {
      const components = cutoffQueryComponents('all-levels', 0, cutoffBlendExponent).map(component => {
        const level = levels.find(level => level.cutoff === component.cutoff);
        const unweighted = Math.sqrt(level.coverage / 10000) * level.quality ** qualityInfluence;
        return { cutoff: component.cutoff, distributionWeight: component.weight, coverage: level.coverage, quality: level.quality,
          unweighted, contribution: component.weight * unweighted };
      });
      return { cutoffBlendExponent, qualityInfluence, diagnosticScore: components.reduce((sum, component) => sum + component.contribution, 0), components };
    }));
    return { ...variant, levels, scores };
  });
  return { pixelCount: selected.length, groups: [
    summarizeGroup('all', 'Every sampled pixel; not an image perception label.', () => true),
    summarizeGroup('admitted-q0', 'Pixels admitted by current shade-aware 0% hard layer.', pixel => pixel.current.support),
    summarizeGroup('red-hsv-loose', 'Diagnostic only: HSV hue within20° of red, S>=.18,V>=.10.', pixel => Math.min(pixel.hsv[0], 360 - pixel.hsv[0]) <= 20 && pixel.hsv[1] >= .18 && pixel.hsv[2] >= .1),
    summarizeGroup('red-hsv-saturated', 'Diagnostic only: HSV hue within20° of red, S>=.60,V>=.10.', pixel => Math.min(pixel.hsv[0], 360 - pixel.hsv[0]) <= 20 && pixel.hsv[1] >= .60 && pixel.hsv[2] >= .1),
    summarizeGroup('orange-yellow-hsv', 'Diagnostic only: HSV hue20..75°, S>=.30,V>=.10.', pixel => pixel.hsv[0] > 20 && pixel.hsv[0] <= 75 && pixel.hsv[1] >= .30 && pixel.hsv[2] >= .1),
  ], variants: summaries,
  prominentColorGroups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20).map(group => ({ area: group.count / selected.length, ...measure(group.rgb.map(value => value / group.count)) })),
  };
}

const corpus = await loadExpandedCorpus(), images = [];
for (const id of ids) {
  const asset = corpus.find(asset => asset.id === id);
  if (!asset) throw Error(`Unknown original asset: ${id}.`);
  const bytes = await readFile(asset.filename);
  assert.equal(hash(bytes), asset.sha256, 'Retained source must match corpus hash.');
  const pixels = await sharp(bytes).rotate().toColourspace('srgb').ensureAlpha().resize(128, 128, { fit: 'fill' }).raw().toBuffer();
  const measured = diagnostics(pixels), fields = CUTOFF_LEVELS.flatMap(({ cutoff }) => Object.values(cutoffFields(target.index, 'hard', cutoff)));
  const response = await api(`${shadeIndexForCount(16)}/_search`, { method: 'POST', body: { size: 1, _source: fields, query: { term: { id } } } });
  assert.equal(response.body.hits.hits.length, 1);
  const source = response.body.hits.hits[0]._source;
  const sourceComparisons = measured.variants[0].levels.map(level => {
    const names = cutoffFields(target.index, 'hard', level.cutoff);
    assert.equal(source[names.coverage], level.coverage, 'Replayed pixel area must equal actual indexed observation.');
    assert.equal(source[names.quality], level.quality, 'Replayed pixel quality must equal actual indexed float32 observation.');
    return { cutoff: level.cutoff, coverage: level.coverage, quality: level.quality };
  });
  images.push({ id, filename: asset.filename, sha256: asset.sha256, sourceParity: { verified: true, index: shadeIndexForCount(16), sourceComparisons }, ...measured });
}
const swatchHexes = ['#ff0000', '#ff2200', '#c00000', '#a00000', '#800000', '#600000', '#100000', '#b53738', '#b55050', '#642b2a', '#ed7700', '#ff6600', '#ff8000', '#ffa500', '#ffff00', '#805030', '#804000', '#ff8080', '#ff0080', '#808080', '#202020', '#000000'];
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), diagnosticOnly: true,
  interpretation: 'Offline counterfactual pixel summaries explain a ranking failure. They are neither service search implementations nor global rank predictions, and no indexes or gallery results are changed.',
  target: { hex: target.hex, lab: target.lab, index: target.index }, parameters: { sampleSize: 128, areaPower: .5, qualityCurve: 'power', minimumQuality: 0, variants },
  decomposition: 'd² = weighted lightness² + radial chroma² + angular hue². Raw and relative chroma each use (C-Ct)² + 2*C*Ct*(1-cos(h-ht)); this is algebraically the frozen shade metric, verified per pixel.',
  images, swatches: swatchHexes.map(hex => measure(rgbFor(hex))),
};
await mkdir(directory, { recursive: true });
await copyFile(fileURLToPath(import.meta.url), path.join(directory, 'shade-pair-probe.mjs'));
const filename = path.join(directory, interventions ? 'pixel-variants.json' : 'pixel-baseline.json');
await writeFile(filename, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: filename, diagnosticOnly: true, images: images.map(image => ({ id: image.id, sourceParity: image.sourceParity,
  groups: image.groups, scores: image.variants.map(variant => ({ id: variant.id, scores: variant.scores.map(({ cutoffBlendExponent, qualityInfluence, diagnosticScore }) => ({ cutoffBlendExponent, qualityInfluence, diagnosticScore })) })) })) }, null, 2));
