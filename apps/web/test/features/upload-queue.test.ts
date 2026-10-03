import { describe, expect, it } from 'vitest';
import { createUploadQueue, type UploadResult } from '@/features/upload-queue';

const response = {
  wallpaperId: 'wallpaper-1', userId: 'user-1', uploadState: 'processing',
  fileType: 'image', mimeType: 'image/jpeg', fileSizeBytes: 100,
  width: 10, height: 10, aspectRatio: 1, uploadedAt: '2026-10-03T00:00:00Z',
};
const success: UploadResult = { success: true, isDuplicate: false, response };

function setup() {
  const uploads: { file: string; resolve: (result: UploadResult) => void; cancelled: boolean }[] = [];
  const queue = createUploadQueue<string>({
    upload(file) {
      let resolve!: (result: UploadResult) => void;
      const result = new Promise<UploadResult>((done) => { resolve = done; });
      const request = { file, resolve, cancelled: false };
      uploads.push(request);
      return { result, cancel: () => { request.cancelled = true; } };
    },
    clock: { now: () => 0, schedule: () => () => {} },
  });
  queue.activate();
  return { queue, uploads };
}

async function complete(request: ReturnType<typeof setup>['uploads'][number], result = success) {
  request.resolve(result);
  await Promise.resolve();
}

describe('upload queue workflow', () => {
  it('uploads in selection order with one active request and reports completion', async () => {
    const { queue, uploads } = setup();
    queue.addFiles(['a.jpg', 'b.jpg']);
    expect(uploads.map((request) => request.file)).toEqual(['a.jpg']);
    expect(queue.getSnapshot().counts).toMatchObject({ uploading: 1, pending: 1 });
    await complete(uploads[0]);
    expect(uploads.map((request) => request.file)).toEqual(['a.jpg', 'b.jpg']);
    expect(queue.getSnapshot().progress).toBe(50);
    await complete(uploads[1]);
    expect(queue.getSnapshot().counts.success).toBe(2);
    expect(queue.getSnapshot().progress).toBe(100);
    expect(queue.getSnapshot().state.isProcessing).toBe(false);
  });
});
