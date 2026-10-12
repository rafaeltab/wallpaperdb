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
    encoding: { staticQuality: number };
  };
}

interface ProcessedPicture {
  bytes: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
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

function validateWebpContainer(input: Buffer): void {
  if (input.toString('ascii', 0, 4) !== 'RIFF') return;
  if (input.length < 12 || input.readUInt32LE(4) + 8 !== input.length)
    throw new InvalidProfilePictureError('Picture could not be decoded');
  let offset = 12;
  let imageChunks = 0;
  let features: number | undefined;
  let imageHasAlpha = false;
  const chunks = new Set<string>();
  while (offset + 8 <= input.length) {
    const type = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    if (size > input.length - offset - 8)
      throw new InvalidProfilePictureError('Picture could not be decoded');
    if (type === 'VP8X') {
      if (
        size !== 10 ||
        (input[offset + 8] & 0xc1) !== 0 ||
        !input.subarray(offset + 9, offset + 12).equals(Buffer.alloc(3))
      )
        throw new InvalidProfilePictureError('Picture could not be decoded');
      features = input[offset + 8];
    }
    if (type === 'ALPH' && (imageChunks > 0 || !((features ?? 0) & 0x10)))
      throw new InvalidProfilePictureError('Picture could not be decoded');
    if (type === 'ICCP' && (imageChunks > 0 || chunks.has('ALPH')))
      throw new InvalidProfilePictureError('Picture could not be decoded');
    if (type === 'VP8L') {
      if (chunks.has('ALPH') || size < 5)
        throw new InvalidProfilePictureError('Picture could not be decoded');
      imageHasAlpha = Boolean(input[offset + 12] & 0x10);
    }
    if (['VP8 ', 'VP8L'].includes(type)) imageChunks++;
    if (
      imageChunks > 1 ||
      (['VP8X', 'ALPH'].includes(type) && chunks.has(type)) ||
      (type === 'VP8X' && offset !== 12)
    )
      throw new InvalidProfilePictureError('Picture could not be decoded');
    chunks.add(type);
    if (size % 2 && input[offset + 8 + size] !== 0)
      throw new InvalidProfilePictureError('Picture could not be decoded');
    offset += 8 + size + (size % 2);
  }
  if (offset !== input.length) throw new InvalidProfilePictureError('Picture could not be decoded');
  if (features !== undefined) {
    if (imageChunks === 1 && Boolean(features & 0x10) !== (chunks.has('ALPH') || imageHasAlpha))
      throw new InvalidProfilePictureError('Picture could not be decoded');
    for (const [type, flag] of [
      ['ICCP', 0x20],
      ['EXIF', 0x08],
      ['XMP ', 0x04],
    ] as const)
      if (Boolean(features & flag) !== chunks.has(type))
        throw new InvalidProfilePictureError('Picture could not be decoded');
  }
}

function validateEncodedPicture(input: Buffer, limits: PictureLimits): void {
  if (input.length > limits.maxBytes)
    throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  if (!hasSupportedSignature(input))
    throw new InvalidProfilePictureError('Only JPEG, PNG, and WebP pictures are accepted');
  validateJpegSource(input);
  validateWebpContainer(input);
  validatePngSource(input);
}

function hasSupportedSignature(input: Buffer): boolean {
  const signature = input.subarray(0, 8).toString('hex');
  if (signature.startsWith('ffd8ff')) return true;
  if (signature === '89504e470d0a1a0a') return true;
  return input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP';
}

function hasAnimation(metadata: Metadata): boolean {
  return (metadata.pages ?? 1) > 1 || metadata.loop !== undefined || metadata.delay !== undefined;
}

function validateStillFormat(metadata: Metadata): void {
  if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
    throw new InvalidProfilePictureError('Only JPEG, PNG, and WebP pictures are accepted');
  if (hasAnimation(metadata))
    throw new InvalidProfilePictureError('Animated pictures are not accepted');
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
  validateStillFormat(metadata);
  if (!limits.policy.acceptedSourceFormats.includes(`image/${metadata.format}`))
    throw new InvalidProfilePictureError('Picture format is unavailable');
  if (
    !['srgb', 'rgb', 'rgb16', 'b-w', 'grey16', 'cmyk'].includes(metadata.space ?? '') ||
    ['float', 'double'].includes(metadata.depth ?? '')
  )
    throw new InvalidProfilePictureError('Picture color interpretation is unsupported');
  const pixels = Number(metadata.width) * Number(metadata.height);
  if (!(pixels > 0) || pixels > limits.maxPixels)
    throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
  if (decodedByteCount(metadata, pixels) > limits.maxDecodedBytes)
    throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
}

function isCanonical(input: Buffer, metadata: Metadata, limits: PictureLimits): boolean {
  const output = limits.policy.output;
  if (
    metadata.format !== 'webp' ||
    metadata.width !== output.width ||
    metadata.height !== output.height ||
    metadata.space !== 'srgb' ||
    metadata.depth !== 'uchar' ||
    metadata.orientation !== undefined ||
    metadata.exif ||
    metadata.xmp ||
    metadata.icc ||
    metadata.iptc
  )
    return false;
  if (input.length < 12 || input.readUInt32LE(4) + 8 !== input.length) return false;
  let offset = 12;
  while (offset + 8 <= input.length) {
    const type = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    if (!['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(type) || size > input.length - offset - 8)
      return false;
    if (
      type === 'VP8X' &&
      (size !== 10 ||
        (input[offset + 8] & ~0x10) !== 0 ||
        !input.subarray(offset + 9, offset + 12).equals(Buffer.alloc(3)))
    )
      return false;
    offset += 8 + size + (size % 2);
  }
  return offset === input.length;
}

async function processProfilePicture(
  input: Buffer,
  limits: PictureLimits
): Promise<ProcessedPicture> {
  validateEncodedPicture(input, limits);
  try {
    const decoder = sharp(input, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    validatePictureMetadata(metadata, limits);
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
    const result = await decoder
      .rotate()
      .resize(limits.policy.output.width, limits.policy.output.height, { fit: 'cover' })
      .toColourspace('srgb')
      .webp({ quality: limits.policy.encoding.staticQuality })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > limits.policy.maxOutputBytes)
      throw new ProfilePictureTooLargeError('Picture exceeds the processed output byte limit');
    return {
      bytes: result.data,
      mimeType: 'image/webp',
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof InvalidProfilePictureError || error instanceof ProfilePictureTooLargeError)
      throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
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
    encoding: z.object({ staticQuality: z.number().int().min(1).max(100) }),
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
