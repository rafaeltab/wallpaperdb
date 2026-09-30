import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ImageOff, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBrowseFilterPanel } from '@/components/browse-filter-panel-context';
import { ColorFilter } from '@/components/color-filter';
import { GraphQLError } from '@/components/graphql-error';
import { WallpaperGridSkeleton } from '@/components/grid';
import { LoadMoreTrigger } from '@/components/LoadMoreTrigger';
import { ProfileFilter } from '@/components/profile/profile-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WallpaperGrid } from '@/components/WallpaperGrid';
import { useWallpaperInfiniteQuery } from '@/hooks/useWallpaperInfiniteQuery';
import {
  BROWSE_ASPECT_RATIO_OPTIONS,
  BROWSE_FORMAT_OPTIONS,
  type BrowseAspectRatioPresetValue,
  type BrowseAspectRatioValue,
  type BrowseFormatValue,
  type BrowseSearchState,
  buildWallpaperFilter,
  buildWallpaperSort,
  getAspectRatioBadgeLabel,
  getAspectRatioFilterValue,
  getAspectRatioLabel,
  getFormatBadgeLabel,
  parseBrowseSearch,
  resolveClosestAspectRatioPreset,
} from '@/lib/browse-filters';
import {
  type ColorPreference,
  colorPreferenceAppearance,
  colorPreferenceLabel,
} from '@/lib/color-preferences';

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: parseBrowseSearch,
});

export function HomePage() {
  const { after, color, colors, format, aspectRatio, profileId } = Route.useSearch();
  const navigate = useNavigate();
  const { isOpen, homeNavigationVersion } = useBrowseFilterPanel();
  const deviceAspectRatioPreset = useDeviceAspectRatioPreset();
  const preferences = useMemo<readonly ColorPreference[]>(
    () => colors ?? (color ? [{ color: color.toUpperCase(), quality: 'FAVORITE' }] : []),
    [colors, color]
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    error: queryError,
    failureReason,
    isFetching,
    refetch,
    hasNextPage,
    fetchNextPage,
  } = useWallpaperInfiniteQuery({
    initialCursor: after ?? null,
    filter: buildWallpaperFilter(
      format,
      getAspectRatioFilterValue(aspectRatio, deviceAspectRatioPreset),
      profileId
    ),
    sort: buildWallpaperSort(colors ?? color),
  });

  const error = failureReason ?? queryError;
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
    (next: ColorPreference[]) => {
      void navigate({
        to: '/',
        search: (previous: BrowseSearchState) => ({
          ...previous,
          after: undefined,
          color: undefined,
          colors: next.length ? next : undefined,
        }),
      });
    },
    [navigate]
  );
  const wallpapers = data?.pages.flatMap((page) => page.edges.map((edge) => edge.node)) ?? [];

  return (
    <div>
      <BrowseFilterPanel
        key={homeNavigationVersion}
        isOpen={isOpen}
        preferences={preferences}
        onColorChange={handleColorChange}
        selectedFormat={format}
        selectedAspectRatio={aspectRatio}
        selectedProfileId={profileId}
        onProfileChange={handleProfileChange}
        deviceAspectRatioPreset={deviceAspectRatioPreset}
        onFormatChange={handleFormatChange}
        onAspectRatioChange={handleAspectRatioChange}
      />
      {error && wallpapers.length === 0 ? (
        <div className="max-w-2xl mx-auto px-4 py-12">
          <GraphQLError
            error={error}
            retry={refetch}
            retrying={isFetching}
            title="Failed to load wallpapers"
          />
        </div>
      ) : isLoading ? (
        <LoadingState />
      ) : wallpapers.length === 0 ? (
        <EmptyState
          hasCursor={!!after}
          hasFilters={Boolean(profileId || format || aspectRatio || preferences.length)}
        />
      ) : (
        <>
          <WallpaperGrid wallpapers={wallpapers} isLoadingMore={isFetchingNextPage} />
          {error ? (
            <div className="max-w-2xl mx-auto px-4 py-6">
              <GraphQLError
                error={error}
                retry={isFetchNextPageError || isFetchingNextPage ? fetchNextPage : refetch}
                retrying={isFetching}
                title="Could not load more wallpapers"
              />
            </div>
          ) : (
            <LoadMoreTrigger
              onLoadMore={handleLoadMore}
              hasMore={hasNextPage ?? false}
              isLoading={isFetchingNextPage}
            />
          )}
        </>
      )}
    </div>
  );
}

function BrowseFilterPanel({
  preferences,
  onColorChange,
  isOpen,
  selectedFormat,
  selectedAspectRatio,
  selectedProfileId,
  onProfileChange,
  deviceAspectRatioPreset,
  onFormatChange,
  onAspectRatioChange,
}: {
  preferences: readonly ColorPreference[];
  onColorChange: (value: ColorPreference[]) => void;
  isOpen: boolean;
  selectedFormat?: BrowseFormatValue;
  selectedAspectRatio?: BrowseAspectRatioValue;
  selectedProfileId?: string;
  onProfileChange: (profileId?: string) => void;
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue;
  onFormatChange: (format?: BrowseFormatValue) => void;
  onAspectRatioChange: (aspectRatio?: BrowseAspectRatioValue) => void;
}) {
  return (
    <section className="border-b bg-muted/20 px-4 py-3">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        {isOpen || selectedProfileId ? (
          <ProfileFilter
            profileId={selectedProfileId}
            onChange={onProfileChange}
            collapsed={!isOpen}
          />
        ) : null}
        {isOpen ? (
          <div className="flex flex-col gap-4">
            <ColorFilter value={preferences} onChange={onColorChange} />

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

        {!isOpen && (preferences.length || selectedFormat || selectedAspectRatio) ? (
          <div className="flex flex-wrap gap-2">
            {preferences.map((target, index) => (
              <Badge key={target.color ?? target.name} variant="outline">
                <span
                  data-testid={index === 0 ? 'active-color-dot' : undefined}
                  aria-hidden="true"
                  className="size-2 rounded-full border border-black/10"
                  style={{ background: colorPreferenceAppearance(target) }}
                />
                Color: {colorPreferenceLabel(target)}
                {target.percent !== undefined && ` · ${target.percent}%`}
              </Badge>
            ))}
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
