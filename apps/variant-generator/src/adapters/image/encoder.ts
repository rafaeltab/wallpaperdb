import sharp from 'sharp';
import { z } from 'zod';

// This child exclusively owns libvips; interruption kills and reaps native work.
const optionsSchema = z.object({
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  jpegQuality: z.number().int().min(1).max(100),
  pngCompressionLevel: z.number().int().min(0).max(9),
  webpQuality: z.number().int().min(1).max(100),
});

try {
  const options = optionsSchema.parse(JSON.parse(process.argv[2] ?? 'null'));
  const transformer = sharp({
    limitInputPixels: 268402689,
    sequentialRead: true,
    failOnError: false,
  }).resize(options.width, options.height, { fit: 'inside', withoutEnlargement: true });
  if (options.mimeType === 'image/jpeg')
    transformer.jpeg({ quality: options.jpegQuality, progressive: true });
  else if (options.mimeType === 'image/png')
    transformer.png({ compressionLevel: options.pngCompressionLevel });
  else transformer.webp({ quality: options.webpQuality });
  // Sharp emits info before image data. Keep native metadata work in this child
  // and prefix the image with a fixed-size dimension frame for the parent.
  transformer.once('info', ({ width, height }) => {
    const dimensions = Buffer.alloc(8);
    dimensions.writeUInt32BE(width, 0);
    dimensions.writeUInt32BE(height, 4);
    process.stdout.write(dimensions);
  });
  const { pipeline } = await import('node:stream/promises');
  await pipeline(process.stdin, transformer, process.stdout);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Image encoding failed');
  process.exitCode = 1;
}
