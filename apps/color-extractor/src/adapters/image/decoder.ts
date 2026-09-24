import sharp from 'sharp';

// This process owns libvips. The parent can kill and reap it even if native
// metadata decoding does not return; no application resources live here.
try {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const metadata = await sharp(bytes).metadata();
  const aspectRatio = (metadata.width ?? 1) / (metadata.height ?? 1);
  const targetHeight = Math.max(1, Math.round(Math.sqrt(10000 / aspectRatio)));
  const targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
  const pixels = await sharp(bytes)
    .ensureAlpha()
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .raw()
    .toBuffer();
  process.stdout.end(pixels);
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : 'Image decoding failed');
  process.exitCode = 1;
}
