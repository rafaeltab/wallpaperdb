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

export async function processProfilePicture(
  input: Buffer,
  limits: PictureLimits
): Promise<ProcessedPicture> {
  if (input.length > limits.maxBytes) throw new ProfilePictureTooLargeError('Picture exceeds the upload byte limit');
  const decoder = sharp(input, { limitInputPixels: limits.maxPixels, failOn: 'warning', sequentialRead: true });
  const metadata = await decoder.metadata();
  const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
  if (!pixels || pixels > limits.maxPixels) throw new InvalidProfilePictureError('Picture exceeds the pixel limit');
  const bytesPerSample = metadata.depth === 'ushort' || metadata.depth === 'short' ? 2 : 1;
  if (pixels * (metadata.channels ?? 4) * bytesPerSample > limits.maxDecodedBytes) {
    throw new InvalidProfilePictureError('Picture exceeds the decoded byte limit');
  }
  const result = await decoder.rotate().webp({ quality: 85 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  return {
    bytes: result.data,
    mimeType: 'image/webp',
    width: result.info.width,
    height: result.info.height,
  };
}
