import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { Variant } from '@/lib/graphql/types';

interface WallpaperDisplayProps {
  variant: Variant;
  isLoading: boolean;
  onLoadComplete: () => void;
  showIndicator?: boolean;
  isOriginal?: boolean;
}

/**
 * Displays a wallpaper at maximum size with optional variant indicator.
 */
export function WallpaperDisplay({
  variant,
  isLoading,
  onLoadComplete,
  showIndicator = false,
  isOriginal = false,
}: WallpaperDisplayProps) {
  // Extract format name from MIME type (e.g., "image/jpeg" -> "JPEG")
  const formatName = variant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';

  return (
    <div className="relative flex items-center justify-center" data-testid="wallpaper-container">
      {/* Skeleton overlay while loading */}
      {isLoading && (
        <Skeleton
          className="absolute inset-0 h-full w-full"
          data-testid="wallpaper-skeleton"
        />
      )}

      {/* Main image */}
      <img
        src={variant.url}
        alt={`Wallpaper ${variant.width}×${variant.height}`}
        className={`max-h-full max-w-full object-contain transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={onLoadComplete}
      />

      {/* Variant indicator overlay */}
      {showIndicator && !isLoading && (
        <div
          className="absolute bottom-4 right-4 flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5 backdrop-blur-sm"
          data-testid="variant-indicator"
        >
          <Badge variant="secondary">{formatName}</Badge>
          <span className="text-sm text-muted-foreground">
            {variant.width}×{variant.height}
          </span>
          {isOriginal && <Badge variant="default">Original</Badge>}
        </div>
      )}
    </div>
  );
}
