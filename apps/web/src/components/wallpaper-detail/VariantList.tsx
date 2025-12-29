import { Download, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Variant } from '@/lib/graphql/types';
import { downloadVariant, formatFileSize } from '@/lib/utils/wallpaper';

interface VariantListProps {
  variants: Variant[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Displays a list of all available wallpaper variants with actions.
 */
export function VariantList({ variants, selectedIndex, onSelect }: VariantListProps) {
  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Available Variants</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="space-y-0">
            {variants.map((variant, index) => {
              const isSelected = index === selectedIndex;
              const isOriginal = index === 0;
              const formatName = variant.format.split('/')[1]?.toUpperCase() || 'UNKNOWN';

              return (
                <li key={`${variant.url}-${index}`}>
                  {index > 0 && <Separator className="my-2.5" decorative={false} />}

                  <div className="flex items-center justify-between gap-2">
                    {/* Variant info */}
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{formatName}</Badge>
                        {isOriginal && <Badge variant="default">Original</Badge>}
                        {isSelected && <Badge variant="outline">Viewing</Badge>}
                      </div>

                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span>
                          {variant.width}×{variant.height}
                        </span>
                        <span>•</span>
                        <span>{formatFileSize(variant.fileSizeBytes)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {/* Set as Display button */}
                      {!isSelected && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onSelect(index)}
                              aria-label={`Set ${variant.width}×${variant.height} as display`}
                            >
                              <Eye className="h-4 w-4" />
                              <span className="sr-only">Set as Display</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Set as Display</p>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Download button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadVariant(variant)}
                            aria-label={`Download ${variant.width}×${variant.height}`}
                          >
                            <Download className="h-4 w-4" />
                            <span className="sr-only">Download</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Download {formatName} - {variant.width}×{variant.height}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
