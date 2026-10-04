// Throwaway #326 browse chooser. Uses the accepted E device-column layout.
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ChevronDown, Monitor, SlidersHorizontal, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './expanding-download.prototype.css';

export const browsePresetGroups = [
  { name: 'Desktop', icon: Monitor, sizes: ['1920x1080', '2560x1440', '3840x2160'] },
  { name: 'Ultrawide', icon: Monitor, sizes: ['2560x1080', '3440x1440', '5120x1440'] },
  { name: 'Phone', icon: Smartphone, sizes: ['1080x1920', '1080x2400', '1440x3200'] },
];
export const browseAspectRatios = [
  '16/9',
  '16/10',
  '4/3',
  '1/1',
  '9/16',
  '9/20',
  '21/9',
  '43/18',
  '64/27',
  '32/9',
];
const sizeName = (size: string) => size.replace('x', ' × ');

export function BrowseResolutionPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const shapeOnly = value.startsWith('ratio:');
  const group = browsePresetGroups.find((g) => g.sizes.includes(value));
  const choose = (size: string) => {
    onChange(size);
    setOpen(false);
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline">
          <SlidersHorizontal className="size-4" />
          Find wallpapers for{' '}
          {value === 'any'
            ? 'any size and shape'
            : shapeOnly
              ? `${value.slice(6).replace('/', ':')} shape`
              : `${group?.name} · ${sizeName(value)}`}
          <ChevronDown className="size-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="download-d-backdrop" data-expanded={false} />
        <Dialog.Content
          className="download-d-panel border bg-background text-foreground shadow-2xl"
          data-columns={true}
          data-expanded={false}
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-sm font-semibold">Size and shape</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close size and shape chooser">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <Button
              className="mb-4 w-full"
              variant={value === 'any' ? 'secondary' : 'outline'}
              aria-pressed={value === 'any'}
              onClick={() => choose('any')}
            >
              Any size and shape
            </Button>
            <div className="download-e-device-columns">
              {browsePresetGroups.map((group) => (
                <div key={group.name} className="download-d-size-row">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <group.icon className="size-3.5" />
                    {group.name}
                  </span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {group.sizes.map((size) => (
                      <Button
                        key={size}
                        size="sm"
                        variant={value === size ? 'secondary' : 'outline'}
                        className="px-1 text-[11px] tabular-nums"
                        aria-pressed={value === size}
                        onClick={() => choose(size)}
                      >
                        {sizeName(size)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-xs text-muted-foreground">
                Aspect ratio only, any source size
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {browseAspectRatios.map((ratio) => (
                  <Button
                    key={ratio}
                    size="sm"
                    variant={value === `ratio:${ratio}` ? 'secondary' : 'outline'}
                    className="px-1 text-[11px] tabular-nums"
                    aria-pressed={value === `ratio:${ratio}`}
                    onClick={() => choose(`ratio:${ratio}`)}
                  >
                    {ratio.replace('/', ':')}
                  </Button>
                ))}
              </div>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Choose one preset or aspect ratio. Presets require minimum source dimensions.
              Ratio-only choices have no size minimum. Both match verified source shape within 5%.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
