import { useMemo } from 'react';
import { MuuriGrid } from './strategies';
import { generateSkeletonItems } from '@/features/grid-layout';

interface WallpaperGridSkeletonProps {
  count?: number;
  baseSize?: number;
  gap?: number;
}

export function WallpaperGridSkeleton({
  count = 12,
  baseSize = 375,
  gap = 16,
}: WallpaperGridSkeletonProps) {
  const items = useMemo(() => generateSkeletonItems(count), [count]);

  return <MuuriGrid items={items} baseSize={baseSize} gap={gap} />;
}
