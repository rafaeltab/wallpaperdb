import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMediaQuery } from '@/hooks/use-media-query';

describe('useMediaQuery', () => {
  let mediaQueryList: {
    matches: boolean;
    media: string;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create a controllable media query list mock
    mediaQueryList = {
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };

    // Mock window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      mediaQueryList.media = query;
      return mediaQueryList as unknown as MediaQueryList;
    });
  });

  describe('Initial Match', () => {
    it('returns true when media query matches on mount', () => {
      mediaQueryList.matches = true;

      const { result } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      expect(result.current).toBe(true);
    });

    it('returns false when media query does not match on mount', () => {
      mediaQueryList.matches = false;

      const { result } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      expect(result.current).toBe(false);
    });

    it('calls matchMedia with correct query string', () => {
      const query = '(min-width: 768px)';
      renderHook(() => useMediaQuery(query));

      expect(window.matchMedia).toHaveBeenCalledWith(query);
    });
  });

  describe('Reactive Updates', () => {
    it('updates when viewport size changes to match query', () => {
      mediaQueryList.matches = false;

      const { result, rerender } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      expect(result.current).toBe(false);

      // Get the change listener that was registered
      const changeListener = mediaQueryList.addEventListener.mock.calls.find(
        (call) => call[0] === 'change',
      )?.[1];

      expect(changeListener).toBeDefined();

      // Simulate viewport change
      mediaQueryList.matches = true;
      changeListener?.({ matches: true } as MediaQueryListEvent);

      rerender();

      expect(result.current).toBe(true);
    });

    it('updates when viewport size changes to not match query', () => {
      mediaQueryList.matches = true;

      const { result, rerender } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      expect(result.current).toBe(true);

      // Get the change listener
      const changeListener = mediaQueryList.addEventListener.mock.calls.find(
        (call) => call[0] === 'change',
      )?.[1];

      // Simulate viewport change
      mediaQueryList.matches = false;
      changeListener?.({ matches: false } as MediaQueryListEvent);

      rerender();

      expect(result.current).toBe(false);
    });

    it('handles multiple queries simultaneously', () => {
      // First query (mobile)
      const mobileMediaQueryList = { ...mediaQueryList, matches: true };
      // Second query (desktop)
      const desktopMediaQueryList = { ...mediaQueryList, matches: false };

      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
        if (query.includes('max-width')) {
          return mobileMediaQueryList as unknown as MediaQueryList;
        }
        return desktopMediaQueryList as unknown as MediaQueryList;
      });

      const { result: mobileResult } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );
      const { result: desktopResult } = renderHook(() =>
        useMediaQuery('(min-width: 1025px)'),
      );

      expect(mobileResult.current).toBe(true);
      expect(desktopResult.current).toBe(false);
    });
  });

  describe('Cleanup', () => {
    it('removes event listener on unmount', () => {
      const { unmount } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      expect(mediaQueryList.addEventListener).toHaveBeenCalled();

      unmount();

      expect(mediaQueryList.removeEventListener).toHaveBeenCalled();
      expect(mediaQueryList.removeEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
    });

    it('does not update state after unmount', () => {
      mediaQueryList.matches = false;

      const { result, unmount, rerender } = renderHook(() =>
        useMediaQuery('(max-width: 1024px)'),
      );

      const initialValue = result.current;
      expect(initialValue).toBe(false);

      // Get the change listener
      const changeListener = mediaQueryList.addEventListener.mock.calls.find(
        (call) => call[0] === 'change',
      )?.[1];

      unmount();

      // Try to trigger change after unmount (should not update state)
      mediaQueryList.matches = true;
      changeListener?.({ matches: true } as MediaQueryListEvent);

      // Should not cause errors or state updates
      expect(() => rerender()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('handles invalid media query gracefully', () => {
      // matchMedia returns a MediaQueryList even for invalid queries
      mediaQueryList.matches = false;

      expect(() => {
        renderHook(() => useMediaQuery('invalid query syntax'));
      }).not.toThrow();
    });

    it('works with complex media queries', () => {
      const complexQuery = '(max-width: 1024px) and (orientation: portrait)';
      mediaQueryList.matches = true;

      const { result } = renderHook(() => useMediaQuery(complexQuery));

      expect(window.matchMedia).toHaveBeenCalledWith(complexQuery);
      expect(result.current).toBe(true);
    });

    it('works with min-width queries', () => {
      mediaQueryList.matches = true;

      const { result } = renderHook(() =>
        useMediaQuery('(min-width: 768px)'),
      );

      expect(result.current).toBe(true);
    });

    it('works with orientation queries', () => {
      mediaQueryList.matches = true;

      const { result } = renderHook(() =>
        useMediaQuery('(orientation: landscape)'),
      );

      expect(result.current).toBe(true);
    });

    it('works with prefers-color-scheme queries', () => {
      mediaQueryList.matches = true;

      const { result } = renderHook(() =>
        useMediaQuery('(prefers-color-scheme: dark)'),
      );

      expect(result.current).toBe(true);
    });
  });
});
