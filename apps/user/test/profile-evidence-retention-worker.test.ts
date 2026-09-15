import { FakeTimerService } from '@wallpaperdb/core/timer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileEvidenceRetentionWorker } from '../src/services/profile-evidence-retention-worker.js';

describe('Profile evidence retention worker', () => {
  afterEach(() => vi.useRealTimers());

  it('runs both cleanup batches on startup and each timer tick with observable results', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
    const timer = new FakeTimerService();
    const events = vi.fn(async () => ({ deleted: 2, failed: 1 }));
    const pictures = vi.fn(async () => ({ deleted: 3, failed: 0 }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new ProfileEvidenceRetentionWorker(events, pictures, logger, timer);
    worker.start();
    await worker.cleanupPending();
    expect(events).toHaveBeenCalledWith(new Date('2030-01-31T00:00:00.000Z'), expect.any(Function));
    expect(pictures).toHaveBeenCalledWith(new Date('2030-01-31T00:00:00.000Z'), expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith({ eventsDeleted: 2, picturesDeleted: 3, failed: 1 }, 'Profile evidence cleanup completed');
    vi.setSystemTime(new Date('2030-01-31T00:00:01.000Z'));
    await timer.tickAsync(1000);
    expect(events).toHaveBeenCalledTimes(2);
    await worker.stop();
    await timer.tickAsync(1000);
    expect(events).toHaveBeenCalledTimes(2);
  });

  it('isolates a failed event scan so pictures still expire and the next tick retries events', async () => {
    const timer = new FakeTimerService();
    const events = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue({ deleted: 1, failed: 0 });
    const pictures = vi.fn(async () => ({ deleted: 2, failed: 0 }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new ProfileEvidenceRetentionWorker(events, pictures, logger, timer);
    worker.start();
    await worker.cleanupPending();
    expect(pictures).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ category: 'profile-event-retention' }), expect.stringContaining('failed'));
    await timer.tickAsync(1000);
    expect(events).toHaveBeenCalledTimes(2);
    expect(pictures).toHaveBeenCalledTimes(2);
    await worker.stop();
  });

  it('coalesces overlapping cycles and drains shutdown without starting another cleanup batch', async () => {
    let finish!: () => void;
    let isStopping!: () => boolean;
    const events = vi.fn(async (_now: Date, stop: () => boolean) => {
      isStopping = stop;
      await new Promise<void>((resolve) => { finish = resolve; });
      return { deleted: 1, failed: 0 };
    });
    const pictures = vi.fn(async () => ({ deleted: 0, failed: 0 }));
    const timer = new FakeTimerService();
    const worker = new ProfileEvidenceRetentionWorker(events, pictures, { info: vi.fn(), error: vi.fn() }, timer);
    worker.start();
    expect(worker.cleanupPending()).toBe(worker.cleanupPending());
    expect(events).toHaveBeenCalledTimes(1);
    const closed = vi.fn();
    const stopping = worker.stop().then(closed);
    expect(isStopping()).toBe(true);
    expect(closed).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(pictures).not.toHaveBeenCalled();
    await timer.tickAsync(1000);
    expect(events).toHaveBeenCalledTimes(1);
  });
});
