import type { PictureDimensions } from './contract';

export interface PictureEncodedFrame {
  bytes: Uint8Array<ArrayBuffer>;
  duration: number;
}

/** Full composed frames replace the previous canvas. Only image chunks survive packaging. */
export function encodePictureAnimation(
  frames: readonly PictureEncodedFrame[],
  dimensions: PictureDimensions,
  loop: number
): Uint8Array<ArrayBuffer>[] {
  const { width, height } = dimensions;
  if (
    !frames.length ||
    !Number.isInteger(loop) ||
    loop < 0 ||
    loop > 65535 ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 0x1000000 ||
    height > 0x1000000
  )
    throw new Error('Picture animation controls cannot be preserved.');
  function word24(bytes: Uint8Array, offset: number, value: number) {
    bytes[offset] = value;
    bytes[offset + 1] = value >>> 8;
    bytes[offset + 2] = value >>> 16;
  }
  function chunk(type: string, bytes: Uint8Array) {
    const result = new Uint8Array(8 + bytes.length + (bytes.length % 2));
    for (let i = 0; i < 4; i++) result[i] = type.charCodeAt(i);
    new DataView(result.buffer).setUint32(4, bytes.length, true);
    result.set(bytes, 8);
    return result;
  }
  let alpha = false;
  const encoded = frames.flatMap(({ bytes, duration }) => {
    if (!Number.isInteger(duration) || duration < 1 || duration > 0xffffff)
      throw new Error('Picture frame timing cannot be preserved.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
    if (
      bytes.length < 12 ||
      text(0) !== 'RIFF' ||
      text(8) !== 'WEBP' ||
      view.getUint32(4, true) + 8 !== bytes.length
    )
      throw new Error('This browser cannot encode WebP animation frames.');
    const images: Uint8Array<ArrayBuffer>[] = [];
    let offset = 12;
    for (; offset + 8 <= bytes.length; ) {
      const type = text(offset);
      const size = view.getUint32(offset + 4, true);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) throw new Error('Invalid encoded picture frame.');
      if (['ALPH', 'VP8 ', 'VP8L'].includes(type)) images.push(bytes.subarray(offset, end));
      if (type === 'ALPH' || (type === 'VP8L' && bytes[offset + 12] & 0x10)) alpha = true;
      offset = end;
    }
    if (offset !== bytes.length || !images.length)
      throw new Error('Invalid encoded picture frame.');
    const control = new Uint8Array(16);
    word24(control, 6, width - 1);
    word24(control, 9, height - 1);
    word24(control, 12, duration);
    control[15] = 2;
    const header = new Uint8Array(8);
    header.set([65, 78, 77, 70]);
    new DataView(header.buffer).setUint32(
      4,
      16 + images.reduce((size, bytes) => size + bytes.length, 0),
      true
    );
    return [header, control, ...images];
  });
  const extended = new Uint8Array(10);
  extended[0] = 2 | (alpha ? 0x10 : 0);
  word24(extended, 4, width - 1);
  word24(extended, 7, height - 1);
  const controls = new Uint8Array(6);
  new DataView(controls.buffer).setUint16(4, loop, true);
  const body = [chunk('VP8X', extended), chunk('ANIM', controls), ...encoded];
  const header = new Uint8Array(12);
  header.set([82, 73, 70, 70], 0);
  new DataView(header.buffer).setUint32(
    4,
    body.reduce((size, bytes) => size + bytes.length, 0) + 4,
    true
  );
  header.set([87, 69, 66, 80], 8);
  return [header, ...body];
}
