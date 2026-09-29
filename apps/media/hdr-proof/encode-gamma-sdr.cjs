'use strict';

// Inputs already contain gamma-2.2 RGB8 samples. Encode those codes directly;
// gamma_icc.py attaches the independently checked ICC after native encoding.
const sharp = require('sharp');
const fs = require('node:fs');

async function main() {
  const job = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!['jpg', 'webp'].includes(job.format)) throw new Error('Unsupported gamma SDR encoder');
  if (job.inputs.length < 1 || job.inputs.length > (job.format === 'webp' ? 2 : 1)) {
    throw new Error('Unsupported frame count');
  }
  const frames = [];
  for (const input of job.inputs) {
    frames.push(await sharp(input, { failOn: 'warning' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  const { width, height } = frames[0].info;
  if (frames.some((frame) => frame.info.width !== width || frame.info.height !== height)) {
    throw new Error('Animation frames must share dimensions');
  }
  let encoder = sharp(Buffer.concat(frames.map((frame) => frame.data)), {
    raw: { width, height: height * frames.length, pageHeight: height, channels: 4 },
  });
  encoder = job.format === 'jpg'
    ? encoder.removeAlpha().jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    : encoder.webp({ lossless: true, exact: true, effort: 4, loop: 3, delay: frames.length === 2 ? [300, 700] : undefined });
  await encoder.toFile(job.output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
