import type { Wallpaper } from '@/lib/graphql/types';
import { MuuriGrid, wallpapersToGridItems } from './grid';

interface WallpaperGridProps {
  wallpapers: Wallpaper[];
  /** Whether more items are being loaded */
  isLoadingMore?: boolean;
}

export function WallpaperGrid({ wallpapers, isLoadingMore = false }: WallpaperGridProps) {
  const items = wallpapersToGridItems(wallpapers);

  return (
    <>
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
      {isLoadingMore && (
        <output className="block py-6 text-center text-sm text-muted-foreground">
          Loading more wallpapers…
        </output>
      )}
    </>
  );
}
