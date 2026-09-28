'use strict';
const sharp = require('sharp');

async function main() {
  const job = JSON.parse(process.argv[2]);
  const frames = [];
  for (const input of job.inputs) {
    frames.push(await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  const { width, height } = frames[0].info;
  if (frames.some((frame) => frame.info.width !== width || frame.info.height !== height)) {
    throw new Error('Animation frames must share dimensions');
  }
  // The raw pages are already fully composed sRGB frames from libplacebo.
  // libwebp writes exact unequal durations instead of inferring a last duration.
  await sharp(Buffer.concat(frames.map((frame) => frame.data)), {
    raw: { width, height: height * frames.length, pageHeight: height, channels: 4 },
  }).withIccProfile('srgb').webp({ lossless: true, loop: 3, delay: [300, 700] }).toFile(job.output);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
