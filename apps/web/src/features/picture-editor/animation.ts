/** GIF delays follow browser playback: unspecified or <=10ms displays for 100ms. */
export function pictureAnimationTiming(delays: readonly number[], repetitions?: number) {
  if (
    repetitions !== undefined &&
    (!Number.isInteger(repetitions) || repetitions < 0 || repetitions >= 65535)
  )
    throw new Error('This GIF loop count cannot be preserved as WebP.');
  return {
    durations: delays.map((delay) => {
      if (!Number.isInteger(delay) || delay < 0 || delay > 65535)
        throw new Error('Invalid GIF frame timing.');
      return delay <= 1 ? 100 : delay * 10;
    }),
    loop: repetitions === undefined ? 1 : repetitions === 0 ? 0 : repetitions + 1,
  };
}

export type PictureGifStep =
  | { kind: 'size'; width: number; height: number }
  | { kind: 'progress' }
  | {
      kind: 'frame';
      pixels: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
      duration: number;
    };

function invalid(): never {
  throw new Error('Unable to decode this GIF picture.');
}

function* lzw(
  data: Uint8Array,
  minimum: number,
  count: number
): Generator<PictureGifStep, Uint8Array> {
  if (minimum < 2 || minimum > 8) invalid();
  const clear = 1 << minimum;
  const end = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const pixels = new Uint8Array(count);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minimum + 1;
  let next = end + 1;
  let previous = -1;
  let first = 0;
  let bit = 0;
  let written = 0;
  let checkpoint = 0;
  let codes = 0;
  let started = false;
  while (bit + size <= data.length * 8) {
    if (++codes === 8192) {
      codes = 0;
      yield { kind: 'progress' };
    }
    let code = 0;
    for (let i = 0; i < size; i++) code |= ((data[(bit + i) >>> 3] >>> ((bit + i) & 7)) & 1) << i;
    bit += size;
    if (!started && code !== clear) invalid();
    started = true;
    if (code === clear) {
      size = minimum + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) {
      if (written !== count) invalid();
      return pixels;
    }
    const original = code;
    let depth = 0;
    if (code === next && previous >= 0) {
      stack[depth++] = first;
      code = previous;
    } else if (code >= next) invalid();
    while (code >= clear) {
      if (depth >= 4095 || code >= next) invalid();
      stack[depth++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[depth++] = first;
    if (written + depth > count) invalid();
    while (depth) pixels[written++] = stack[--depth];
    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next++] = first;
      if (next === 1 << size && size < 12) size++;
    }
    previous = original;
    if (written - checkpoint >= 16384) {
      checkpoint = written;
      yield { kind: 'progress' };
    }
  }
  return invalid();
}

/** Borrowed full-canvas pixels are valid until next(). Progress steps bound synchronous work.
 * Consumers yield at each step and close the iterator on cancellation to release frame memory.
 */
export function* decodePictureGif(
  bytes: Uint8Array
): Generator<PictureGifStep, { loop: number; frameCount: number; animated: boolean }> {
  let offset = 0;
  const take = (length: number) => {
    if (offset + length > bytes.length) invalid();
    const result = bytes.subarray(offset, offset + length);
    offset += length;
    return result;
  };
  const byte = () => take(1)[0];
  const word = () => {
    const value = take(2);
    return value[0] | (value[1] << 8);
  };
  const text = (length: number) => String.fromCharCode(...take(length));
  function* blocks(): Generator<PictureGifStep, Uint8Array> {
    const parts: Uint8Array[] = [];
    let length = 0;
    let checkpoint = offset;
    for (let size = byte(); size; size = byte()) {
      parts.push(take(size));
      length += size;
      if (offset - checkpoint >= 16384) {
        checkpoint = offset;
        yield { kind: 'progress' };
      }
    }
    const data = new Uint8Array(length);
    let position = 0;
    checkpoint = 0;
    for (const part of parts) {
      data.set(part, position);
      position += part.length;
      if (position - checkpoint >= 16384) {
        checkpoint = position;
        yield { kind: 'progress' };
      }
    }
    return data;
  }
  if (!['GIF87a', 'GIF89a'].includes(text(6))) invalid();
  const width = word();
  const height = word();
  if (!width || !height) invalid();
  const flags = byte();
  const backgroundIndex = byte();
  byte();
  const global = flags & 128 ? take(3 * (1 << ((flags & 7) + 1))) : undefined;
  if (global && backgroundIndex * 3 + 2 >= global.length) invalid();
  const background = global?.subarray(backgroundIndex * 3, backgroundIndex * 3 + 3);
  yield { kind: 'size', width, height };
  const canvas = new Uint8ClampedArray(width * height * 4);
  function* restoreBackground(
    left: number,
    top: number,
    columns: number,
    rows: number,
    opaque: boolean
  ): Generator<PictureGifStep> {
    const color =
      opaque && background ? [background[0], background[1], background[2], 255] : [0, 0, 0, 0];
    let work = 0;
    for (let y = top; y < top + rows; y++) {
      for (let x = left; x < left + columns; x++) {
        const target = (y * width + x) * 4;
        canvas.set(color, target);
        if (++work === 16384) {
          work = 0;
          yield { kind: 'progress' };
        }
      }
    }
  }
  let repetitions: number | undefined;
  let frameCount = 0;
  let delay = 0;
  let disposal = 0;
  let transparent: number | undefined;
  for (;;) {
    yield { kind: 'progress' };
    const marker = byte();
    if (marker === 0x3b) {
      if (!frameCount || offset !== bytes.length) invalid();
      return {
        loop: pictureAnimationTiming([], repetitions).loop,
        frameCount,
        animated: frameCount > 1 || repetitions !== undefined,
      };
    }
    if (marker === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (byte() !== 4) invalid();
        const control = byte();
        if (control & 0xe2 || ((control >>> 2) & 7) > 3)
          throw new Error('This GIF frame control cannot be preserved.');
        disposal = (control >>> 2) & 7;
        delay = word();
        const index = byte();
        transparent = control & 1 ? index : undefined;
        if (byte() !== 0) invalid();
      } else if (label === 0xff) {
        const application = text(byte());
        const data = yield* blocks();
        if (application === 'ICCRGBG1012')
          throw new Error('This GIF color profile cannot be normalized. Choose another picture.');
        if (['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(application)) {
          if (data.length !== 3 || data[0] !== 1) invalid();
          repetitions = data[1] | (data[2] << 8);
          pictureAnimationTiming([], repetitions);
        }
      } else if (label === 0x01)
        throw new Error('GIF text frames cannot be preserved. Choose another picture.');
      else yield* blocks();
      continue;
    }
    if (marker !== 0x2c) invalid();
    const left = word();
    const top = word();
    const frameWidth = word();
    const frameHeight = word();
    const frameFlags = byte();
    if (
      !frameWidth ||
      !frameHeight ||
      left + frameWidth > width ||
      top + frameHeight > height ||
      frameFlags & 0x18
    )
      invalid();
    const palette = frameFlags & 128 ? take(3 * (1 << ((frameFlags & 7) + 1))) : global;
    if (!palette) invalid();
    if (!frameCount && transparent === undefined && background)
      yield* restoreBackground(0, 0, width, height, true);
    const minimum = byte();
    const compressed = yield* blocks();
    const indices = yield* lzw(compressed, minimum, frameWidth * frameHeight);
    let saved: Uint8ClampedArray | undefined;
    if (disposal === 3) {
      saved = new Uint8ClampedArray(canvas.length);
      for (let start = 0; start < canvas.length; start += 65536) {
        saved.set(canvas.subarray(start, start + 65536), start);
        yield { kind: 'progress' };
      }
    }
    const rows: number[] = [];
    if (frameFlags & 64) {
      for (const [start, step] of [
        [0, 8],
        [4, 8],
        [2, 4],
        [1, 2],
      ])
        for (let row = start; row < frameHeight; row += step) rows.push(row);
    }
    let work = 0;
    for (let row = 0; row < frameHeight; row++) {
      const y = frameFlags & 64 ? rows[row] : row;
      for (let x = 0; x < frameWidth; x++) {
        const index = indices[row * frameWidth + x];
        if (index !== transparent) {
          if (index * 3 + 2 >= palette.length) invalid();
          const target = ((top + y) * width + left + x) * 4;
          canvas[target] = palette[index * 3];
          canvas[target + 1] = palette[index * 3 + 1];
          canvas[target + 2] = palette[index * 3 + 2];
          canvas[target + 3] = 255;
        }
        if (++work === 16384) {
          work = 0;
          yield { kind: 'progress' };
        }
      }
    }
    frameCount++;
    yield {
      kind: 'frame',
      pixels: canvas,
      width,
      height,
      duration: pictureAnimationTiming([delay]).durations[0],
    };
    if (disposal === 2) {
      yield* restoreBackground(left, top, frameWidth, frameHeight, transparent === undefined);
    } else if (saved) {
      for (let start = 0; start < canvas.length; start += 65536) {
        canvas.set(saved.subarray(start, start + 65536), start);
        yield { kind: 'progress' };
      }
    }
    delay = 0;
    disposal = 0;
    transparent = undefined;
  }
}
