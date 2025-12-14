import { useMemo } from 'react';
import type { Wallpaper } from '@/lib/graphql/types';
import { generateSkeletonItems, MuuriGrid, wallpapersToGridItems } from './grid';

interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /** Whether more items are being loaded */
  isLoadingMore?: boolean;
  /** Number of skeleton items to show when loading (default: 12) */
  skeletonCount?: number;
}

export function WallpaperGrid({
  wallpapers,
  isLoadingMore = false,
  skeletonCount = 12,
}: WallpaperGridProps) {
  const realItems = wallpapersToGridItems(wallpapers);

  // Append skeleton items when loading more
  const items = useMemo(() => {
    if (isLoadingMore) {
      const skeletons = generateSkeletonItems(skeletonCount, realItems.length);
      return [...realItems, ...skeletons];
    }
    return realItems;
  }, [realItems, isLoadingMore, skeletonCount]);

  return (
    <MuuriGrid
      items={items}
      baseSize={375}
      gap={16}
      onItemClick={(item) => {
        if (!item.isSkeleton) {
          console.log('Clicked:', item.id);
        }
      }}
    />
  );
}
