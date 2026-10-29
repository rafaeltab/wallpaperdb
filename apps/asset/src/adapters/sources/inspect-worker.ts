import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { checkEncodedPolicy } from './encoded-policy.js';
const options = z
  .object({
    maxBytes: z.number().int().positive(),
    maxPixels: z.number().int().positive(),
    maxAxis: z.number().int().positive(),
    squareSize: z.number().int().positive().optional(),
  })
  .parse(JSON.parse(process.argv[2] ?? 'null'));
try {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > options.maxBytes) throw new Error('encoded-size-limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  checkEncodedPolicy(bytes, options.squareSize !== undefined);
  // Header discovery cannot allocate decoded frames. Each frame is bounded and decoded separately below.
  const metadata = await sharp(bytes, {
    limitInputPixels: false,
    animated: true,
    failOn: 'warning',
  }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('invalid-image');
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
    throw new Error('unsupported-source-model');
  const frames = metadata.pages ?? 1;
  const animated = frames > 1;
  if (animated && (!options.squareSize || metadata.format !== 'webp'))
    throw new Error('unsupported-source-model');
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (width > options.maxAxis || height > options.maxAxis || width * height > options.maxPixels)
    throw new Error('geometry-limit');
  if (
    options.squareSize &&
    (width !== options.squareSize ||
      height !== options.squareSize ||
      (metadata.orientation && metadata.orientation !== 1) ||
      metadata.exif ||
      metadata.xmp ||
      metadata.iptc ||
      metadata.icc ||
      metadata.space !== 'srgb')
  )
    throw new Error('noncanonical-picture');
  if (animated && (metadata.loop === undefined || metadata.delay?.length !== frames))
    throw new Error('invalid-image');
  // Decode small animations once within the existing pixel allocation budget.
  // Reopening each page repeatedly decodes its predecessors, making long tiny
  // animations exceed the HTTP lifetime despite their small decoded footprint.
  if (animated && frames <= Math.floor(options.maxPixels / (width * height))) {
    await sharp(bytes, {
      animated: true,
      limitInputPixels: options.maxPixels,
      failOn: 'warning',
    }).stats();
  } else {
    // Larger animations still allocate at most one bounded frame at a time.
    for (let page = 0; page < frames; page++)
      await sharp(bytes, {
        page,
        pages: 1,
        limitInputPixels: options.maxPixels,
        failOn: 'warning',
      }).stats();
  }
  const swap =
    metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  process.stdout.write(
    JSON.stringify({
      model: animated ? 'animated-sdr-webp' : `sdr-${metadata.format}`,
      mimeType: `image/${metadata.format}`,
      width: swap ? height : width,
      height: swap ? width : height,
      hasAlpha: metadata.hasAlpha ?? false,
      orientation: metadata.orientation ?? 1,
      ...(animated ? { animation: { frames, loop: metadata.loop, delaysMs: metadata.delay } } : {}),
      digest: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    })
  );
} catch (cause) {
  const message = cause instanceof Error ? cause.message : '';
  const safe = [
    'unsupported-source-model',
    'encoded-size-limit',
    'noncanonical-picture',
    'geometry-limit',
  ].includes(message)
    ? message
    : 'invalid-image';
  process.stdout.write(JSON.stringify({ rejected: safe }));
}
