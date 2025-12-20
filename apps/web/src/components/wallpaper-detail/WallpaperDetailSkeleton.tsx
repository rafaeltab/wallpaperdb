import { Skeleton } from '@/components/ui/skeleton';

/**
 * Full-page loading skeleton for wallpaper detail page.
 * Matches the final layout structure.
 */
export function WallpaperDetailSkeleton() {
  return (
    <output className="flex h-screen flex-col" aria-label="Loading wallpaper details">
      <span className="sr-only">Loading wallpaper details...</span>

      {/* Header skeleton */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" data-testid="back-button-skeleton" />
          <Skeleton className="h-6 w-40" data-testid="title-skeleton" />
        </div>
        <Skeleton className="h-9 w-9 rounded-md" data-testid="toggle-skeleton" />
      </header>

      {/* Main content area */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
        {/* Large image skeleton */}
        <Skeleton
          className="aspect-video w-full max-w-4xl rounded-lg"
          data-testid="image-skeleton"
        />

        {/* Viewing indicator skeleton */}
        <Skeleton className="h-5 w-48" />

        {/* Action bar skeleton */}
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40" data-testid="button-skeleton-download" />
          <Skeleton className="h-10 w-28" data-testid="button-skeleton-share" />
        </div>
      </main>
    </output>
  );
}
