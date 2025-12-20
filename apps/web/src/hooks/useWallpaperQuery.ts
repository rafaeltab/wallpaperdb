import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/graphql/client';
import { GET_WALLPAPER } from '@/lib/graphql/queries';
import type { Wallpaper } from '@/lib/graphql/types';

interface GetWallpaperResponse {
  getWallpaper: Wallpaper | null;
}

/**
 * TanStack Query hook to fetch a single wallpaper by ID.
 *
 * @param wallpaperId - Wallpaper ID (format: wlpr_<ulid>)
 * @returns Query result with wallpaper data, loading state, and error
 */
export function useWallpaperQuery(wallpaperId: string) {
  return useQuery({
    queryKey: ['wallpaper', wallpaperId],
    queryFn: async () => {
      const data = await request<GetWallpaperResponse>(GET_WALLPAPER, {
        wallpaperId,
      });
      return data.getWallpaper;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });
}
