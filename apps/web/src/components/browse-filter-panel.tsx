import type { ReactNode } from 'react';
import { ProfileFilter } from '@/components/profile/profile-filter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  BROWSE_ASPECT_RATIO_OPTIONS,
  BROWSE_FORMAT_OPTIONS,
  type BrowseAspectRatioPresetValue,
  type BrowseAspectRatioValue,
  type BrowseFormatValue,
  getAspectRatioBadgeLabel,
  getAspectRatioLabel,
  getColorBadgeLabel,
  getFormatBadgeLabel,
} from '@/lib/browse-filters';
export function BrowseFilterPanel({
  colorEditor,
  draftColor,
  isOpen,
  selectedColor,
  selectedFormat,
  selectedAspectRatio,
  selectedProfileId,
  onProfileChange,
  deviceAspectRatioPreset,
  onClearColor,
  onColorInputChange,
  onFormatChange,
  onAspectRatioChange,
}: {
  colorEditor?: ReactNode;
  draftColor: string;
  isOpen: boolean;
  selectedColor?: string;
  selectedFormat?: BrowseFormatValue;
  selectedAspectRatio?: BrowseAspectRatioValue;
  selectedProfileId?: string;
  onProfileChange: (profileId?: string) => void;
  deviceAspectRatioPreset: BrowseAspectRatioPresetValue;
  onClearColor: () => void;
  onColorInputChange: (color: string) => void;
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
            {colorEditor ?? (
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
                    {selectedColor ?? 'No color selected'}
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
            )}

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
