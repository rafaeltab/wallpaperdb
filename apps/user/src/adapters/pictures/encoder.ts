import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';

class ProfilePictureTooLargeError extends Error {}
class InvalidProfilePictureError extends Error {}

interface PictureLimits {
  maxBytes: number;
  maxPixels: number;
  maxDecodedBytes: number;
}

interface ProcessedPicture {
  bytes: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
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

function hasPngAnimation(input: Buffer): boolean {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= input.length; ) {
    const chunk = readPngChunk(input, offset);
    if (chunk.type === 'acTL') return true;
    if (chunk.type === 'IEND') break;
    offset = chunk.nextOffset;
  }
  return false;
}

function validateEncodedPicture(input: Buffer, limits: PictureLimits): void {
  if (input.length > limits.maxBytes)
    throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  if (!hasSupportedSignature(input))
    throw new InvalidProfilePictureError('Only JPEG, PNG, and WebP pictures are accepted');
  if (hasPngAnimation(input))
    throw new InvalidProfilePictureError('Animated pictures are not accepted');
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
  const bytesPerSample = ['ushort', 'short'].includes(metadata.depth ?? '') ? 2 : 1;
  return pixels * (metadata.channels ?? 4) * bytesPerSample;
}

function validatePictureMetadata(metadata: Metadata, limits: PictureLimits): void {
  validateStillFormat(metadata);
  const pixels = Number(metadata.width) * Number(metadata.height);
  if (!(pixels > 0) || pixels > limits.maxPixels)
    throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
  if (decodedByteCount(metadata, pixels) > limits.maxDecodedBytes)
    throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
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
    const result = await decoder
      .rotate()
      .webp({ quality: 85 })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true });
    return {
      bytes: result.data,
      mimeType: 'image/webp',
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof InvalidProfilePictureError) throw error;
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
