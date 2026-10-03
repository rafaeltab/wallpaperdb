import { describe, expect, it } from 'vitest';
import { createUploadQueue, MAX_FILES_PER_BATCH, type UploadResult } from '@/features/upload-queue';

const response = {
  wallpaperId: 'wallpaper-1',
  userId: 'user-1',
  uploadState: 'processing',
  fileType: 'image',
  mimeType: 'image/jpeg',
  fileSizeBytes: 100,
  width: 10,
  height: 10,
  aspectRatio: 1,
  uploadedAt: '2026-10-03T00:00:00Z',
};
const success: UploadResult = { success: true, isDuplicate: false, response };

function setup() {
  let now = 0;
  const timers = new Set<{ at: number; callback: () => void }>();
  const clock = {
    now: () => now,
    schedule(delay: number, callback: () => void) {
      const timer = { at: now + delay, callback };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
  };
  function advance(ms: number) {
    now += ms;
    for (const timer of [...timers]) {
      if (timer.at <= now && timers.delete(timer)) timer.callback();
    }
  }
  const uploads: {
    file: string;
    resolve: (result: UploadResult) => void;
    reject: (error: unknown) => void;
    cancelled: boolean;
  }[] = [];
  const queue = createUploadQueue<string>({
    upload(file) {
      let resolve!: (result: UploadResult) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<UploadResult>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const request = { file, resolve, reject, cancelled: false };
      uploads.push(request);
      return {
        result,
        cancel: () => {
          request.cancelled = true;
        },
      };
    },
    clock,
  });
  const deactivate = queue.activate();
  return { queue, uploads, advance, timers, deactivate };
}

async function complete(request: ReturnType<typeof setup>['uploads'][number], result = success) {
  request.resolve(result);
  await Promise.resolve();
}

const rateLimited: UploadResult = {
  success: false,
  isDuplicate: false,
  error: { type: 'rate_limit', message: 'Slow down', retryAfter: 5 },
};
const failed: UploadResult = {
  success: false,
  isDuplicate: false,
  error: { type: 'validation', message: 'Invalid image' },
};

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

describe('upload queue controls', () => {
  it('limits the batch including existing files and assigns unique ids', () => {
    const { queue } = setup();
    queue.addFiles(['first']);
    queue.addFiles(Array.from({ length: MAX_FILES_PER_BATCH + 1 }, (_, i) => String(i)));
    const { state } = queue.getSnapshot();
    expect(state.files).toHaveLength(MAX_FILES_PER_BATCH);
    expect(new Set(state.files.map((file) => file.id)).size).toBe(MAX_FILES_PER_BATCH);
  });

  it('records duplicates and errors, continues, and manually retries failures', async () => {
    const { queue, uploads } = setup();
    queue.addFiles(['a', 'b', 'c']);
    await complete(uploads[0], { ...success, isDuplicate: true });
    await complete(uploads[1], failed);
    await complete(uploads[2]);
    expect(queue.getSnapshot().counts).toMatchObject({ duplicate: 1, failed: 1, success: 1 });
    queue.clearCompleted();
    expect(queue.getSnapshot().state.files.map((file) => file.file)).toEqual(['b']);
    queue.retryFailed();
    expect(uploads[3].file).toBe('b');
    expect(queue.getSnapshot().state.files[0].error).toBeUndefined();
    await complete(uploads[3]);
    expect(queue.getSnapshot().counts.success).toBe(1);
  });

  it.each([
    new Error('Offline'),
    'not an Error',
  ])('handles a rejected upload and keeps processing', async (error) => {
    const { queue, uploads } = setup();
    queue.addFiles(['a', 'b']);
    uploads[0].reject(error);
    await Promise.resolve();
    expect(queue.getSnapshot().state.files[0].error).toEqual({
      type: 'network',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    expect(uploads[1].file).toBe('b');
  });

  it('treats a malformed result as a failure rather than leaving the queue stuck', async () => {
    const { queue, uploads } = setup();
    queue.addFiles(['a', 'b']);
    await complete(uploads[0], { success: true, isDuplicate: false });
    expect(queue.getSnapshot().counts.failed).toBe(1);
    expect(uploads[1].file).toBe('b');
  });

  it('allows the current upload to finish while stopped, then resumes remaining files', async () => {
    const { queue, uploads } = setup();
    queue.addFiles(['a', 'b']);
    queue.stopQueue();
    expect(uploads[0].cancelled).toBe(false);
    await complete(uploads[0]);
    expect(uploads).toHaveLength(1);
    expect(queue.getSnapshot().state.isStopped).toBe(true);
    queue.resumeQueue();
    expect(uploads[1].file).toBe('b');
  });

  it.each([
    success,
    failed,
    { ...success, isDuplicate: true },
  ])('clears a stopped queue when its last upload settles', async (result) => {
    const { queue, uploads } = setup();
    queue.addFiles(['a']);
    queue.stopQueue();
    await complete(uploads[0], result);
    expect(queue.getSnapshot().state).toMatchObject({
      files: [],
      isStopped: false,
      isProcessing: false,
    });
  });

  it('waits for the rate limit and automatically retries only that file', async () => {
    const { queue, uploads, advance } = setup();
    queue.addFiles(['invalid', 'limited', 'next']);
    await complete(uploads[0], failed);
    await complete(uploads[1], rateLimited);
    expect(queue.getSnapshot().state).toMatchObject({
      isPaused: true,
      pausedUntil: 5000,
      isProcessing: false,
    });
    queue.resumeQueue();
    queue.retryFailed();
    advance(4999);
    expect(uploads).toHaveLength(2);
    advance(1);
    // The explicit retry includes the invalid file, but never bypasses the cooldown.
    expect(uploads[2].file).toBe('invalid');
    await complete(uploads[2], failed);
    expect(uploads[3].file).toBe('limited');
  });

  it('leaves unrelated failures alone on automatic resume', async () => {
    const { queue, uploads, advance } = setup();
    queue.addFiles(['invalid', 'limited']);
    await complete(uploads[0], failed);
    await complete(uploads[1], rateLimited);
    advance(5000);
    expect(uploads[2].file).toBe('limited');
    expect(queue.getSnapshot().state.files[0].status).toBe('failed');
    await complete(uploads[2]);
    expect(queue.getSnapshot().progress).toBe(100);
  });

  it('does not auto-resume when stopped, and preserves the deadline on manual resume', async () => {
    const { queue, uploads, advance, timers } = setup();
    queue.addFiles(['a', 'b']);
    await complete(uploads[0], rateLimited);
    queue.stopQueue();
    expect(timers.size).toBe(0);
    advance(2000);
    queue.resumeQueue();
    queue.resumeQueue();
    expect(timers.size).toBe(1);
    advance(2999);
    expect(uploads).toHaveLength(1);
    advance(1);
    expect(uploads[1].file).toBe('a');
  });

  it('resumes immediately after a stopped cooldown has expired', async () => {
    const { queue, uploads, advance } = setup();
    queue.addFiles(['a', 'b']);
    await complete(uploads[0], rateLimited);
    queue.stopQueue();
    advance(5000);
    expect(uploads).toHaveLength(1);
    queue.resumeQueue();
    expect(uploads[1].file).toBe('a');
  });

  it('keeps a stop issued during an upload even if the response is rate limited', async () => {
    const { queue, uploads, timers, advance } = setup();
    queue.addFiles(['a', 'b']);
    queue.stopQueue();
    await complete(uploads[0], rateLimited);
    expect(queue.getSnapshot().state).toMatchObject({
      isStopped: true,
      isPaused: false,
      pausedUntil: 5000,
    });
    expect(timers.size).toBe(0);
    advance(5000);
    expect(uploads).toHaveLength(1);
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    undefined,
  ])('uses a bounded default cooldown for invalid retry-after %s', async (retryAfter) => {
    const { queue, uploads, advance } = setup();
    queue.addFiles(['a']);
    await complete(uploads[0], {
      ...rateLimited,
      error: { type: 'rate_limit', message: 'Wait', retryAfter },
    });
    expect(queue.getSnapshot().state.pausedUntil).toBe(60000);
    advance(59999);
    expect(uploads).toHaveLength(1);
    advance(1);
    expect(uploads).toHaveLength(2);
  });

  it.each([
    success,
    rateLimited,
    failed,
  ])('cancels and ignores an old response after a new batch is added', async (result) => {
    const { queue, uploads, timers } = setup();
    queue.addFiles(['old']);
    queue.cancelAll();
    expect(uploads[0].cancelled).toBe(true);
    queue.addFiles(['new']);
    const before = queue.getSnapshot();
    await complete(uploads[0], result);
    expect(queue.getSnapshot()).toBe(before);
    expect(timers.size).toBe(0);
    await complete(uploads[1]);
    expect(queue.getSnapshot().state.files[0].file).toBe('new');
    expect(queue.getSnapshot().counts.success).toBe(1);
  });

  it('cancels scheduled retries when cleared', async () => {
    const { queue, uploads, advance, timers } = setup();
    queue.addFiles(['a']);
    await complete(uploads[0], rateLimited);
    queue.cancelAll();
    expect(timers.size).toBe(0);
    advance(5000);
    expect(queue.getSnapshot().counts.total).toBe(0);
    expect(uploads).toHaveLength(1);
  });

  it('deactivates without losing files and can reactivate after React effect cleanup', async () => {
    const { queue, uploads, deactivate } = setup();
    queue.addFiles(['a', 'b']);
    deactivate();
    expect(uploads[0].cancelled).toBe(true);
    expect(queue.getSnapshot().counts).toMatchObject({ uploading: 0, pending: 2 });
    await complete(uploads[0], rateLimited);
    queue.activate();
    expect(uploads[1].file).toBe('a');
    await complete(uploads[1]);
    expect(uploads[2].file).toBe('b');
  });

  it('cancels cooldown timers on deactivation and restores the remaining delay', async () => {
    const { queue, uploads, advance, timers, deactivate } = setup();
    queue.addFiles(['a']);
    await complete(uploads[0], rateLimited);
    deactivate();
    expect(timers.size).toBe(0);
    advance(2000);
    queue.activate();
    advance(2999);
    expect(uploads).toHaveLength(1);
    advance(1);
    expect(uploads[1].file).toBe('a');
  });

  it('notifies subscribers with stable snapshots and supports unsubscribe', () => {
    const { queue } = setup();
    const observations: number[] = [];
    const unsubscribe = queue.subscribe(() => {
      observations.push(queue.getSnapshot().counts.total);
    });
    expect(queue.getSnapshot()).toBe(queue.getSnapshot());
    queue.addFiles(['a']);
    expect(observations.at(-1)).toBe(1);
    unsubscribe();
    const count = observations.length;
    queue.addFiles(['b']);
    expect(observations).toHaveLength(count);
  });
});
