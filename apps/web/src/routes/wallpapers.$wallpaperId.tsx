import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, ChevronUp, Download, PanelRight, Share } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  WallpaperDetailSkeleton,
  WallpaperDisplay,
  WallpaperMetadata,
} from '@/components/wallpaper-detail';
import { useMediaQuery } from '@/hooks/use-media-query';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useWallpaperQuery } from '@/hooks/useWallpaperQuery';
import { downloadVariant, formatFileSize } from '@/lib/utils/wallpaper';

export function WallpaperDetailPage() {
  const { wallpaperId } = useParams({ strict: false }) as { wallpaperId: string };
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 1024px)');

  // Panel state (persisted to localStorage)
  const [isPanelOpen, setIsPanelOpen] = usePersistentState('wallpaper-detail-panel-open', true);

  // Variant selection (always start with original at index 0)
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  // Image loading state
  const [isImageLoading, setIsImageLoading] = useState(true);

  // Data fetching
  const { data: wallpaper, isLoading, error } = useWallpaperQuery(wallpaperId);

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
    const url = window.location.href;

    // Try native share on mobile first
    if (isMobile && navigator.share) {
      try {
        await navigator.share({
          title: 'Wallpaper',
          text: 'Check out this wallpaper',
          url,
        });
        return;
      } catch {
        // User cancelled or share failed, fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  }, [isMobile]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'i':
          event.preventDefault();
          setIsPanelOpen((prev) => !prev);
          break;
        case 'd':
          event.preventDefault();
          if (wallpaper?.variants[selectedVariantIndex]) {
            downloadVariant(wallpaper.variants[selectedVariantIndex]);
          }
          break;
        case 's':
          event.preventDefault();
          handleShare();
          break;
        case 'escape':
          if (isPanelOpen) {
            event.preventDefault();
            setIsPanelOpen(false);
          }
          break;
        case 'arrowleft':
          event.preventDefault();
          if (wallpaper && selectedVariantIndex > 0) {
            setSelectedVariantIndex((prev) => prev - 1);
          }
          break;
        case 'arrowright':
          event.preventDefault();
          if (wallpaper && selectedVariantIndex < wallpaper.variants.length - 1) {
            setSelectedVariantIndex((prev) => prev + 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, setIsPanelOpen, wallpaper, selectedVariantIndex, handleShare]);

  // Handle download from dropdown
  const handleDownloadVariant = (variantIndex: number) => {
    if (wallpaper?.variants[variantIndex]) {
      downloadVariant(wallpaper.variants[variantIndex]);
    }
  };

  // Loading state
  if (isLoading) {
    return <WallpaperDetailSkeleton />;
  }

  // 404 Not Found error
  if (!wallpaper) {
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

  // Network or validation error
  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertTitle>Error loading wallpaper</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  const selectedVariant = wallpaper.variants[selectedVariantIndex];
  const formatName = selectedVariant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/' })}
            aria-label="Back to gallery"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Wallpaper Details</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          aria-label={isPanelOpen ? 'Close panel' : 'Open panel'}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      </header>

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-4">
        {/* Wallpaper display */}
        <div className="flex h-full max-h-[70vh] w-full max-w-5xl items-center justify-center">
          <WallpaperDisplay
            variant={selectedVariant}
            isLoading={isImageLoading}
            onLoadComplete={() => setIsImageLoading(false)}
            showIndicator={false}
            isOriginal={selectedVariantIndex === 0}
          />
        </div>

        {/* Viewing indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{formatName}</Badge>
          <span>
            {selectedVariant.width}×{selectedVariant.height}
          </span>
          {selectedVariantIndex === 0 && <Badge variant="default">Original</Badge>}
        </div>

        {/* Action bar */}
        <div className="flex gap-2">
          {/* Download dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Download className="mr-2 h-4 w-4" />
                Download original
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
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
      </main>

      {/* Mobile peek indicator */}
      {isMobile && !isPanelOpen && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
          <Button variant="secondary" onClick={() => setIsPanelOpen(true)} className="shadow-lg">
            <ChevronUp className="mr-2 h-4 w-4" />
            View Details
          </Button>
        </div>
      )}

      {/* Metadata panel */}
      <Sheet open={isPanelOpen} onOpenChange={setIsPanelOpen}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile ? 'h-[85vh]' : 'w-full sm:max-w-md lg:max-w-lg'}
        >
          <WallpaperMetadata
            wallpaper={wallpaper}
            selectedVariantIndex={selectedVariantIndex}
            onVariantSelect={setSelectedVariantIndex}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// TanStack Router file-based route registration
export const Route = createFileRoute('/wallpapers/$wallpaperId')({
  component: WallpaperDetailPage,
});
