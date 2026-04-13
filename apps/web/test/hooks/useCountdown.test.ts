import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCountdown } from '@/hooks/useCountdown';

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when pausedUntil is null', () => {
    const { result } = renderHook(() => useCountdown(null));
    expect(result.current).toBeNull();
  });

  it('returns formatted time remaining when pausedUntil is in the future', () => {
    const pausedUntil = Date.now() + 45000;
    const { result } = renderHook(() => useCountdown(pausedUntil));
    expect(result.current).toBe('45s');
  });

  it('returns null when pausedUntil is in the past', () => {
    const pausedUntil = Date.now() - 1000;
    const { result } = renderHook(() => useCountdown(pausedUntil));
    expect(result.current).toBeNull();
  });

  it('decrements every second', () => {
    const pausedUntil = Date.now() + 10000;
    const { result } = renderHook(() => useCountdown(pausedUntil));

    expect(result.current).toBe('10s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('9s');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('4s');
  });

  it('returns null when countdown reaches zero', () => {
    const pausedUntil = Date.now() + 3000;
    const { result } = renderHook(() => useCountdown(pausedUntil));

    expect(result.current).toBe('3s');

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBeNull();
  });

  it('updates when pausedUntil changes', () => {
    const { result, rerender } = renderHook(
      ({ pausedUntil }: { pausedUntil: number | null }) => useCountdown(pausedUntil),
      { initialProps: { pausedUntil: null } }
    );

    expect(result.current).toBeNull();

    const newPausedUntil = Date.now() + 60000;
    rerender({ pausedUntil: newPausedUntil });
    expect(result.current).toBe('1m 0s');
  });

  it('formats minutes and seconds correctly', () => {
    const pausedUntil = Date.now() + 125000;
    const { result } = renderHook(() => useCountdown(pausedUntil));
    expect(result.current).toBe('2m 5s');
  });

  it('cleans up interval on unmount', () => {
    const pausedUntil = Date.now() + 30000;
    const { unmount } = renderHook(() => useCountdown(pausedUntil));

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});