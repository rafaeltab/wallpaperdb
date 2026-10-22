import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
const options = z
  .object({
    maxBytes: z.number().int().positive(),
    maxPixels: z.number().int().positive(),
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
  const image = sharp(bytes, {
    limitInputPixels: options.maxPixels,
    failOn: 'warning',
    animated: true,
  });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('invalid-image');
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
    throw new Error('unsupported-source-model');
  // Multiframe and gain-map containers cannot silently enter still SDR admission.
  if (
    (metadata.pages ?? 1) > 1 ||
    (metadata.delay?.length ?? 0) > 0 ||
    /(?:hdrgm:|hdr-gain-map|hdr_gain_map|21496|urn:com:apple:photo|MPF\x00)/i.test(
      bytes.toString('latin1')
    )
  )
    throw new Error('unsupported-source-model');
  if (metadata.format === 'png' && bytes.includes(Buffer.from('acTL')))
    throw new Error('unsupported-source-model');
  if (
    options.squareSize &&
    ((metadata.orientation && metadata.orientation !== 1) ||
      metadata.exif ||
      metadata.xmp ||
      metadata.iptc ||
      metadata.icc ||
      metadata.space !== 'srgb')
  )
    throw new Error('noncanonical-picture');
  // Full strict decoding verifies mandatory facts rather than accepting a readable header.
  await image.stats();
  const swap =
    metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  process.stdout.write(
    JSON.stringify({
      model: `sdr-${metadata.format}`,
      mimeType: `image/${metadata.format}`,
      width: swap ? metadata.height : metadata.width,
      height: swap ? metadata.width : metadata.height,
      digest: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    })
  );
} catch (cause) {
  const message = cause instanceof Error ? cause.message : '';
  const safe = ['unsupported-source-model', 'encoded-size-limit', 'noncanonical-picture'].includes(
    message
  )
    ? message
    : 'invalid-image';
  process.stdout.write(JSON.stringify({ rejected: safe }));
  process.exitCode = 0;
}
