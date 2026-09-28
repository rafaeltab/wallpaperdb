'use strict';

// The caller supplies independently verified, already tone/gamut-mapped sRGB.
// This final native encoding stage embeds its color interpretation explicitly.
const sharp = require('sharp');
const fs = require('node:fs');

async function main() {
  const job = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!['jpg', 'webp'].includes(job.format)) throw new Error('Unsupported SDR encoder');
  let pipeline = sharp(job.input, { failOn: 'warning' }).pipelineColourspace('srgb').withIccProfile('srgb');
  pipeline = job.format === 'jpg'
    ? pipeline.jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    : pipeline.webp({ lossless: true, effort: 4 });
  await pipeline.toFile(job.output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
