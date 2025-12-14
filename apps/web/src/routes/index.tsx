import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, ImageOff, Upload } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { WallpaperGridSkeleton } from '@/components/grid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): { after?: string } => ({
    after: typeof search.after === 'string' ? search.after : undefined,
  }),
});

function HomePage() {
  const { after } = Route.useSearch();
  const initialCursorRef = useRef(after);

  const { data, isLoading, isFetchingNextPage, error, hasNextPage, fetchNextPage } =
    useWallpaperInfiniteQuery({
      initialCursor: initialCursorRef.current ?? null,
    });

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];

  if (wallpapers.length === 0) {
    return <EmptyState hasCursor={!!initialCursorRef.current} />;
  }

  return (
    <div>
      <WallpaperGrid wallpapers={wallpapers} isLoadingMore={isFetchingNextPage} />
      <LoadMoreTrigger
        onLoadMore={handleLoadMore}
        hasMore={hasNextPage ?? false}
        isLoading={isFetchingNextPage}
      />
    </div>
  );
}

function LoadingState() {
  return <WallpaperGridSkeleton count={12} baseSize={375} gap={16} />;
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load wallpapers</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
      <div className="mt-4 flex justify-center">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ hasCursor }: { hasCursor: boolean }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardContent className="pt-6 text-center">
          <ImageOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          {hasCursor ? (
            <>
              <p className="text-muted-foreground mb-4">No wallpapers found from this point</p>
              <Button asChild>
                <Link to="/" search={{}}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go to beginning
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground mb-4">
                No wallpapers found. Upload your first one!
              </p>
              <Button asChild>
                <Link to="/upload">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload wallpaper
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
