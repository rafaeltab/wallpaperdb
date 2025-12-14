import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Represents different aspect ratio types for skeleton items.
 * Mimics the variety found in real wallpaper grids.
 */
type SkeletonType = 'standard' | 'ultrawide' | 'portrait';

interface SkeletonItem {
  id: number;
  type: SkeletonType;
  /** Aspect ratio (width / height) */
  aspectRatio: number;
  /** Number of columns this item spans */
  cols: 1 | 2;
}

/**
 * Generates a deterministic mix of skeleton items with varied aspect ratios.
 * The distribution is designed to look natural and cover common wallpaper formats.
 */
function generateSkeletonItems(count: number): SkeletonItem[] {
  const items: SkeletonItem[] = [];

  // Predefined pattern to look natural (repeating if count > pattern length)
  const typePattern: SkeletonType[] = [
    'standard',
    'standard',
    'ultrawide',
    'standard',
    'portrait',
    'standard',
    'standard',
    'ultrawide',
    'portrait',
    'standard',
    'standard',
    'standard',
  ];

  // Aspect ratios for each type (matching thresholds from utils.ts)
  const aspectRatios: Record<SkeletonType, number[]> = {
    standard: [1.78, 1.6, 1.33, 1.0], // 16:9, 16:10, 4:3, 1:1
    ultrawide: [2.33, 2.67, 3.2], // 21:9, 24:9, 32:10
    portrait: [0.56, 0.47, 0.42], // 9:16, 9:19, 9:21
  };

  for (let i = 0; i < count; i++) {
    const type = typePattern[i % typePattern.length];
    const ratioOptions = aspectRatios[type];
    const aspectRatio = ratioOptions[i % ratioOptions.length];

    items.push({
      id: i,
      type,
      aspectRatio,
      cols: type === 'ultrawide' ? 2 : 1,
    });
  }

  return items;
}

interface WallpaperGridSkeletonProps {
  /** Number of skeleton items to show (default: 12) */
  count?: number;
  /** Base size for grid cells in pixels (default: 375) */
  baseSize?: number;
  /** Gap between items in pixels (default: 16) */
  gap?: number;
}

/**
 * A skeleton loading state that matches the MuuriGrid layout appearance.
 * Uses CSS grid with bin-packing-like behavior to approximate the real grid.
 */
export function WallpaperGridSkeleton({
  count = 12,
  baseSize = 375,
  gap = 16,
}: WallpaperGridSkeletonProps) {
  const items = useMemo(() => generateSkeletonItems(count), [count]);

  return (
    <div
      className="w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${baseSize}px, 1fr))`,
        gap: `${gap}px`,
        padding: `${gap / 2}px`,
      }}
    >
      {items.map((item) => {
        // Calculate height based on aspect ratio
        // For 2-column items, we approximate as if it spans the full baseSize * 2
        const widthMultiplier = item.cols;
        const baseHeight = baseSize / item.aspectRatio;

        return (
          <div
            key={item.id}
            style={{
              gridColumn: item.cols === 2 ? 'span 2' : 'span 1',
            }}
          >
            <Skeleton
              className="w-full rounded-lg"
              style={{
                height: `${Math.round(baseHeight)}px`,
                // For 2-col items, adjust height since actual width is ~2x
                ...(item.cols === 2 && {
                  height: `${Math.round((baseSize * widthMultiplier) / item.aspectRatio)}px`,
                }),
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
