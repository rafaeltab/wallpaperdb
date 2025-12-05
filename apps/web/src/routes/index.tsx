import { createFileRoute, Link } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): { after?: string } => ({
    after: typeof search.after === 'string' ? search.after : undefined,
  }),
});

function HomePage() {
  const { after } = Route.useSearch();

  // Capture initial cursor on mount - don't react to URL changes during scroll
  const initialCursorRef = useRef(after);

  const {
    data,
    isLoading,
    isFetchingNextPage,
    error,
    hasNextPage,
    fetchNextPage,
  } = useWallpaperInfiniteQuery({
    initialCursor: initialCursorRef.current ?? null,
  });

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-600">Loading wallpapers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-red-600">Error: {error.message}</div>
      </div>
    );
  }

  const wallpapers = data?.pages.flatMap((page) =>
    page.edges.map((edge) => edge.node)
  ) ?? [];

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Wallpapers</h1>

      {wallpapers.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            {initialCursorRef.current ? (
              <>
                <p className="text-gray-600 mb-4">No wallpapers found from this point</p>
                <Link to="/" search={{}} className="text-blue-600 hover:text-blue-700 font-medium">
                  Go to beginning
                </Link>
              </>
            ) : (
              <>
                <p className="text-gray-600 mb-4">No wallpapers found</p>
                <Link to="/upload" className="text-blue-600 hover:text-blue-700 font-medium">
                  Upload your first wallpaper
                </Link>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <WallpaperGrid wallpapers={wallpapers} />

          <LoadMoreTrigger
            onLoadMore={handleLoadMore}
            hasMore={hasNextPage ?? false}
            isLoading={isFetchingNextPage}
          />
        </>
      )}
    </div>
  );
}
