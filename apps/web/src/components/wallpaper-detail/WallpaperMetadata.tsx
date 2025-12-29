import { Copy, Keyboard } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import type { Wallpaper } from '@/lib/graphql/types';
import { formatAspectRatio, formatDate, formatFileSize, truncateId } from '@/lib/utils/wallpaper';
import { VariantList } from './VariantList';

interface WallpaperMetadataProps {
  wallpaper: Wallpaper;
  selectedVariantIndex: number;
  onVariantSelect: (index: number) => void;
}

/**
 * Displays comprehensive wallpaper metadata in a scrollable panel.
 */
export function WallpaperMetadata({
  wallpaper,
  selectedVariantIndex,
  onVariantSelect,
}: WallpaperMetadataProps) {
  const selectedVariant = wallpaper.variants[selectedVariantIndex];
  const formatName = selectedVariant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(wallpaper.wallpaperId);
      toast.success('ID copied to clipboard');
    } catch {
      toast.error('Failed to copy ID');
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Wallpaper Details</h2>
      </div>
      {/* Information Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          {/* Wallpaper ID */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Wallpaper ID</div>
              <div className="font-mono text-sm">{truncateId(wallpaper.wallpaperId)}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleCopyId} aria-label="Copy wallpaper ID">
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <Separator />

          {/* Upload Date */}
          <div>
            <div className="text-sm text-muted-foreground">Uploaded</div>
            <div className="text-sm">{formatDate(wallpaper.uploadedAt)}</div>
          </div>

          <Separator />

          {/* Updated Date */}
          <div>
            <div className="text-sm text-muted-foreground">Updated</div>
            <div className="text-sm">{formatDate(wallpaper.updatedAt)}</div>
          </div>

          <Separator />

          {/* User ID */}
          <div>
            <div className="text-sm text-muted-foreground">User ID</div>
            <div className="font-mono text-sm">{wallpaper.userId}</div>
          </div>
        </CardContent>
      </Card>

      {/* Current Display Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Current Display</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">
              {selectedVariant.width}×{selectedVariant.height}
            </Badge>
            <Badge variant="secondary">{formatName}</Badge>
            <Badge variant="secondary">{formatAspectRatio(selectedVariant.aspectRatio)}</Badge>
            <Badge variant="secondary">{formatFileSize(selectedVariant.fileSizeBytes)}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Variant List */}
      <VariantList
        variants={wallpaper.variants}
        selectedIndex={selectedVariantIndex}
        onSelect={onVariantSelect}
      />

      {/* Keyboard Shortcuts */}
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <Keyboard className="h-4 w-4" />
          <span>Keyboard shortcuts</span>
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Toggle panel</span>
            <Kbd>I</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Download</span>
            <Kbd>D</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Share</span>
            <Kbd>S</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Close panel</span>
            <Kbd>Esc</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Prev variant</span>
            <Kbd>←</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Next variant</span>
            <Kbd>→</Kbd>
          </div>
        </div>
      </details>
    </div>
  );
}
