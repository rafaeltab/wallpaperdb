'use strict';

// This is an isolated codec candidate, not Media's delivery implementation.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

function geometry(pipeline, operation) {
  if (operation === 'contain') return pipeline.resize(173);
  if (operation === 'cover') return pipeline.resize(173, 173, { fit: 'cover', position: 'centre' });
  if (operation === 'fill') return pipeline.resize(173, 211, { fit: 'fill' });
  if (operation === 'upscale') return pipeline.resize(769);
  if (operation === 'crop') return pipeline.extract({ left: 13, top: 17, width: 271, height: 239 }).resize(173, 153, { fit: 'fill' });
  if (operation === 'orientation') return pipeline.autoOrient().resize(173);
  throw new Error(`Unknown geometry ${operation}`);
}

function orientMap(pipeline, orientation) {
  if (orientation === 2) return pipeline.flop();
  if (orientation === 3) return pipeline.rotate(180);
  if (orientation === 4) return pipeline.flip();
  if (orientation === 5) return pipeline.flop().rotate(270);
  if (orientation === 6) return pipeline.rotate(90);
  if (orientation === 7) return pipeline.flop().rotate(90);
  if (orientation === 8) return pipeline.rotate(270);
  return pipeline;
}

async function outputColor(pipeline, job) {
  if (job.gamut === 'srgb') return pipeline.withIccProfile('srgb');
  // Source gamut is established independently before this candidate runs.
  // The Android fixture signals sRGB through EXIF but has no embedded ICC.
  if (job.source_gamut === 'srgb' && !(await pipeline.metadata()).icc) {
    return pipeline.withIccProfile('srgb');
  }
  return pipeline.keepIccProfile();
}

async function nativeRetain(job) {
  if (job.format !== 'jpg' || job.gamut !== 'preserve') {
    throw new Error('Native retained-map candidate requires JPEG and gamut=preserve');
  }
  const variant = job.native_variant || 'both';
  if (!['baseline', 'pr484', 'pr491', 'both'].includes(variant)) {
    throw new Error('Unknown pinned libultrahdr variant');
  }
  const executable = `/opt/proof/ultrahdr/${variant}/hdr-proof-uhdr`;
  const directory = path.join(path.dirname(job.output), `native-parts-${variant}`);
  fs.mkdirSync(directory, { recursive: true });
  const base = path.join(directory, 'source-base.jpg');
  const map = path.join(directory, 'source-map.jpg');
  const transformedBase = path.join(directory, 'transformed-base.jpg');
  const transformedMap = path.join(directory, 'transformed-map.jpg');
  const commands = [];
  function native(args) {
    try {
      const stdout = execFileSync(executable, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      commands.push({ argv: [executable, ...args], exit_code: 0, stdout });
      return JSON.parse(stdout);
    } catch (error) {
      commands.push({ argv: [executable, ...args], exit_code: error.status, stderr: error.stderr?.toString() });
      throw error;
    } finally {
      fs.writeFileSync(path.join(directory, 'native-commands.json'), `${JSON.stringify(commands, null, 2)}\n`);
    }
  }
  const source = native(['extract', job.input, base, map]);
  const baseMetadata = await sharp(base).metadata();
  const orientation = job.geometry === 'orientation' ? baseMetadata.orientation || 1 : 1;
  const swapped = orientation >= 5;
  const baseWidth = swapped ? source.height : source.width;
  const baseHeight = swapped ? source.width : source.height;
  const mapWidth = swapped ? source.map_height : source.map_width;
  const mapHeight = swapped ? source.map_width : source.map_height;
  const basePipeline = await outputColor(geometry(sharp(base), job.geometry), job);
  await basePipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(transformedBase);
  const target = await sharp(transformedBase).metadata();
  const mapTargetWidth = Math.max(1, Math.round(target.width * mapWidth / baseWidth));
  const mapTargetHeight = Math.max(1, Math.round(target.height * mapHeight / baseHeight));
  let mapPipeline = orientMap(sharp(map), orientation);
  if (job.geometry === 'crop') {
    const rectangle = { left: 13 * mapWidth / baseWidth, top: 17 * mapHeight / baseHeight,
      width: 271 * mapWidth / baseWidth, height: 239 * mapHeight / baseHeight };
    if (Object.values(rectangle).some((value) => !Number.isInteger(value))) {
      throw new Error('Retained-map crop falls between map pixels; fractional map geometry remains unqualified');
    }
    mapPipeline = mapPipeline.extract(rectangle);
  }
  const fit = job.geometry === 'cover' ? 'cover' : 'fill';
  await mapPipeline.resize(mapTargetWidth, mapTargetHeight, { fit, position: 'centre' })
    .keepIccProfile().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(transformedMap);
  native(['pack', job.input, transformedBase, transformedMap, job.output]);
  return { native_variant: variant, source_gainmap_metadata: source,
    native_commands: path.join(directory, 'native-commands.json'),
    retained_parts: { base: transformedBase, map: transformedMap } };
}

async function main() {
  const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
  for (const job of jobs) {
    try {
      if (job.mode === 'native-retain') {
        const result = await nativeRetain(job);
        process.stdout.write(`${JSON.stringify({ case_id: job.case_id, ok: true, ...result })}\n`);
        continue;
      }
      let pipeline = sharp(job.input, { failOn: 'warning' });
      if (job.mode === 'keep') pipeline = pipeline.keepGainMap();
      if (job.mode === 'regenerate') pipeline = pipeline.withGainMap();
      pipeline = geometry(pipeline, job.geometry);
      pipeline = await outputColor(pipeline, job);
      const options = {
        jpg: { quality: 95, chromaSubsampling: '4:4:4' },
        avif: { quality: 95, bitdepth: 8, chromaSubsampling: '4:4:4', effort: 4 },
        png: { compressionLevel: 6 },
        webp: { lossless: true, effort: 4 },
        gif: { dither: 0, effort: 7 },
      };
      const format = job.format === 'jpg' ? 'jpeg' : job.format;
      await pipeline.toFormat(format, options[job.format]).toFile(job.output);
      process.stdout.write(`${JSON.stringify({ case_id: job.case_id, ok: true })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ case_id: job.case_id, ok: false, error: error.message })}\n`);
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
