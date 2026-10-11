/** Canvas pixels are already sRGB SDR. Drop encoder-added profiles and unrelated metadata. */
export async function withoutPictureMetadata(blob: Blob): Promise<Blob> {
  if (blob.type !== 'image/webp')
    throw new Error('This browser cannot encode WebP pictures. Try another browser.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (
    bytes.length < 12 ||
    text(0) !== 'RIFF' ||
    text(8) !== 'WEBP' ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    throw new Error('This browser produced an invalid WebP picture.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 12;
  for (; offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) throw new Error('This browser produced an invalid WebP picture.');
    const type = text(offset);
    if (['VP8X', 'ALPH', 'VP8 ', 'VP8L'].includes(type)) {
      const chunk = bytes.slice(offset, end);
      if (type === 'VP8X') chunk[8] &= 0x10;
      chunks.push(chunk);
    }
    offset = end;
  }
  if (offset !== bytes.length) throw new Error('This browser produced an invalid WebP picture.');
  const header = bytes.slice(0, 12);
  new DataView(header.buffer).setUint32(
    4,
    4 + chunks.reduce((size, chunk) => size + chunk.length, 0),
    true
  );
  return new Blob([header, ...chunks], { type: 'image/webp' });
}
