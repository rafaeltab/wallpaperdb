import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Eye, Download, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { downloadVariant } from '@/lib/utils/wallpaper';
import { shareWallpaper } from '@/lib/services/wallpaper-share';
import type { Wallpaper } from '@/lib/graphql/types';
import type { GridItemRendererProps } from './types';

/**
 * Default renderer for wallpaper items in the grid.
 *
 * This component is responsible for rendering a single wallpaper.
 * It can be replaced with a custom renderer via the ItemRenderer prop on the grid.
 * When the item has `isSkeleton: true`, renders a skeleton placeholder instead.
 * Shows a skeleton overlay while the actual image is loading.
 * 
 * When expanded, displays an overlay menu with actions:
 * - View details (opens in new tab)
 * - Download original quality
 * - Share wallpaper URL
 */
export function WallpaperCard({
  item,
  isExpanded,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: GridItemRendererProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  // Extract wallpaper from metadata
  const wallpaper = item.metadata?.wallpaper as Wallpaper | undefined;

  // Render skeleton placeholder for loading items
  if (item.isSkeleton) {
    return <Skeleton className="w-full h-full rounded-lg" />;
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!wallpaper?.variants[0]) {
      toast.error('No wallpaper available to download');
      return;
    }

    try {
      await downloadVariant(wallpaper.variants[0]);
    } catch (error) {
      toast.error('Failed to download wallpaper');
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!wallpaper) {
      toast.error('Cannot share this wallpaper');
      return;
    }

    await shareWallpaper(wallpaper.wallpaperId);
  };

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

      {/* Overlay menu - only show when expanded and not skeleton */}
      {isExpanded && wallpaper && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 bg-black/60 rounded-lg animate-in fade-in duration-200">
          {/* Eye Icon - View Details */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/wallpapers/$wallpaperId"
                params={{ wallpaperId: wallpaper.wallpaperId }}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center size-8 rounded-[min(var(--radius-md),10px)] text-white hover:text-white hover:bg-white/20 transition-all"
              >
                <Eye className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>View details</TooltipContent>
          </Tooltip>

          {/* Download Icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleDownload}
                className="inline-flex items-center justify-center size-8 rounded-[min(var(--radius-md),10px)] text-white hover:text-white hover:bg-white/20 transition-all"
                type="button"
              >
                <Download className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Download original</TooltipContent>
          </Tooltip>

          {/* Share Icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleShare}
                className="inline-flex items-center justify-center size-8 rounded-[min(var(--radius-md),10px)] text-white hover:text-white hover:bg-white/20 transition-all"
                type="button"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Share</TooltipContent>
          </Tooltip>
        </div>
      )}
    </button>
  );
}
