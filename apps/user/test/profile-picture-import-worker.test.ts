import { FakeTimerService } from '@wallpaperdb/core/timer';
import { describe, expect, it, vi } from 'vitest';
import { ProfilePictureImportWorker } from '../src/services/profile-picture-import-worker.js';

describe('Profile picture import worker', () => {
  it('imports immediately and every second until stopped', async () => {
    const timer = new FakeTimerService();
    const run = vi.fn<() => Promise<void>>().mockResolvedValue();
    const worker = new ProfilePictureImportWorker(run, { error: vi.fn() }, timer);
    worker.start();
    expect(run).toHaveBeenCalledOnce();
    await worker.importPending();
    await timer.tickAsync(999);
    expect(run).toHaveBeenCalledOnce();
    await timer.tickAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await worker.stop();
    await timer.tickAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares one active pass across repeated starts, timer ticks, and direct imports', async () => {
    const timer = new FakeTimerService();
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn<() => Promise<void>>().mockReturnValueOnce(active).mockResolvedValue();
    const worker = new ProfilePictureImportWorker(run, { error: vi.fn() }, timer);
    worker.start();
    worker.start();
    const direct = worker.importPending();
    const tick = timer.tickAsync(1000);
    try {
      expect(run).toHaveBeenCalledOnce();
    } finally {
      release();
      await Promise.all([direct, tick]);
      await worker.stop();
    }
  });

  it('waits for the active import during shutdown and does not start another pass', async () => {
    const timer = new FakeTimerService();
    let release!: () => void;
    const active = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn<() => Promise<void>>().mockReturnValueOnce(active).mockResolvedValue();
    const worker = new ProfilePictureImportWorker(run, { error: vi.fn() }, timer);
    worker.start();
    let stopped = false;
    const shutdown = worker.stop().then(() => { stopped = true; });
    await timer.tickAsync(1000);
    try {
      expect(stopped).toBe(false);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      release();
      await shutdown;
    }
    expect(stopped).toBe(true);
    await worker.importPending();
    await timer.tickAsync(1000);
    expect(run).toHaveBeenCalledOnce();
  });

  it('reports a failed cycle without private error details and lets shutdown finish', async () => {
    const timer = new FakeTimerService();
    const failure = new Error('https://img.clerk.com/private?token=secret', { cause: { url: 'private-source' } });
    const run = vi.fn<() => Promise<void>>().mockRejectedValue(failure);
    const logger = { error: vi.fn() };
    const worker = new ProfilePictureImportWorker(run, logger, timer);
    worker.start();
    await expect(worker.stop()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith({ category: 'profile-picture-import' }, 'Profile picture import cycle failed');
    await timer.tickAsync(1000);
    expect(run).toHaveBeenCalledOnce();
  });
});
