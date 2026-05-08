import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, ImageOff, Upload } from 'lucide-react';
import { useCallback } from 'react';
import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import { WallpaperGridSkeleton } from '@/components/grid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import {
  BROWSE_FORMAT_OPTIONS,
  buildWallpaperFilter,
  getFormatBadgeLabel,
  parseBrowseSearch,
  type BrowseFormatValue,
} from '@/lib/browse-filters';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: parseBrowseSearch,
});

export function HomePage() {
  const { after, format } = Route.useSearch();
  const navigate = useNavigate();
  const { isOpen } = useBrowseFilterPanel();

  const { data, isLoading, isFetchingNextPage, error, hasNextPage, fetchNextPage } =
    useWallpaperInfiniteQuery({
      initialCursor: after ?? null,
      filter: buildWallpaperFilter(format),
    });

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const handleFormatChange = useCallback(
    (nextFormat?: BrowseFormatValue) => {
      void navigate({
        to: '/',
        search: (previous: { after?: string; format?: BrowseFormatValue }) => ({
          ...previous,
          after: undefined,
          format: nextFormat,
        }),
      });
    },
    [navigate]
  );

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];

  if (wallpapers.length === 0) {
    return (
      <div>
        <BrowseFilterPanel
          isOpen={isOpen}
          selectedFormat={format}
          onFormatChange={handleFormatChange}
        />
        <EmptyState hasCursor={!!after} />
      </div>
    );
  }

  return (
    <div>
      <BrowseFilterPanel
        isOpen={isOpen}
        selectedFormat={format}
        onFormatChange={handleFormatChange}
      />
      <WallpaperGrid wallpapers={wallpapers} isLoadingMore={isFetchingNextPage} />
      <LoadMoreTrigger
        onLoadMore={handleLoadMore}
        hasMore={hasNextPage ?? false}
        isLoading={isFetchingNextPage}
      />
    </div>
  );
}

function BrowseFilterPanel({
  isOpen,
  selectedFormat,
  onFormatChange,
}: {
  isOpen: boolean;
  selectedFormat?: BrowseFormatValue;
  onFormatChange: (format?: BrowseFormatValue) => void;
}) {
  return (
    <section className="border-b bg-muted/20 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {isOpen ? (
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Format</p>
              <p className="text-muted-foreground text-xs">
                Limit results to a specific wallpaper file type.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {BROWSE_FORMAT_OPTIONS.map((option) => {
                const isSelected = option.value === (selectedFormat ?? 'any');

                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isSelected ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() =>
                      onFormatChange(option.value === 'any' ? undefined : option.value)
                    }
                    aria-pressed={isSelected}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ) : null}

        {!isOpen && selectedFormat ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{getFormatBadgeLabel(selectedFormat)}</Badge>
          </div>
        ) : null}
      </div>
    </section>
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
