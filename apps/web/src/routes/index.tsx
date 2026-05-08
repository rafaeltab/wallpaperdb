import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, ImageOff, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import { WallpaperGridSkeleton } from '@/components/grid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import {
  BROWSE_ASPECT_RATIO_OPTIONS,
  BROWSE_FORMAT_OPTIONS,
  getAspectRatioBadgeLabel,
  getAspectRatioFilterValue,
  getAspectRatioLabel,
  buildWallpaperFilter,
  buildWallpaperSort,
  getColorBadgeLabel,
  getFormatBadgeLabel,
  parseBrowseSearch,
  resolveClosestAspectRatioPreset,
  type BrowseAspectRatioPresetValue,
  type BrowseAspectRatioValue,
  type BrowseFormatValue,
} from '@/lib/browse-filters';

const COLOR_INPUT_DEBOUNCE_MS = 300;
const DEFAULT_BROWSE_COLOR = '#000000';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: parseBrowseSearch,
});

export function HomePage() {
  const { after, color, format, aspectRatio } = Route.useSearch();
  const navigate = useNavigate();
  const { isOpen } = useBrowseFilterPanel();
  const deviceAspectRatioPreset = useDeviceAspectRatioPreset();
  const [draftColor, setDraftColor] = useState(color ?? DEFAULT_BROWSE_COLOR);
  const colorChangeTimeoutRef = useRef<number | undefined>(undefined);

  const { data, isLoading, isFetchingNextPage, error, hasNextPage, fetchNextPage } =
    useWallpaperInfiniteQuery({
      initialCursor: after ?? null,
      filter: buildWallpaperFilter(
        format,
        getAspectRatioFilterValue(aspectRatio, deviceAspectRatioPreset),
      ),
      sort: buildWallpaperSort(color),
    });

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

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

    setDraftColor(DEFAULT_BROWSE_COLOR);
    handleColorChange(undefined);
  }, [handleColorChange]);

  useEffect(() => {
    setDraftColor(color ?? DEFAULT_BROWSE_COLOR);
  }, [color]);

  useEffect(() => {
    return () => {
      if (colorChangeTimeoutRef.current) {
        window.clearTimeout(colorChangeTimeoutRef.current);
      }
    };
  }, []);
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
          draftColor={draftColor}
          selectedColor={color}
          selectedFormat={format}
          selectedAspectRatio={aspectRatio}
          deviceAspectRatioPreset={deviceAspectRatioPreset}
          onClearColor={handleClearColor}
          onColorInputChange={handleColorInputChange}
          onFormatChange={handleFormatChange}
          onAspectRatioChange={handleAspectRatioChange}
        />
        <EmptyState hasCursor={!!after} />
      </div>
    );
  }

  return (
    <div>
      <BrowseFilterPanel
        isOpen={isOpen}
        draftColor={draftColor}
        selectedColor={color}
        selectedFormat={format}
        selectedAspectRatio={aspectRatio}
        deviceAspectRatioPreset={deviceAspectRatioPreset}
        onClearColor={handleClearColor}
        onColorInputChange={handleColorInputChange}
        onFormatChange={handleFormatChange}
        onAspectRatioChange={handleAspectRatioChange}
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
  draftColor,
  isOpen,
  selectedColor,
  selectedFormat,
  selectedAspectRatio,
  deviceAspectRatioPreset,
  onClearColor,
  onColorInputChange,
  onFormatChange,
  onAspectRatioChange,
}: {
  draftColor: string;
  isOpen: boolean;
  selectedColor?: string;
  selectedFormat?: BrowseFormatValue;
  selectedAspectRatio?: BrowseAspectRatioValue;
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue;
  onClearColor: () => void;
  onColorInputChange: (color: string) => void;
  onFormatChange: (format?: BrowseFormatValue) => void;
  onAspectRatioChange: (aspectRatio?: BrowseAspectRatioValue) => void;
}) {
  return (
    <section className="border-b bg-muted/20 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {isOpen ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div>
                <label htmlFor="browse-color" className="text-sm font-medium text-foreground">
                  Color
                </label>
                <p id="browse-color-description" className="text-muted-foreground text-xs">
                  Bias results toward a specific visual tone.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="browse-color"
                  type="color"
                  value={draftColor}
                  aria-describedby="browse-color-description"
                  className="h-10 w-14 cursor-pointer p-1"
                  onInput={(event) => onColorInputChange(event.currentTarget.value)}
                />
                <span className="text-muted-foreground text-xs font-medium uppercase">
                  {draftColor}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClearColor}
                  disabled={!selectedColor}
                >
                  Clear color
                </Button>
              </div>
            </div>

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

            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">Aspect ratio</p>
                <p className="text-muted-foreground text-xs">
                  Match results to common display and crop shapes.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {BROWSE_ASPECT_RATIO_OPTIONS.map((option) => {
                  const isSelected = option.value === (selectedAspectRatio ?? 'any');

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant={isSelected ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() =>
                        onAspectRatioChange(option.value === 'any' ? undefined : option.value)
                      }
                      aria-pressed={isSelected}
                    >
                      {option.value === 'device'
                        ? getAspectRatioLabel(option.value, deviceAspectRatioPreset)
                        : option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {!isOpen && (selectedColor || selectedFormat || selectedAspectRatio) ? (
          <div className="flex flex-wrap gap-2">
            {selectedColor ? (
              <Badge variant="outline">
                <span
                  data-testid="active-color-dot"
                  aria-hidden="true"
                  className="size-2 rounded-full border border-black/10"
                  style={{ backgroundColor: selectedColor }}
                />
                {getColorBadgeLabel(selectedColor)}
              </Badge>
            ) : null}
            {selectedFormat ? (
              <Badge variant="outline">{getFormatBadgeLabel(selectedFormat)}</Badge>
            ) : null}
            {selectedAspectRatio ? (
              <Badge variant="outline">
                {getAspectRatioBadgeLabel(selectedAspectRatio, deviceAspectRatioPreset)}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function useDeviceAspectRatioPreset(): BrowseAspectRatioPresetValue {
  const [deviceAspectRatioPreset, setDeviceAspectRatioPreset] = useState<BrowseAspectRatioPresetValue>(
    () => getDeviceAspectRatioPreset(),
  );

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
