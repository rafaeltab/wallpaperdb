import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';

class ProfilePictureTooLargeError extends Error {}
class InvalidProfilePictureError extends Error {}

interface PictureLimits {
  maxBytes: number;
  maxPixels: number;
  maxDecodedBytes: number;
  policy: {
    output: { width: number; height: number; mimeType: 'image/webp'; colorSpace: 'srgb' };
    maxOutputBytes: number;
    acceptedSourceFormats: readonly string[];
    animation: { available: boolean };
    encoding: { staticQuality: number; animationQuality: number };
  };
}

interface ProcessedPicture {
  bytes: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

function animateWebp(
  frames: Buffer[],
  durations: number[],
  loop: number,
  width: number,
  height: number
): Buffer {
  function chunk(type: string, data: Buffer) {
    const result = Buffer.alloc(8 + data.length + (data.length % 2));
    result.write(type, 0, 4, 'ascii');
    result.writeUInt32LE(data.length, 4);
    data.copy(result, 8);
    return result;
  }
  let alpha = false;
  const animation = frames.map((frame, index) => {
    const images: Buffer[] = [];
    for (let offset = 12; offset + 8 <= frame.length; ) {
      const type = frame.toString('ascii', offset, offset + 4);
      const size = frame.readUInt32LE(offset + 4);
      const end = offset + 8 + size + (size % 2);
      if (['ALPH', 'VP8 ', 'VP8L'].includes(type)) images.push(frame.subarray(offset, end));
      if (type === 'ALPH' || (type === 'VP8L' && frame[offset + 12] & 0x10)) alpha = true;
      offset = end;
    }
    const control = Buffer.alloc(16);
    control.writeUIntLE(width - 1, 6, 3);
    control.writeUIntLE(height - 1, 9, 3);
    control.writeUIntLE(durations[index], 12, 3);
    control[15] = 2;
    return chunk('ANMF', Buffer.concat([control, ...images]));
  });
  const extended = Buffer.alloc(10);
  extended[0] = 2 | (alpha ? 0x10 : 0);
  extended.writeUIntLE(width - 1, 4, 3);
  extended.writeUIntLE(height - 1, 7, 3);
  const controls = Buffer.alloc(6);
  controls.writeUInt16LE(loop, 4);
  const body = Buffer.concat([chunk('VP8X', extended), chunk('ANIM', controls), ...animation]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0);
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, body]);
}

interface WebpStructure {
  animated: boolean;
  canonicalChunks: boolean;
  width?: number;
  height?: number;
  durations: number[];
}

/** Strict container admission precedes libvips, including every nested frame. */
function inspectWebp(input: Buffer, limits: PictureLimits): WebpStructure | undefined {
  if (input.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  function invalid(): never {
    throw new Error('Invalid WebP structure');
  }
  if (
    input.length < 12 ||
    input.toString('ascii', 8, 12) !== 'WEBP' ||
    input.readUInt32LE(4) + 8 !== input.length
  )
    invalid();
  function chunks(start: number, end: number) {
    const result: Array<{ type: string; data: Buffer }> = [];
    let offset = start;
    while (offset + 8 <= end) {
      const size = input.readUInt32LE(offset + 4);
      const next = offset + 8 + size + (size % 2);
      if (next > end || (size % 2 && input[next - 1] !== 0)) invalid();
      result.push({
        type: input.toString('ascii', offset, offset + 4),
        data: input.subarray(offset + 8, offset + 8 + size),
      });
      offset = next;
    }
    if (offset !== end) invalid();
    return result;
  }
  function imageDimensions(data: Buffer, type: string) {
    if (type === 'VP8L') {
      if (data.length < 5 || data[0] !== 0x2f || data[4] & 0xe0) invalid();
      const bits = data.readUInt32LE(1);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
        alpha: Boolean(bits & 0x10000000),
      };
    }
    if (data.length < 10 || data[0] & 1 || data.toString('hex', 3, 6) !== '9d012a') invalid();
    return {
      width: data.readUInt16LE(6) & 0x3fff,
      height: data.readUInt16LE(8) & 0x3fff,
      alpha: false,
    };
  }
  function image(parts: Array<{ type: string; data: Buffer }>) {
    if (parts.length === 2 && parts[0]?.type === 'ALPH' && parts[1]?.type === 'VP8 ') {
      const alpha = parts[0].data;
      if (alpha.length === 0 || alpha[0] & 0xc0 || (alpha[0] & 3) > 1 || ((alpha[0] >>> 4) & 3) > 1)
        invalid();
      return { ...imageDimensions(parts[1].data, 'VP8 '), alpha: true };
    }
    const part = parts[0];
    if (parts.length !== 1 || !part || !['VP8 ', 'VP8L'].includes(part.type)) return invalid();
    return imageDimensions(part.data, part.type);
  }
  const top = chunks(12, input.length);
  const header = top[0]?.type === 'VP8X' ? top[0].data : undefined;
  if (
    header &&
    (header.length !== 10 || header[0] & 0xc1 || header.subarray(1, 4).some((byte) => byte !== 0))
  )
    invalid();
  const width = header ? header.readUIntLE(4, 3) + 1 : undefined;
  const height = header ? header.readUIntLE(7, 3) + 1 : undefined;
  const animated = Boolean(header && header[0] & 2);
  let canonicalChunks = true;
  let seenAnimation = false;
  let seenFrame = false;
  let hasAlpha = false;
  const seen = new Set<string>();
  const still: Array<{ type: string; data: Buffer }> = [];
  const durations: number[] = [];
  for (const { type, data } of top) {
    if (type !== 'ANMF' && seen.has(type)) invalid();
    seen.add(type);
    if (type === 'VP8X') {
      if (data !== header) invalid();
      continue;
    }
    if (type === 'ANIM') {
      if (!animated || seenFrame || data.length !== 6) invalid();
      seenAnimation = true;
    } else if (type === 'ANMF') {
      if (!animated || !seenAnimation || data.length < 24 || data[15] & ~3 || !width || !height)
        invalid();
      seenFrame = true;
      const frameWidth = data.readUIntLE(6, 3) + 1;
      const frameHeight = data.readUIntLE(9, 3) + 1;
      const x = data.readUIntLE(0, 3) * 2;
      const y = data.readUIntLE(3, 3) * 2;
      if (x + frameWidth > width || y + frameHeight > height) invalid();
      if (frameWidth * frameHeight > limits.maxPixels)
        throw new Error('Picture exceeds the pixel limit');
      const start = data.byteOffset - input.byteOffset + 16;
      const frameParts = chunks(start, start + data.length - 16);
      const imageParts = frameParts.filter((part) => {
        if (['ALPH', 'VP8 ', 'VP8L'].includes(part.type)) return true;
        if (['VP8X', 'ICCP', 'ANIM', 'ANMF', 'EXIF', 'XMP '].includes(part.type)) invalid();
        canonicalChunks = false;
        return false;
      });
      const decoded = image(imageParts);
      if (decoded.width !== frameWidth || decoded.height !== frameHeight) invalid();
      hasAlpha ||= decoded.alpha;
      durations.push(data.readUIntLE(12, 3));
      if (durations.length * width * height * 4 > limits.maxDecodedBytes)
        throw new Error('Picture exceeds the decoded byte limit');
    } else if (['VP8 ', 'VP8L', 'ALPH'].includes(type)) {
      if (animated) invalid();
      still.push({ type, data });
    } else {
      canonicalChunks = false;
      if (type === 'ICCP' && (seenFrame || seenAnimation || still.length)) invalid();
    }
  }
  if (animated) {
    if (!seenAnimation || !durations.length || still.length) invalid();
  } else {
    const decoded = image(still);
    if (width && (decoded.width !== width || decoded.height !== height)) invalid();
    hasAlpha = decoded.alpha;
  }
  if (
    header &&
    (Boolean(header[0] & 0x10) !== hasAlpha ||
      Boolean(header[0] & 0x20) !== seen.has('ICCP') ||
      Boolean(header[0] & 8) !== seen.has('EXIF') ||
      Boolean(header[0] & 4) !== seen.has('XMP '))
  )
    invalid();
  return { animated, canonicalChunks, width, height, durations };
}

interface GifStructure {
  animated: boolean;
  loop: number;
  durations: number[];
}
function inspectGif(input: Buffer, limits: PictureLimits): GifStructure | undefined {
  if (!['GIF87a', 'GIF89a'].includes(input.toString('ascii', 0, 6))) return undefined;
  let offset = 6;
  function invalid(): never {
    throw new InvalidProfilePictureError('Picture GIF structure is invalid');
  }
  const take = (size: number) => {
    if (offset + size > input.length) invalid();
    const bytes = input.subarray(offset, offset + size);
    offset += size;
    return bytes;
  };
  const byte = () => take(1)[0];
  const word = () => take(2).readUInt16LE();
  const blocks = () => {
    const result: Buffer[] = [];
    for (let size = byte(); size; size = byte()) result.push(take(size));
    return Buffer.concat(result);
  };
  const width = word();
  const height = word();
  if (!width || !height || width * height > limits.maxPixels)
    throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
  const flags = byte();
  byte();
  byte();
  if (flags & 128) take(3 * (1 << ((flags & 7) + 1)));
  let repetitions: number | undefined;
  let delay = 0;
  const durations: number[] = [];
  for (;;) {
    const marker = byte();
    if (marker === 0x3b) {
      if (!durations.length || offset !== input.length) invalid();
      return {
        animated: durations.length > 1 || repetitions !== undefined,
        loop: repetitions === undefined ? 1 : repetitions === 0 ? 0 : repetitions + 1,
        durations,
      };
    }
    if (marker === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (byte() !== 4) invalid();
        const control = byte();
        if (control & 0xe2 || ((control >>> 2) & 7) > 3)
          throw new InvalidProfilePictureError('Picture GIF frame controls cannot be preserved');
        delay = word();
        byte();
        if (byte() !== 0) invalid();
      } else if (label === 0xff) {
        const application = take(byte()).toString('ascii');
        const data = blocks();
        if (['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(application)) {
          if (data.length !== 3 || data[0] !== 1) invalid();
          repetitions = data.readUInt16LE(1);
          if (repetitions === 65535)
            throw new InvalidProfilePictureError(
              'Picture GIF loop count cannot be preserved as WebP'
            );
        } else if (application === 'ICCRGBG1012')
          throw new InvalidProfilePictureError('Picture GIF color interpretation is unsupported');
      } else if (label === 1)
        throw new InvalidProfilePictureError('Picture GIF text frames cannot be preserved');
      else blocks();
    } else if (marker === 0x2c) {
      const x = word();
      const y = word();
      const frameWidth = word();
      const frameHeight = word();
      const frameFlags = byte();
      if (
        !frameWidth ||
        !frameHeight ||
        x + frameWidth > width ||
        y + frameHeight > height ||
        frameFlags & 0x18
      )
        invalid();
      if (frameFlags & 128) take(3 * (1 << ((frameFlags & 7) + 1)));
      const minimum = byte();
      if (minimum < 2 || minimum > 8) invalid();
      blocks();
      durations.push(delay <= 1 ? 100 : delay * 10);
      delay = 0;
      if (durations.length * width * height * 4 > limits.maxDecodedBytes)
        throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
    } else invalid();
  }
}

function hasJpegGainMapDeclaration(marker: number, payload: Buffer): boolean {
  if (marker === 0xe2) {
    const isoHeader = Buffer.from('urn:iso:std:iso:ts:21496:-1\0');
    return (
      payload.subarray(0, 4).equals(Buffer.from('MPF\0')) ||
      payload.subarray(0, isoHeader.length).equals(isoHeader)
    );
  }
  if (marker !== 0xe1) return false;
  const xmp = ['http://ns.adobe.com/xap/1.0/\0', 'http://ns.adobe.com/xmp/extension/\0'].some(
    (header) => payload.subarray(0, header.length).equals(Buffer.from(header))
  );
  if (!xmp) return false;
  return /xmlns(?::[\w.-]+)?\s*=\s*(['"])(?:http:\/\/ns\.adobe\.com\/hdr-gain-map\/1\.0\/|urn:com:apple:photo:2020:aux:hdrgainmap)\1/.test(
    payload.toString('utf8')
  );
}

function validateJpegSource(input: Buffer): void {
  if (!input.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return;
  let offset = 2;
  while (offset < input.length) {
    offset = input.indexOf(0xff, offset);
    if (offset === -1) break;
    offset++;
    while (input[offset] === 0xff) offset++;
    const marker = input[offset++];
    if (marker === 0xd9) {
      if (offset !== input.length)
        throw new InvalidProfilePictureError('Picture could not be decoded');
      return;
    }
    if (marker === 0 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd8 || offset + 2 > input.length)
      throw new InvalidProfilePictureError('Picture could not be decoded');
    const length = input.readUInt16BE(offset);
    if (length < 2 || length > input.length - offset)
      throw new InvalidProfilePictureError('Picture could not be decoded');
    // MPF and gain-map APP metadata can advertise HDR despite an SDR primary image.
    if (hasJpegGainMapDeclaration(marker, input.subarray(offset + 2, offset + length)))
      throw new InvalidProfilePictureError('Picture color interpretation is unsupported');
    offset += length;
  }
  throw new InvalidProfilePictureError('Picture could not be decoded');
}

function readPngChunk(input: Buffer, offset: number): { type: string; nextOffset: number } {
  const length = input.readUInt32BE(offset);
  if (length > input.length - offset - 12)
    throw new InvalidProfilePictureError('Picture could not be decoded');
  return {
    type: input.toString('ascii', offset + 4, offset + 8),
    nextOffset: offset + length + 12,
  };
}

function validatePngSource(input: Buffer): void {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return;
  for (let offset = 8; offset + 12 <= input.length; ) {
    const chunk = readPngChunk(input, offset);
    if (chunk.type === 'acTL')
      throw new InvalidProfilePictureError('Animated pictures are not accepted');
    // The native decoder does not expose cICP interpretation, including PQ/HLG.
    // Reject these sources rather than infer SDR from RGB16 sample metadata.
    if (chunk.type === 'cICP')
      throw new InvalidProfilePictureError('Picture color interpretation is unsupported');
    if (chunk.type === 'IEND') break;
    offset = chunk.nextOffset;
  }
}

function validateEncodedPicture(input: Buffer, limits: PictureLimits): void {
  if (input.length > limits.maxBytes)
    throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  if (!hasSupportedSignature(input))
    throw new InvalidProfilePictureError('Only JPEG, PNG, WebP, and GIF pictures are accepted');

  validateJpegSource(input);
  validatePngSource(input);
}

function hasSupportedSignature(input: Buffer): boolean {
  const signature = input.subarray(0, 8).toString('hex');
  if (signature.startsWith('ffd8ff')) return true;
  if (['GIF87a', 'GIF89a'].includes(input.toString('ascii', 0, 6))) return true;
  if (signature === '89504e470d0a1a0a') return true;
  return input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
}

function validateSourceFormat(metadata: Metadata): void {
  if (!['jpeg', 'png', 'webp', 'gif'].includes(metadata.format ?? ''))
    throw new InvalidProfilePictureError('Only JPEG, PNG, WebP, and GIF pictures are accepted');
}

function decodedByteCount(metadata: Metadata, pixels: number): number {
  const bytesPerSample =
    metadata.depth === 'double'
      ? 8
      : ['float', 'int', 'uint'].includes(metadata.depth ?? '')
        ? 4
        : ['ushort', 'short'].includes(metadata.depth ?? '')
          ? 2
          : 1;
  return pixels * (metadata.channels ?? 4) * bytesPerSample;
}

function validatePictureMetadata(metadata: Metadata, limits: PictureLimits): void {
  validateSourceFormat(metadata);
  if (!limits.policy.acceptedSourceFormats.includes(`image/${metadata.format}`))
    throw new InvalidProfilePictureError('Picture format is unavailable');
  if (
    !['srgb', 'rgb', 'rgb16', 'b-w', 'grey16', 'cmyk'].includes(metadata.space ?? '') ||
    ['float', 'double'].includes(metadata.depth ?? '')
  )
    throw new InvalidProfilePictureError('Picture color interpretation is unsupported');
  const pixels = Number(metadata.width) * Number(metadata.pageHeight ?? metadata.height);
  const totalPixels = pixels * (metadata.pages ?? 1);
  if (!(pixels > 0) || pixels > limits.maxPixels)
    throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
  const composedBytes =
    metadata.format === 'gif' || (metadata.pages ?? 1) > 1 ? totalPixels * 4 : 0;
  if (Math.max(decodedByteCount(metadata, totalPixels), composedBytes) > limits.maxDecodedBytes)
    throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
}

function isCanonical(input: Buffer, metadata: Metadata, limits: PictureLimits): boolean {
  const output = limits.policy.output;
  if (
    metadata.format !== 'webp' ||
    metadata.width !== output.width ||
    (metadata.pageHeight ?? metadata.height) !== output.height ||
    metadata.space !== 'srgb' ||
    metadata.depth !== 'uchar' ||
    metadata.orientation !== undefined ||
    metadata.exif ||
    metadata.xmp ||
    metadata.icc ||
    metadata.iptc
  )
    return false;
  const structure = inspectWebp(input, limits);
  return Boolean(
    structure?.canonicalChunks && structure.durations.every((duration) => duration > 10)
  );
}

async function processProfilePicture(
  input: Buffer,
  limits: PictureLimits
): Promise<ProcessedPicture> {
  validateEncodedPicture(input, limits);
  try {
    const structure = inspectWebp(input, limits);
    const gif = inspectGif(input, limits);
    const decoder = sharp(input, {
      // Sharp counts the frame stack; metadata validation bounds each frame separately.
      limitInputPixels: Math.max(limits.maxPixels, Math.floor(limits.maxDecodedBytes / 4)),
      failOn: 'warning',
      sequentialRead: true,
      animated: true,
    });
    const metadata = await decoder.metadata();
    validatePictureMetadata(metadata, limits);
    const animated = structure?.animated ?? gif?.animated ?? false;
    if (animated && !limits.policy.animation.available)
      throw new InvalidProfilePictureError('Animated pictures are not accepted');
    const durations = gif?.durations ?? metadata.delay;
    if (
      animated &&
      (!durations ||
        durations.length !== (metadata.pages ?? 1) ||
        durations.some(
          (duration) => !Number.isInteger(duration) || duration < 0 || duration > 0xffffff
        ))
    )
      throw new InvalidProfilePictureError('Picture frame timing is invalid');
    if (isCanonical(input, metadata, limits)) {
      await decoder.clone().raw().timeout({ seconds: 10 }).toBuffer();
      if (input.length > limits.policy.maxOutputBytes)
        throw new ProfilePictureTooLargeError('Picture exceeds the processed output byte limit');
      return {
        bytes: input,
        mimeType: 'image/webp',
        width: limits.policy.output.width,
        height: limits.policy.output.height,
      };
    }
    let output: Buffer;
    if (animated) {
      if (metadata.orientation !== undefined)
        throw new InvalidProfilePictureError(
          'Animated picture orientation cannot be normalized. Process the source in the editor.'
        );
      if (
        !Number.isInteger(metadata.loop ?? 1) ||
        (metadata.loop ?? 1) < 0 ||
        (metadata.loop ?? 1) > 65535
      )
        throw new InvalidProfilePictureError('Picture animation controls cannot be preserved');
      const width = Number(metadata.width);
      const height = Number(metadata.pageHeight ?? metadata.height);
      const pages = metadata.pages ?? 1;
      const target = limits.policy.output;
      if (target.width * target.height * pages * 4 > limits.maxDecodedBytes)
        throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
      const decoded = await decoder
        .clone()
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .timeout({ seconds: 10 })
        .toBuffer();
      const frames: Buffer[] = [];
      // libvips resizes a vertical page stack across frame edges. Isolate each composed frame.
      for (let page = 0; page < pages; page++) {
        const start = page * width * height * 4;
        frames.push(
          await sharp(decoded.subarray(start, start + width * height * 4), {
            raw: { width, height, channels: 4 },
          })
            .resize(target.width, target.height, { fit: 'cover' })
            .webp({ quality: limits.policy.encoding.animationQuality })
            .timeout({ seconds: 10 })
            .toBuffer()
        );
      }
      output = animateWebp(
        frames,
        durations?.map((duration) => (duration <= 10 ? 100 : duration)) ?? [],
        gif?.loop ?? metadata.loop ?? 1,
        target.width,
        target.height
      );
    } else {
      output = await decoder
        .rotate()
        .resize(limits.policy.output.width, limits.policy.output.height, { fit: 'cover' })
        .toColourspace('srgb')
        .webp({ quality: limits.policy.encoding.staticQuality })
        .timeout({ seconds: 10 })
        .toBuffer();
    }
    if (output.length > limits.policy.maxOutputBytes)
      throw new ProfilePictureTooLargeError('Picture exceeds the processed output byte limit');
    const normalized = inspectWebp(output, limits);
    if (animated && !normalized?.animated)
      throw new InvalidProfilePictureError(
        'This animation cannot be preserved by the picture encoder'
      );
    return {
      bytes: output,
      mimeType: 'image/webp',
      width: limits.policy.output.width,
      height: limits.policy.output.height,
    };
  } catch (error) {
    if (error instanceof InvalidProfilePictureError || error instanceof ProfilePictureTooLargeError)
      throw error;
    if (error instanceof Error && /pixel limit|decoded byte limit/i.test(error.message)) {
      throw new InvalidProfilePictureError(
        /decoded byte/.test(error.message)
          ? 'Picture exceeds the decoded byte limit'
          : 'Picture exceeds the pixel limit'
      );
    }
    throw new InvalidProfilePictureError('Picture could not be decoded', { cause: error });
  }
}

// The child owns libvips and receives only bounded bytes and validated limits.
const limitsSchema = z.object({
  maxBytes: z.number().int().positive(),
  maxPixels: z.number().int().positive(),
  maxDecodedBytes: z.number().int().positive(),
  policy: z.object({
    output: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      mimeType: z.literal('image/webp'),
      colorSpace: z.literal('srgb'),
    }),
    maxOutputBytes: z.number().int().positive(),
    acceptedSourceFormats: z.array(z.string()),
    animation: z.object({ available: z.boolean() }),
    encoding: z.object({
      staticQuality: z.number().int().min(1).max(100),
      animationQuality: z.number().int().min(1).max(100),
    }),
  }),
});
try {
  const limits = limitsSchema.parse(JSON.parse(process.argv[2] ?? 'null'));
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > limits.maxBytes)
      throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
    chunks.push(chunk);
  }
  const picture = await processProfilePicture(Buffer.concat(chunks), limits);
  process.stdout.write(
    JSON.stringify({
      _tag: 'Processed',
      picture: { ...picture, bytes: picture.bytes.toString('base64') },
    })
  );
} catch (cause) {
  if (cause instanceof InvalidProfilePictureError || cause instanceof ProfilePictureTooLargeError) {
    process.stdout.write(
      JSON.stringify({
        _tag: 'Rejected',
        reason:
          cause instanceof ProfilePictureTooLargeError ? 'picture-too-large' : 'invalid-picture',
        message: cause.message,
      })
    );
  } else {
    process.stderr.write('Picture encoder failed');
    process.exitCode = 1;
  }
}
