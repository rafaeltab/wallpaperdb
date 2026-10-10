import { useWallpaperActions } from '@/features/wallpaper-details/adapters/react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ChevronDown, Download, PanelRight, Share } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraphQLError } from '@/components/graphql-error';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  WallpaperDetailSkeleton,
  WallpaperDisplay,
  WallpaperMetadata,
} from '@/components/wallpaper-detail';
import { detailShortcut, resolveVariantIndex } from '@/features/wallpaper-details';
import { useMediaQuery } from '@/hooks/use-media-query';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useWallpaperQuery } from '@/hooks/useWallpaperQuery';
import { formatFileSize } from '@/lib/utils/wallpaper';

export function WallpaperDetailPage() {
  const { wallpaperId } = useParams({ strict: false }) as { wallpaperId: string };
  return <WallpaperDetailContent key={wallpaperId} wallpaperId={wallpaperId} />;
}

function WallpaperDetailContent({ wallpaperId }: { wallpaperId: string }) {
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const { share, download } = useWallpaperActions(wallpaperId);

  // Panel state (persisted to localStorage)
  const [isPanelOpen, setIsPanelOpen] = usePersistentState('wallpaper-detail-panel-open', true);

  // Variant selection (always start with original at index 0)
  const [selection, setSelection] = useState({ wallpaperId, index: 0 });
  const setSelectedVariantIndex = (index: number) => setSelection({ wallpaperId, index });

  // Image loading state
  const [isImageLoading, setIsImageLoading] = useState(true);

  // Data fetching
  const {
    data: wallpaper,
    isLoading,
    error: queryError,
    failureReason,
    refetch,
    isFetching,
  } = useWallpaperQuery(wallpaperId);
  const error = failureReason ?? queryError;
  const selectedVariantIndex = resolveVariantIndex(
    selection,
    wallpaperId,
    wallpaper?.variants.length ?? 0
  );

  // Auto-collapse panel on mobile
  useEffect(() => {
    if (isMobile) {
      setIsPanelOpen(false);
    }
  }, [isMobile, setIsPanelOpen]);

  // Reset image loading when variant changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: setIsImageLoading is stable from useState
  useEffect(() => {
    setIsImageLoading(true);
  }, [selectedVariantIndex]);

  // Share functionality
  const handleShare = useCallback(async () => {
    if (!wallpaper) return;
    await share();
  }, [wallpaper, share]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const command = detailShortcut(
        event.key,
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable,
        {
          panelOpen: isPanelOpen,
          index: selectedVariantIndex,
          count: wallpaper?.variants.length ?? 0,
        }
      );
      if (!command) return;
      event.preventDefault();
      switch (command.kind) {
        case 'toggle-panel':
          setIsPanelOpen((previous) => !previous);
          break;
        case 'close-panel':
          setIsPanelOpen(false);
          break;
        case 'download':
          if (wallpaper?.variants[selectedVariantIndex])
            void download(wallpaper.variants[selectedVariantIndex]);
          break;
        case 'share':
          void handleShare();
          break;
        case 'select':
          setSelection({ wallpaperId, index: command.index });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPanelOpen,
    setIsPanelOpen,
    wallpaper,
    selectedVariantIndex,
    handleShare,
    wallpaperId,
    download,
  ]);

  // Handle download from dropdown
  const handleDownloadVariant = (variantIndex: number) => {
    if (wallpaper?.variants[variantIndex]) {
      void download(wallpaper.variants[variantIndex]);
    }
  };

  if (error && !wallpaper) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <GraphQLError
            error={error}
            retry={refetch}
            retrying={isFetching}
            title="Error loading wallpaper"
          />
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return <WallpaperDetailSkeleton />;
  }

  // 404 Not Found error
  if (!wallpaper || wallpaper.variants.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Wallpaper not found</AlertTitle>
          <AlertDescription>
            The wallpaper you're looking for doesn't exist or has been removed.
          </AlertDescription>
        </Alert>
        <Link to="/" className="mt-4">
          <Button variant="outline">Back to Gallery</Button>
        </Link>
      </div>
    );
  }

  const selectedVariant = wallpaper.variants[selectedVariantIndex];
  const formatName = selectedVariant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';

  // Portal for header actions
  const headerActionsContainer = document.getElementById('wallpaper-details-header-actions');

  return (
    <>
      {/* Portal panel toggle button into header */}
      {headerActionsContainer &&
        createPortal(
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            aria-label={isPanelOpen ? 'Close panel' : 'Open panel'}
          >
            <PanelRight className="h-4 w-4" />
          </Button>,
          headerActionsContainer
        )}

      {/* Main content - Simplified for debugging */}
      <div className="fixed inset-0 top-[3.5rem] bg-background p-4">
        <div className="h-full flex flex-col gap-3">
          {error ? (
            <GraphQLError
              error={error}
              retry={refetch}
              retrying={isFetching}
              title="Could not refresh wallpaper"
            />
          ) : null}
          {/* Image container - takes all available space, prevents overflow */}
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            <WallpaperDisplay
              variant={selectedVariant}
              isLoading={isImageLoading}
              onLoadComplete={() => setIsImageLoading(false)}
              showIndicator={false}
              isOriginal={selectedVariantIndex === 0}
            />
          </div>

          {/* Bottom controls - should be at bottom */}
          <div className="flex flex-col items-center gap-3 shrink-0">
            {/* Viewing indicator */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{formatName}</Badge>
              <span>
                {selectedVariant.width}×{selectedVariant.height}
              </span>
              {selectedVariantIndex === 0 && <Badge variant="default">Original</Badge>}
            </div>

            {/* Action bar */}
            <div className="flex justify-center gap-2">
              {/* Download dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Download className="mr-2 h-4 w-4" />
                    Download original
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                  <DropdownMenuLabel>Select variant</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {wallpaper.variants.map((variant, index) => {
                    const variantFormat = variant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';
                    const isViewing = index === selectedVariantIndex;
                    const isOriginal = index === 0;

                    return (
                      <DropdownMenuItem
                        key={`${variant.url}-${index}`}
                        onClick={() => handleDownloadVariant(index)}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {variantFormat}
                            </Badge>
                            <span className="text-sm">
                              {variant.width}×{variant.height}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatFileSize(variant.fileSizeBytes)}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            {isOriginal && (
                              <Badge variant="outline" className="text-xs">
                                original
                              </Badge>
                            )}
                            {isViewing && (
                              <Badge variant="outline" className="text-xs">
                                viewing
                              </Badge>
                            )}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Share button */}
              <Button variant="outline" onClick={handleShare}>
                <Share className="mr-2 h-4 w-4" />
                Share
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Metadata panel */}
      <Sheet open={isPanelOpen} onOpenChange={setIsPanelOpen}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={`${isMobile ? 'h-[85vh]' : 'w-full sm:max-w-md lg:max-w-lg'} overflow-y-auto p-6`}
        >
          <SheetTitle className="sr-only">Wallpaper Details</SheetTitle>
          <SheetDescription className="sr-only">
            Wallpaper information, contributor, and available variants.
          </SheetDescription>
          <WallpaperMetadata
            wallpaper={wallpaper}
            selectedVariantIndex={selectedVariantIndex}
            onVariantSelect={setSelectedVariantIndex}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

// TanStack Router file-based route registration
export const Route = createFileRoute('/wallpapers/$wallpaperId')({
  component: WallpaperDetailPage,
});
