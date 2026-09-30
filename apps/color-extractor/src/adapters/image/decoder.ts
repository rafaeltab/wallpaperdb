import sharp from 'sharp';

// This process owns libvips. The parent can kill and reap it even if native
// metadata decoding does not return; no application resources live here.
try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const pixels = await sharp(bytes)
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .resize(128, 128, { fit: 'fill' })
    .raw()
    .toBuffer();
  process.stdout.end(pixels);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Image decoding failed');
  process.exitCode = 1;
}
