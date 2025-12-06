import type { GridItemRendererProps } from './types';

/**
 * Default renderer for wallpaper items in the grid.
 *
 * This component is responsible for rendering a single wallpaper.
 * It can be replaced with a custom renderer via the ItemRenderer prop on the grid.
 */
export function WallpaperCard({
  item,
  isExpanded,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: GridItemRendererProps) {
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
      <img
        src={item.src}
        alt={`Wallpaper ${item.id}`}
        className="w-full h-full object-cover"
        loading="lazy"
        draggable={false}
      />
    </button>
  );
}
