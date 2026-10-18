import sharp from 'sharp';
import { z } from 'zod';

// This child exclusively owns libvips; interruption kills and reaps native work.
const encodingSchema = z.object({
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  jpegQuality: z.number().int().min(1).max(100),
  pngCompressionLevel: z.number().int().min(0).max(9),
  webpQuality: z.number().int().min(1).max(100),
});

try {
  const options = z
    .union([z.object({ inspect: z.literal(true) }), encodingSchema])
    .parse(JSON.parse(process.argv[2] ?? 'null'));
  const transformer = sharp({
    limitInputPixels: 268402689,
    sequentialRead: true,
    failOnError: false,
  });
  const { pipeline } = await import('node:stream/promises');
  if ('inspect' in options) {
    const [, metadata] = await Promise.all([
      pipeline(process.stdin, transformer),
      transformer.metadata(),
    ]);
    if (!metadata.width || !metadata.height) throw new Error('Image has no dimensions');
    const swapped =
      metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const dimensions = Buffer.alloc(8);
    dimensions.writeUInt32BE(swapped ? metadata.height : metadata.width, 0);
    dimensions.writeUInt32BE(swapped ? metadata.width : metadata.height, 4);
    process.stdout.write(dimensions);
  } else {
    transformer
      // Apply EXIF to pixels before fitting; default output strips source metadata.
      .rotate()
      .resize(options.width, options.height, { fit: 'inside', withoutEnlargement: true });
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
    await pipeline(process.stdin, transformer, process.stdout);
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Image encoding failed');
  process.exitCode = 1;
}
