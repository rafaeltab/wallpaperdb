import type { PictureDimensions } from '../index';

function checkDimensions({ width, height }: PictureDimensions) {
  if (!width || !height) throw new Error('Choose a picture with valid dimensions.');
  // Match Ingestor's validationLimits without coupling the browser to a backend workspace.
  if (width > 20000 || height > 20000)
    throw new Error('Picture exceeds 20,000 pixels per side. Choose a smaller picture.');
  if (width * height > 100_000_000)
    throw new Error('Picture exceeds 100 million pixels. Choose a smaller picture.');
}

/** Admission reads small header slices; it never decodes pixels or copies compressed image data. */
export async function validateSourceDimensions(
  file: Blob,
  format: 'jpeg' | 'png' | 'webp',
  signal: AbortSignal
): Promise<void> {
  const invalid = () => new Error('Choose a picture with valid dimensions.');
  async function read(offset: number, length: number) {
    signal.throwIfAborted();
    if (offset + length > file.size) throw invalid();
    const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    signal.throwIfAborted();
    return bytes;
  }
  if (format === 'png') {
    const bytes = await read(8, 16);
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0) !== 13 || String.fromCharCode(...bytes.slice(4, 8)) !== 'IHDR')
      throw invalid();
    checkDimensions({ width: view.getUint32(8), height: view.getUint32(12) });
    return;
  }
  if (format === 'jpeg') {
    for (let offset = 2; offset + 4 <= file.size; ) {
      const marker = await read(offset, 2);
      if (marker[0] !== 255) throw invalid();
      if (marker[1] === 255) {
        offset++;
        continue;
      }
      if (marker[1] === 218 || marker[1] === 217) break;
      const length = new DataView((await read(offset + 2, 2)).buffer).getUint16(0);
      if (length < 2 || offset + 2 + length > file.size) throw invalid();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker[1])) {
        if (length < 8) throw invalid();
        const frame = new DataView((await read(offset + 4, 5)).buffer);
        checkDimensions({ width: frame.getUint16(3), height: frame.getUint16(1) });
        return;
      }
      offset += 2 + length;
    }
    throw invalid();
  }
  const header = new DataView((await read(0, 12)).buffer);
  if (header.getUint32(4, true) + 8 !== file.size) throw invalid();
  let hasImage = false;
  for (let offset = 12; offset + 8 <= file.size; ) {
    const chunk = await read(offset, 8);
    const type = String.fromCharCode(...chunk.slice(0, 4));
    const length = new DataView(chunk.buffer).getUint32(4, true);
    const next = offset + 8 + length + (length % 2);
    if (next > file.size) throw invalid();
    if (type === 'ANMF')
      throw new Error('Animated WebP pictures are not supported. Choose a static picture.');
    if (type === 'VP8X') {
      if (length !== 10) throw invalid();
      const bytes = await read(offset + 8, 10);
      if (bytes[0] & 2)
        throw new Error('Animated WebP pictures are not supported. Choose a static picture.');
      const uint24 = (start: number) =>
        bytes[start] + bytes[start + 1] * 256 + bytes[start + 2] * 65536;
      checkDimensions({ width: uint24(4) + 1, height: uint24(7) + 1 });
    } else if (type === 'VP8L') {
      if (length < 5) throw invalid();
      const bytes = await read(offset + 8, 5);
      if (bytes[0] !== 47) throw invalid();
      const bits = new DataView(bytes.buffer).getUint32(1, true);
      checkDimensions({ width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 });
      hasImage = true;
    } else if (type === 'VP8 ') {
      if (length < 10) throw invalid();
      const bytes = await read(offset + 8, 10);
      if (bytes[3] !== 157 || bytes[4] !== 1 || bytes[5] !== 42) throw invalid();
      const frame = new DataView(bytes.buffer);
      checkDimensions({
        width: frame.getUint16(6, true) & 0x3fff,
        height: frame.getUint16(8, true) & 0x3fff,
      });
      hasImage = true;
    }
    offset = next;
    if (offset === file.size && hasImage) return;
  }
  throw invalid();
}
