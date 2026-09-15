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
});
