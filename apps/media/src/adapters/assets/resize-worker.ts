import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { z } from 'zod';
const options = z
  .object({
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fit: z.enum(['contain', 'cover', 'fill']),
    mimeType: z.string(),
    maxInputPixels: z.number().int().positive(),
  })
  .parse(JSON.parse(process.argv[2] ?? 'null'));
try {
  const transformer = sharp({
    limitInputPixels: options.maxInputPixels,
    sequentialRead: true,
    failOn: 'none',
  });
  transformer.resize(options.width, options.height, {
    fit: options.fit === 'contain' ? 'inside' : options.fit,
    withoutEnlargement: options.fit !== 'fill',
    ...(options.fit === 'cover' ? { position: sharp.strategy.entropy } : {}),
  });
  if (options.mimeType === 'image/jpeg') transformer.jpeg({ quality: 90, progressive: true });
  else if (options.mimeType === 'image/png') transformer.png({ compressionLevel: 6 });
  else if (options.mimeType === 'image/webp') transformer.webp({ quality: 90 });
  await pipeline(process.stdin, transformer, process.stdout);
} catch (cause) {
  // Native messages can contain input-derived text; export only bounded diagnostic categories.
  const message = cause instanceof Error ? cause.message : '';
  const reason = /unsupported image format/i.test(message)
    ? 'unsupported_input'
    : /pixel limit/i.test(message)
      ? 'input_pixel_limit'
      : /corrupt|invalid|bad header|premature|unexpected end/i.test(message)
        ? 'corrupt_image'
        : 'encoding_failed';
  process.stderr.write(reason);
  process.exitCode = 1;
}
