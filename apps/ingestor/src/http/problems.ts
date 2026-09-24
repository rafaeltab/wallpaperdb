import type { FastifyReply } from 'fastify';
import type { UploadOutcome } from '../ingestion/index.js';
export function problem(status: number, type: string, title: string, detail?: string) {
  return {
    type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${type}.md`,
    title,
    status,
    ...(detail ? { detail } : {}),
  };
}
export function sendProblem(
  reply: FastifyReply,
  status: number,
  type: string,
  title: string,
  extra: Record<string, unknown> = {}
) {
  return reply
    .code(status)
    .type('application/problem+json')
    .send({ ...problem(status, type, title), ...extra });
}
export function sendUpload(reply: FastifyReply, result: UploadOutcome) {
  switch (result._tag) {
    case 'Accepted':
      return reply.send({ ...result.upload, status: 'processing' });
    case 'Duplicate':
      return reply.send({ ...result.upload, status: 'already_uploaded' });
    case 'InProgress':
      return sendProblem(reply, 409, 'upload-in-progress', 'Upload in progress');
    case 'Unauthorized':
      return sendProblem(reply, 401, 'unauthorized', 'Unauthorized');
    case 'InvalidFormat':
      return sendProblem(reply, 400, 'invalid-file-format', 'Invalid File Format', {
        receivedMimeType: result.mimeType,
        detail: 'Only JPEG, PNG, and WebP images are supported.',
      });
    case 'TooLarge':
      return sendProblem(reply, 413, 'file-too-large', 'File Too Large', {
        fileSizeBytes: result.fileSizeBytes,
        maxFileSizeBytes: result.maxFileSizeBytes,
        fileType: result.fileType,
        detail: `File size exceeds the ${result.maxFileSizeBytes / (1024 * 1024)} MiB limit for ${result.fileType}s.`,
      });
    case 'InvalidDimensions': {
      const { _tag, ...dimensions } = result;
      return sendProblem(reply, 400, 'dimensions-out-of-bounds', 'Dimensions Out of Bounds', {
        ...dimensions,
        detail: `Image dimensions must be between ${result.minWidth}x${result.minHeight} and ${result.maxWidth}x${result.maxHeight} pixels.`,
      });
    }
  }
}
