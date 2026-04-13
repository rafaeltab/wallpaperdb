import { describe, expect, it } from 'vitest';
import { formatTimeRemaining, getQueueStatusText } from '@/lib/utils/upload-queue';

describe('formatTimeRemaining', () => {
  it('formats seconds less than 60', () => {
    expect(formatTimeRemaining(45000)).toBe('45s');
  });

  it('formats exactly 60 seconds as 1m 0s', () => {
    expect(formatTimeRemaining(60000)).toBe('1m 0s');
  });

  it('formats minutes and seconds', () => {
    expect(formatTimeRemaining(3549500)).toBe('59m 10s');
  });

  it('formats zero ms as 0s', () => {
    expect(formatTimeRemaining(0)).toBe('0s');
  });

  it('rounds up partial seconds', () => {
    expect(formatTimeRemaining(1500)).toBe('2s');
  });

  it('clamps negative values to 0s', () => {
    expect(formatTimeRemaining(-5000)).toBe('0s');
  });
});

describe('getQueueStatusText', () => {
  it('returns "Stopped" when queue is stopped', () => {
    expect(
      getQueueStatusText({
        isStopped: true,
        isPaused: false,
        isUploading: true,
        isComplete: false,
        hasFiles: true,
        completedCount: 3,
        totalCount: 10,
        timeRemaining: null,
      })
    ).toBe('Stopped');
  });

  it('returns "Uploading X/Y…" when running', () => {
    expect(
      getQueueStatusText({
        isStopped: false,
        isPaused: false,
        isUploading: true,
        isComplete: false,
        hasFiles: true,
        completedCount: 3,
        totalCount: 10,
        timeRemaining: null,
      })
    ).toBe('Uploading 3/10...');
  });

  it('returns "Paused (resuming in Xm Xs)" when paused with time remaining', () => {
    expect(
      getQueueStatusText({
        isStopped: false,
        isPaused: true,
        isUploading: true,
        isComplete: false,
        hasFiles: true,
        completedCount: 2,
        totalCount: 10,
        timeRemaining: '2m 30s',
      })
    ).toBe('Paused (resuming in 2m 30s)');
  });

  it('returns "Paused (rate limited)" when paused without time remaining', () => {
    expect(
      getQueueStatusText({
        isStopped: false,
        isPaused: true,
        isUploading: true,
        isComplete: false,
        hasFiles: true,
        completedCount: 2,
        totalCount: 10,
        timeRemaining: null,
      })
    ).toBe('Paused (rate limited)');
  });

  it('returns "Upload complete" when complete', () => {
    expect(
      getQueueStatusText({
        isStopped: false,
        isPaused: false,
        isUploading: false,
        isComplete: true,
        hasFiles: true,
        completedCount: 10,
        totalCount: 10,
        timeRemaining: null,
      })
    ).toBe('Upload complete');
  });

  it('returns "Ready to upload" when idle with files', () => {
    expect(
      getQueueStatusText({
        isStopped: false,
        isPaused: false,
        isUploading: false,
        isComplete: false,
        hasFiles: true,
        completedCount: 0,
        totalCount: 5,
        timeRemaining: null,
      })
    ).toBe('Ready to upload');
  });

  it('prioritizes stopped over paused when both flags are set', () => {
    expect(
      getQueueStatusText({
        isStopped: true,
        isPaused: true,
        isUploading: true,
        isComplete: false,
        hasFiles: true,
        completedCount: 3,
        totalCount: 10,
        timeRemaining: null,
      })
    ).toBe('Stopped');
  });
});