import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, ImageOff, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowseFilterPanel } from '@/components/browse-filter-panel';
import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import ColorFilterPrototype from '@/components/color-filter-prototype/color-filter-prototype';
import { isColorPrototype } from '@/components/color-filter-prototype/mode';
import { WallpaperGridSkeleton } from '@/components/grid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import {
  type BrowseAspectRatioPresetValue,
  type BrowseAspectRatioValue,
  type BrowseFormatValue,
  type BrowseSearchState,
  buildWallpaperFilter,
  buildWallpaperSort,
  getAspectRatioFilterValue,
  parseBrowseSearch,
  resolveClosestAspectRatioPreset,
} from '@/lib/browse-filters';

const COLOR_INPUT_DEBOUNCE_MS = 300;
const FALLBACK_COLOR_INPUT_VALUE = '#FFFFFF';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: parseBrowseSearch,
});

export function HomePage() {
  return isColorPrototype() ? <ColorFilterPrototype /> : <BrowseHomePage />;
}

function BrowseHomePage() {
  const { after, color, format, aspectRatio, profileId } = Route.useSearch();
  const navigate = useNavigate();
  const { isOpen } = useBrowseFilterPanel();
  const deviceAspectRatioPreset = useDeviceAspectRatioPreset();
  const [draftColor, setDraftColor] = useState(color ?? FALLBACK_COLOR_INPUT_VALUE);
  const colorChangeTimeoutRef = useRef<number | undefined>(undefined);

  const { data, isLoading, isFetchingNextPage, error, hasNextPage, fetchNextPage } =
    useWallpaperInfiniteQuery({
      initialCursor: after ?? null,
      filter: buildWallpaperFilter(
        format,
        getAspectRatioFilterValue(aspectRatio, deviceAspectRatioPreset),
        profileId
      ),
      sort: buildWallpaperSort(color),
    });

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  const handleProfileChange = useCallback(
    (nextProfileId?: string) => {
      void navigate({
        to: '/',
        search: (previous: BrowseSearchState) => ({
          ...previous,
          after: undefined,
          profileId: nextProfileId,
        }),
      });
    },
    [navigate]
  );

  const handleFormatChange = useCallback(
    (nextFormat?: BrowseFormatValue) => {
      void navigate({
        to: '/',
        search: (previous: {
          after?: string;
          format?: BrowseFormatValue;
          aspectRatio?: BrowseAspectRatioValue;
        }) => ({
          ...previous,
          after: undefined,
          format: nextFormat,
        }),
      });
    },
    [navigate]
  );

  const handleAspectRatioChange = useCallback(
    (nextAspectRatio?: BrowseAspectRatioValue) => {
      void navigate({
        to: '/',
        search: (previous: {
          after?: string;
          format?: BrowseFormatValue;
          aspectRatio?: BrowseAspectRatioValue;
        }) => ({
          ...previous,
          after: undefined,
          aspectRatio: nextAspectRatio,
        }),
      });
    },
    [navigate]
  );

  const handleColorChange = useCallback(
    (nextColor?: string) => {
      void navigate({
        to: '/',
        search: (previous: {
          after?: string;
          color?: string;
          format?: BrowseFormatValue;
          aspectRatio?: BrowseAspectRatioValue;
        }) => ({
          ...previous,
          after: undefined,
          color: nextColor,
        }),
      });
    },
    [navigate]
  );

  const handleColorInputChange = useCallback(
    (nextColor: string) => {
      const normalizedColor = nextColor.toUpperCase();

      setDraftColor(normalizedColor);

      if (colorChangeTimeoutRef.current) {
        window.clearTimeout(colorChangeTimeoutRef.current);
      }

      colorChangeTimeoutRef.current = window.setTimeout(() => {
        handleColorChange(normalizedColor);
      }, COLOR_INPUT_DEBOUNCE_MS);
    },
    [handleColorChange]
  );

  const handleClearColor = useCallback(() => {
    if (colorChangeTimeoutRef.current) {
      window.clearTimeout(colorChangeTimeoutRef.current);
      colorChangeTimeoutRef.current = undefined;
    }

    setDraftColor(FALLBACK_COLOR_INPUT_VALUE);
    handleColorChange(undefined);
  }, [handleColorChange]);

  useEffect(() => {
    setDraftColor(color ?? FALLBACK_COLOR_INPUT_VALUE);
  }, [color]);

  useEffect(() => {
    return () => {
      if (colorChangeTimeoutRef.current) {
        window.clearTimeout(colorChangeTimeoutRef.current);
      }
    };
  }, []);
  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];

  return (
    <div>
      <BrowseFilterPanel
        isOpen={isOpen}
        draftColor={draftColor}
        selectedColor={color}
        selectedFormat={format}
        selectedAspectRatio={aspectRatio}
        selectedProfileId={profileId}
        onProfileChange={handleProfileChange}
        deviceAspectRatioPreset={deviceAspectRatioPreset}
        onClearColor={handleClearColor}
        onColorInputChange={handleColorInputChange}
        onFormatChange={handleFormatChange}
        onAspectRatioChange={handleAspectRatioChange}
      />
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : wallpapers.length === 0 ? (
        <EmptyState hasCursor={!!after} hasFilters={Boolean(profileId || format || aspectRatio)} />
      ) : (
        <>
          <WallpaperGrid wallpapers={wallpapers} isLoadingMore={isFetchingNextPage} />
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

function useDeviceAspectRatioPreset(): BrowseAspectRatioPresetValue {
  const [deviceAspectRatioPreset, setDeviceAspectRatioPreset] =
    useState<BrowseAspectRatioPresetValue>(() => getDeviceAspectRatioPreset());

  useEffect(() => {
    const syncDeviceAspectRatioPreset = () => {
      setDeviceAspectRatioPreset(getDeviceAspectRatioPreset());
    };

    syncDeviceAspectRatioPreset();

    const intervalId = window.setInterval(syncDeviceAspectRatioPreset, 1000);
    window.addEventListener('resize', syncDeviceAspectRatioPreset);
    window.addEventListener('orientationchange', syncDeviceAspectRatioPreset);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', syncDeviceAspectRatioPreset);
      window.removeEventListener('orientationchange', syncDeviceAspectRatioPreset);
    };
  }, []);

  return deviceAspectRatioPreset;
}

function getDeviceAspectRatioPreset(): BrowseAspectRatioPresetValue {
  const width = window.screen?.width;
  const height = window.screen?.height;

  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return '16-9';
  }

  return resolveClosestAspectRatioPreset(width / height);
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

function EmptyState({ hasCursor, hasFilters }: { hasCursor: boolean; hasFilters: boolean }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardContent className="pt-6 text-center">
          <ImageOff className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          {hasCursor ? (
            <>
              <p className="text-muted-foreground mb-4">No wallpapers found from this point</p>
              <Button asChild>
                <Link to="/" search={(previous) => ({ ...previous, after: undefined })}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Go to beginning
                </Link>
              </Button>
            </>
          ) : hasFilters ? (
            <>
              <p className="mb-2 font-medium">No wallpapers match these filters.</p>
              <p className="text-sm text-muted-foreground">
                Try another Profile or clear a filter to see more wallpapers.
              </p>
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
