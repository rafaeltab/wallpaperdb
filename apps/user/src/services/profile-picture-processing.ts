import sharp from 'sharp';

export class ProfilePictureTooLargeError extends Error {}
export class InvalidProfilePictureError extends Error {}

export interface PictureLimits {
  maxBytes: number;
  maxPixels: number;
  maxDecodedBytes: number;
}

export interface ProcessedPicture {
  bytes: Buffer;
  mimeType: 'image/webp';
  width: number;
  height: number;
}

function hasPngAnimation(input: Buffer): boolean {
  if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= input.length; ) {
    const length = input.readUInt32BE(offset);
    if (length > input.length - offset - 12)
      throw new InvalidProfilePictureError('Picture could not be decoded');
    const type = input.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IEND') break;
    offset += length + 12;
  }
  return false;
}

export async function processProfilePicture(
  input: Buffer,
  limits: PictureLimits
): Promise<ProcessedPicture> {
  if (input.length > limits.maxBytes)
    throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  const supported =
    (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) ||
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP');
  if (!supported)
    throw new InvalidProfilePictureError('Only JPEG, PNG, and WebP pictures are accepted');
  if (hasPngAnimation(input))
    throw new InvalidProfilePictureError('Animated pictures are not accepted');
  try {
    const decoder = sharp(input, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      sequentialRead: true,
    });
    const metadata = await decoder.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
      throw new InvalidProfilePictureError('Only JPEG, PNG, and WebP pictures are accepted');
    }
    if ((metadata.pages ?? 1) > 1 || metadata.loop !== undefined || metadata.delay !== undefined) {
      throw new InvalidProfilePictureError('Animated pictures are not accepted');
    }
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
    if (!pixels || pixels > limits.maxPixels)
      throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
    const bytesPerSample = metadata.depth === 'ushort' || metadata.depth === 'short' ? 2 : 1;
    if (pixels * (metadata.channels ?? 4) * bytesPerSample > limits.maxDecodedBytes) {
      throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
    }
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
