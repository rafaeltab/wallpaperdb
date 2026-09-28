'use strict';

// This is an isolated codec candidate, not Media's delivery implementation.
const fs = require('node:fs');
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

async function main() {
  const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
  for (const job of jobs) {
    try {
      let pipeline = sharp(job.input, { failOn: 'warning' });
      if (job.mode === 'keep') pipeline = pipeline.keepGainMap();
      if (job.mode === 'regenerate') pipeline = pipeline.withGainMap();
      pipeline = geometry(pipeline, job.geometry);
      pipeline = job.gamut === 'srgb' ? pipeline.withIccProfile('srgb') : pipeline.keepIccProfile();
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
