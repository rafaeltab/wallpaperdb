import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { GridItemRendererProps } from './types';

/**
 * Default renderer for wallpaper items in the grid.
 *
 * This component is responsible for rendering a single wallpaper.
 * It can be replaced with a custom renderer via the ItemRenderer prop on the grid.
 * When the item has `isSkeleton: true`, renders a skeleton placeholder instead.
 * Shows a skeleton overlay while the actual image is loading.
 */
export function WallpaperCard({
  item,
  isExpanded,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: GridItemRendererProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  // Render skeleton placeholder for loading items
  if (item.isSkeleton) {
    return <Skeleton className="w-full h-full rounded-lg" />;
  }

  return (
    <button
      type="button"
      className={`
        relative overflow-hidden rounded-lg cursor-pointer
        transition-shadow duration-200 w-full h-full
        hover:shadow-lg
        ${isExpanded ? 'ring-2 ring-blue-500 shadow-xl' : 'shadow'}
      `}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-expanded={isExpanded}
      aria-label={`Wallpaper ${item.id}`}
    >
      {/* Skeleton shown while image is loading */}
      {!isLoaded && <Skeleton className="absolute inset-0 rounded-lg" />}
      <img
        src={item.src}
        alt={`Wallpaper ${item.id}`}
        className={`
          w-full h-full object-cover
          transition-opacity duration-300
          ${isLoaded ? 'opacity-100' : 'opacity-0'}
        `}
        loading="lazy"
        draggable={false}
        onLoad={() => setIsLoaded(true)}
      />
    </button>
  );
}
