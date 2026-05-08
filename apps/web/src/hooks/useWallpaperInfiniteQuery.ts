import { useInfiniteQuery } from '@tanstack/react-query';
import { graphqlClient } from '@/lib/graphql/client';
import { SEARCH_WALLPAPERS } from '@/lib/graphql/queries';
import type { WallpaperConnection, WallpaperFilter, WallpaperSort } from '@/lib/graphql/types';

interface UseWallpaperInfiniteQueryOptions {
  initialCursor?: string | null;
  filter?: WallpaperFilter;
  sort?: WallpaperSort;
  pageSize?: number;
}

interface SearchWallpapersResponse {
  searchWallpapers: WallpaperConnection;
}

export function useWallpaperInfiniteQuery({
  initialCursor = null,
  filter,
  sort,
  pageSize = 20,
}: UseWallpaperInfiniteQueryOptions = {}) {
  return useInfiniteQuery({
    queryKey: ['wallpapers', 'infinite', { filter, initialCursor, sort }],
    queryFn: async ({ pageParam }) => {
      const response = await graphqlClient.request<SearchWallpapersResponse>(SEARCH_WALLPAPERS, {
        filter,
        sort,
        first: pageSize,
        after: pageParam,
      });
      return response.searchWallpapers;
    },
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
    initialPageParam: initialCursor,
  });
}
