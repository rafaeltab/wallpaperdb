import type { Wallpaper } from '@/lib/graphql/types';
import { MuuriGrid, wallpapersToGridItems } from './grid';

interface WallpaperGridProps {
  wallpapers: Wallpaper[];
}

export function WallpaperGrid({ wallpapers }: WallpaperGridProps) {
  const items = wallpapersToGridItems(wallpapers);

  return (
    <MuuriGrid
      items={items}
      baseSize={375}
      gap={16}
      onItemClick={(item) => {
        console.log('Clicked:', item.id);
      }}
    />
  );
}
