// Throwaway #258 prototype D: compact device rows expand into one rendition modal.
// Shares simulated Media contracts with A/B/C. No generation policy or real downloads.
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ChevronDown, Download, Expand, Monitor, Smartphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  combinations,
  defaultRequest,
  resolve,
  statusText,
  type Asset,
  type Request,
} from './renditions-model.prototype';
import './expanding-download.prototype.css';

const groups = [
  {
    name: 'Desktop',
    icon: Monitor,
    sizes: ['1920x1080', '2560x1440', '3840x2160'],
    more: ['1920x1200', '2560x1600', '3840x2400', '5120x2880'],
  },
  {
    name: 'Ultrawide',
    icon: Monitor,
    sizes: ['2560x1080', '3440x1440', '5120x1440'],
    more: ['3840x1600', '5120x2160'],
  },
  {
    name: 'Phone',
    icon: Smartphone,
    sizes: ['1080x1920', '1080x2400', '1440x3200'],
    more: ['1170x2532', '1290x2796'],
  },
];
const gamutName = (value?: string) =>
  ({ srgb: 'sRGB', p3: 'Display P3', rec2020: 'Rec.2020' })[value || ''] || 'Unknown gamut';
const sizeName = (value: string) => value.replace('x', ' × ');

function Field({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[70]">
          {options.map(([key, title]) => (
            <SelectItem key={key} value={key}>
              {title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function ExpandingDownload({
  asset,
  onOriginal,
  outage,
  response,
  columns = false,
}: {
  asset: Asset;
  onOriginal: () => void;
  outage: boolean;
  response: string;
  columns?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [request, setRequest] = useState(() => defaultRequest(asset));
  const [mode, setMode] = useState('rendition');
  const [custom, setCustom] = useState(false);
  const [receipt, setReceipt] = useState('');
  const result = resolve(asset, request);
  const requestedRatio = Number(request.width) / Number(request.height);
  const sourceRatio = asset.width && asset.height ? asset.width / asset.height : undefined;
  const aspectMismatch =
    mode !== 'original' &&
    sourceRatio !== undefined &&
    Number(request.width) > 0 &&
    Number(request.height) > 0 &&
    Number.isFinite(requestedRatio) &&
    Math.max(requestedRatio, sourceRatio) / Math.min(requestedRatio, sourceRatio) > 1.02;
  const largerThanOriginal =
    mode !== 'original' &&
    asset.width !== undefined &&
    asset.height !== undefined &&
    (Number(request.width) > asset.width ||
      Number(request.height) > asset.height ||
      (result.width !== undefined && result.width > asset.width) ||
      (result.height !== undefined && result.height > asset.height));
  const tradeoffs =
    mode === 'original'
      ? []
      : [
          asset.range === 'hdr' && request.range === 'sdr' ? 'Converted to SDR' : '',
          asset.motion === 'animated' && request.motion === 'static' ? 'Still frame' : '',
          asset.alpha && request.transparency !== 'preserve' ? 'Transparency removed' : '',
          request.fit === 'cover' ? 'Center cropped' : request.fit === 'fill' ? 'Stretched' : '',
          result.encoding && asset.depth && result.encoding.depth < asset.depth
            ? `${result.encoding.depth}-bit output`
            : '',
        ].filter(Boolean);
  const selected = `${request.width}x${request.height}`;
  const deviceSize = `${Math.round(screen.width * devicePixelRatio)}x${Math.round(screen.height * devicePixelRatio)}`;
  const set = (key: keyof Request, value: string) => {
    setRequest({ ...request, [key]: value });
    setReceipt('');
  };
  const chooseSize = (size: string) => {
    const [width, height] = size.split('x');
    setRequest({ ...request, width, height });
    setMode('rendition');
    setCustom(false);
    setReceipt('');
  };
  const colorValue =
    request.range === 'preserve' && request.gamut === 'preserve'
      ? 'original'
      : `${request.range}:${request.gamut}`;
  const colors: [string, string][] = [
    [
      'original',
      `${asset.range?.toUpperCase() || 'Unknown range'} · ${gamutName(asset.gamut)} (original)`,
    ],
    ...Array.from(new Set(combinations(asset).map((c) => `${c.range}:${c.gamut}`)))
      .filter((v) => v !== `${asset.range}:${asset.gamut}`)
      .map((v) => {
        const [range, gamut] = v.split(':');
        return [v, `${range.toUpperCase()} · ${gamutName(gamut)}`] satisfies [string, string];
      }),
  ];
  if (!colors.some(([v]) => v === colorValue))
    colors.push([colorValue, `${request.range.toUpperCase()} · ${gamutName(request.gamut)}`]);
  const formats = Array.from(
    new Set([request.format, ...combinations(asset).map((c) => c.format)])
  );
  const send = () => {
    if (mode === 'original') {
      onOriginal();
      return;
    }
    if (result.error) return;
    if (outage || response === '503') setReceipt('Temporarily unavailable. Retry in 5 seconds.');
    else if (response !== 'normal')
      setReceipt(
        response === '404'
          ? 'Source unavailable.'
          : response === 'limits'
            ? 'Size exceeds current limits.'
            : 'This combination is unavailable.'
      );
    else {
      setReceipt('Simulated download ready.');
      toast.success('Simulated download', { description: result.filename });
    }
  };
  const summary =
    mode === 'original'
      ? `${asset.width ? `${asset.width} × ${asset.height} · ` : ''}${asset.format.toUpperCase()} · Original`
      : result.error
        ? asset.readiness === 'ready'
          ? result.problem === '422 output-limits'
            ? 'Size exceeds Media limits.'
            : result.problem?.startsWith('400')
              ? 'Enter positive whole pixels.'
              : 'This combination is unavailable.'
          : statusText[asset.readiness]
        : `${result.width} × ${result.height} · ${result.encoding?.format.toUpperCase()}`;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setExpanded(false);
      }}
    >
      <Dialog.Trigger asChild>
        <Button>
          <Download className="size-4" />
          Download
          <ChevronDown className="size-4" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="download-d-backdrop" data-expanded={expanded} />
        <Dialog.Content
          className="download-d-panel border bg-background text-foreground shadow-2xl"
          data-columns={columns}
          data-expanded={expanded}
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="text-sm font-semibold">Download</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close download">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Button
                variant={mode === 'original' ? 'secondary' : 'outline'}
                aria-pressed={mode === 'original'}
                className="h-auto justify-start px-3 py-2"
                onClick={() => {
                  setMode('original');
                  setReceipt('');
                }}
              >
                <span className="text-left">
                  <span className="block">Original</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {asset.width ? `${asset.width} × ${asset.height}` : 'Exact source file'}
                  </span>
                </span>
              </Button>
              <Button
                variant="outline"
                disabled={asset.readiness !== 'ready'}
                className="h-auto justify-start px-3 py-2"
                onClick={() => chooseSize(deviceSize)}
              >
                <Monitor className="size-4" />
                <span className="text-left">
                  <span className="block">Current device</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {sizeName(deviceSize)}
                  </span>
                </span>
              </Button>
            </div>
            <div className={columns ? 'download-e-device-columns' : 'space-y-3'}>
              {groups.map((group) => (
                <div key={group.name} className="download-d-size-row">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <group.icon className="size-3.5" />
                    {group.name}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {group.sizes.map((size) => (
                      <Button
                        key={size}
                        size="sm"
                        variant={
                          mode !== 'original' && !custom && selected === size
                            ? 'secondary'
                            : 'outline'
                        }
                        className="px-1 text-[11px] tabular-nums"
                        aria-pressed={mode !== 'original' && !custom && selected === size}
                        disabled={asset.readiness !== 'ready'}
                        onClick={() => chooseSize(size)}
                      >
                        {sizeName(size)}
                      </Button>
                    ))}
                    {expanded &&
                      group.more.map((size) => (
                        <Button
                          key={size}
                          size="sm"
                          variant={
                            mode !== 'original' && !custom && selected === size
                              ? 'secondary'
                              : 'outline'
                          }
                          className="px-1 text-[11px] tabular-nums"
                          aria-pressed={mode !== 'original' && !custom && selected === size}
                          disabled={asset.readiness !== 'ready'}
                          onClick={() => chooseSize(size)}
                        >
                          {sizeName(size)}
                        </Button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            {expanded && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <Button
                  variant={custom ? 'secondary' : 'outline'}
                  size="sm"
                  disabled={asset.readiness !== 'ready'}
                  onClick={() => {
                    setCustom(true);
                    setMode('rendition');
                  }}
                >
                  Custom
                </Button>
                {custom && (
                  <>
                    <label className="grid gap-1 text-xs">
                      Width
                      <Input
                        aria-label="Custom width"
                        className="w-28"
                        inputMode="numeric"
                        placeholder="Auto"
                        value={request.width}
                        onChange={(e) => set('width', e.target.value)}
                      />
                    </label>
                    <span className="pb-2 text-muted-foreground">×</span>
                    <label className="grid gap-1 text-xs">
                      Height
                      <Input
                        aria-label="Custom height"
                        className="w-28"
                        inputMode="numeric"
                        placeholder="Auto"
                        value={request.height}
                        onChange={(e) => set('height', e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
            )}
            <fieldset
              disabled={mode === 'original' || asset.readiness !== 'ready'}
              className="mt-4 grid grid-cols-2 gap-3 border-0 p-0 disabled:opacity-45"
            >
              <Field
                label="Color"
                value={colorValue}
                options={colors}
                onChange={(v) => {
                  const [range, gamut] = v === 'original' ? ['preserve', 'preserve'] : v.split(':');
                  setRequest({ ...request, range, gamut });
                  setReceipt('');
                }}
              />
              <Field
                label="Format"
                value={request.format}
                options={formats.map((v) => [v, v === 'jpg' ? 'JPEG' : v.toUpperCase()])}
                onChange={(v) => set('format', v)}
              />
              {expanded && (
                <>
                  <Field
                    label="Fit"
                    value={request.fit}
                    options={[
                      ['contain', 'Fit inside'],
                      ['cover', 'Center crop'],
                      ['fill', 'Stretch'],
                    ]}
                    onChange={(v) => set('fit', v)}
                  />
                  <Field
                    label="Depth"
                    value={request.depth}
                    options={[
                      ['auto', 'Automatic'],
                      ['preserve', 'Original'],
                      ['8', '8 bit'],
                      ['10', '10 bit'],
                      ['12', '12 bit'],
                      ['16', '16 bit'],
                    ]}
                    onChange={(v) => set('depth', v)}
                  />
                  <Field
                    label="Gamut"
                    value={request.gamut}
                    options={[
                      ['preserve', `Original · ${gamutName(asset.gamut)}`],
                      ['srgb', 'sRGB'],
                      ['p3', 'Display P3'],
                      ['rec2020', 'Rec.2020'],
                    ]}
                    onChange={(v) => set('gamut', v)}
                  />
                  {asset.motion === 'animated' && (
                    <Field
                      label="Motion"
                      value={request.motion}
                      options={[
                        ['preserve', 'Animated'],
                        ['static', 'Still frame'],
                      ]}
                      onChange={(v) => set('motion', v)}
                    />
                  )}
                  {asset.alpha && (
                    <Field
                      label="Transparency"
                      value={request.transparency}
                      options={[
                        ['preserve', 'Preserve'],
                        ['background', 'Background'],
                        ['coerce', 'Discard'],
                      ]}
                      onChange={(v) => set('transparency', v)}
                    />
                  )}
                  {asset.alpha && request.transparency === 'background' && (
                    <label className="grid gap-1.5 text-xs">
                      Background
                      <Input
                        aria-label="Background color"
                        value={request.background}
                        onChange={(e) => set('background', e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
            </fieldset>
            {tradeoffs.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">{tradeoffs.join(' · ')}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
            {largerThanOriginal && (
              <p role="status" className="w-full text-xs text-amber-700 dark:text-amber-400">
                This resolution is larger than the original.
                <span className="block text-muted-foreground">
                  Upscaling may make the image look soft or pixelated.
                </span>
              </p>
            )}
            {aspectMismatch && (
              <p role="status" className="w-full text-xs text-amber-700 dark:text-amber-400">
                This aspect ratio doesn't match the original.
                <span className="block text-muted-foreground">
                  {request.fit === 'fill'
                    ? 'The image will be stretched.'
                    : request.fit === 'cover'
                      ? 'The image will be cropped.'
                      : 'Fit inside keeps the original proportions.'}
                </span>
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              <Expand className="size-3.5" />
              {expanded ? 'Show less' : 'Show more'}
            </Button>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <p
                role="status"
                className={`text-right text-[11px] ${mode !== 'original' && result.error ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {receipt || summary}
              </p>
              <Button
                size="sm"
                disabled={mode !== 'original' && Boolean(result.error)}
                onClick={send}
              >
                <Download className="size-3.5" />
                Download
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
