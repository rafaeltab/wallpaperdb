import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWallpaperQuery } from '@/hooks/useWallpaperQuery';
import type { Wallpaper } from '@/lib/graphql/types';
import * as graphqlClient from '@/lib/graphql/client';

// Create a wrapper component for QueryClientProvider
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Disable retries for testing
        gcTime: 0, // Disable cache time for testing
      },
    },
  });
}

function createMockWallpaper(wallpaperId: string): Wallpaper {
  return {
    wallpaperId,
    userId: 'user_123',
    uploadedAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z',
    variants: [
      {
        width: 1920,
        height: 1080,
        aspectRatio: 1.7777777777777777,
        format: 'image/jpeg',
        fileSizeBytes: 500000,
        createdAt: '2024-01-15T10:30:15.000Z',
        url: 'http://localhost:3003/wallpapers/wlpr_123?w=1920&h=1080&format=image/jpeg',
      },
      {
        width: 1280,
        height: 720,
        aspectRatio: 1.7777777777777777,
        format: 'image/webp',
        fileSizeBytes: 200000,
        createdAt: '2024-01-15T10:30:20.000Z',
        url: 'http://localhost:3003/wallpapers/wlpr_123?w=1280&h=720&format=image/webp',
      },
    ],
  };
}

describe('useWallpaperQuery', () => {
  let queryClient: QueryClient;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createQueryClient();
    mockRequest = vi.fn();

    // Mock the graphql client request method
    vi.spyOn(graphqlClient, 'request').mockImplementation(mockRequest);
  });

  describe('Successful Query', () => {
    it('fetches wallpaper data by ID', async () => {
      const wallpaperId = 'wlpr_01234567890123456789012345';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockWallpaper);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String), // GraphQL query string
        { wallpaperId },
      );
    });

    it('returns wallpaper with variants', async () => {
      const wallpaperId = 'wlpr_test123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data?.variants).toHaveLength(2);
      expect(result.current.data?.variants[0].width).toBe(1920);
      expect(result.current.data?.variants[1].width).toBe(1280);
    });

    it('sets isLoading to false after fetch', async () => {
      const wallpaperId = 'wlpr_test123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      // Should start loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('caches data with correct query key ["wallpaper", wallpaperId]', async () => {
      const wallpaperId = 'wlpr_cached123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Check that data is in cache
      const cachedData = queryClient.getQueryData(['wallpaper', wallpaperId]);
      expect(cachedData).toEqual(mockWallpaper);
    });
  });

  describe('Not Found', () => {
    it('returns null data when wallpaper not found', async () => {
      const wallpaperId = 'wlpr_nonexistent';

      mockRequest.mockResolvedValueOnce({
        getWallpaper: null,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toBeNull();
    });

    it('does not set error when wallpaper not found', async () => {
      const wallpaperId = 'wlpr_nonexistent';

      mockRequest.mockResolvedValueOnce({
        getWallpaper: null,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.error).toBeNull();
    });

    it('sets isLoading to false', async () => {
      const wallpaperId = 'wlpr_nonexistent';

      mockRequest.mockResolvedValueOnce({
        getWallpaper: null,
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Validation Error', () => {
    it('sets error when wallpaperId is invalid', async () => {
      const wallpaperId = 'invalid-id-format';

      mockRequest.mockRejectedValueOnce({
        response: {
          errors: [
            {
              message: 'wallpaperId must start with "wlpr_"',
              path: ['getWallpaper'],
            },
          ],
        },
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('provides error message from GraphQL response', async () => {
      const wallpaperId = '';

      mockRequest.mockRejectedValueOnce({
        response: {
          errors: [
            {
              message: 'wallpaperId cannot be empty',
              path: ['getWallpaper'],
            },
          ],
        },
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('sets data to undefined on error', async () => {
      const wallpaperId = 'invalid';

      mockRequest.mockRejectedValueOnce({
        response: {
          errors: [{ message: 'Validation error' }],
        },
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.data).toBeUndefined();
    });
  });

  describe('Network Error', () => {
    it('sets error on network failure', async () => {
      const wallpaperId = 'wlpr_test123';

      mockRequest.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
    });

    it('retries exactly once (retry: 1)', async () => {
      const wallpaperId = 'wlpr_test123';

      // Create query client with retry: 1
      const retryQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            retryDelay: 0,
            gcTime: 0,
          },
        },
      });

      mockRequest.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(retryQueryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // Should be called twice: initial + 1 retry
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('does not retry on validation errors', async () => {
      const wallpaperId = 'invalid';
      const retryQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            retryDelay: 0,
            gcTime: 0,
          },
        },
      });

      // GraphQL validation errors should not retry
      mockRequest.mockRejectedValueOnce({
        response: {
          errors: [{ message: 'Validation error' }],
        },
      });

      const { result } = renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(retryQueryClient),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // Should only be called once (no retry for GraphQL errors)
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('Caching Behavior', () => {
    it('uses stale time of 5 minutes', async () => {
      const wallpaperId = 'wlpr_stale123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      const cacheQueryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 5 * 60 * 1000, // 5 minutes
            gcTime: 10 * 60 * 1000, // 10 minutes
          },
        },
      });

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result, rerender } = renderHook(
        () => useWallpaperQuery(wallpaperId),
        {
          wrapper: createWrapper(cacheQueryClient),
        },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Clear mock calls
      mockRequest.mockClear();

      // Rerender - should use cache, not refetch
      rerender();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Should not have refetched
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('does not refetch if data is fresh', async () => {
      const wallpaperId = 'wlpr_fresh123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      const { result, unmount } = renderHook(
        () => useWallpaperQuery(wallpaperId),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const firstCallCount = mockRequest.mock.calls.length;

      unmount();

      // Remount immediately
      const { result: result2 } = renderHook(
        () => useWallpaperQuery(wallpaperId),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should use cached data
      expect(result2.current.data).toEqual(mockWallpaper);
      expect(mockRequest.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('Query Key', () => {
    it('uses ["wallpaper", wallpaperId] as query key', async () => {
      const wallpaperId = 'wlpr_keytest123';
      const mockWallpaper = createMockWallpaper(wallpaperId);

      mockRequest.mockResolvedValueOnce({
        getWallpaper: mockWallpaper,
      });

      renderHook(() => useWallpaperQuery(wallpaperId), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        const cachedData = queryClient.getQueryData([
          'wallpaper',
          wallpaperId,
        ]);
        expect(cachedData).toBeTruthy();
      });
    });

    it('creates separate cache entries for different IDs', async () => {
      const wallpaperId1 = 'wlpr_111';
      const wallpaperId2 = 'wlpr_222';
      const mockWallpaper1 = createMockWallpaper(wallpaperId1);
      const mockWallpaper2 = createMockWallpaper(wallpaperId2);

      mockRequest
        .mockResolvedValueOnce({ getWallpaper: mockWallpaper1 })
        .mockResolvedValueOnce({ getWallpaper: mockWallpaper2 });

      // Fetch first wallpaper
      const { result: result1 } = renderHook(
        () => useWallpaperQuery(wallpaperId1),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      // Fetch second wallpaper
      const { result: result2 } = renderHook(
        () => useWallpaperQuery(wallpaperId2),
        {
          wrapper: createWrapper(queryClient),
        },
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Both should be cached separately
      const cached1 = queryClient.getQueryData(['wallpaper', wallpaperId1]);
      const cached2 = queryClient.getQueryData(['wallpaper', wallpaperId2]);

      expect(cached1).toEqual(mockWallpaper1);
      expect(cached2).toEqual(mockWallpaper2);
      expect(cached1).not.toEqual(cached2);
    });
  });
});
