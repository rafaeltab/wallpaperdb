import { useEffect, useEffectEvent, useRef } from 'react';
import {
  initialPictureCrop,
  movePictureCrop,
  zoomPictureCrop,
  wheelPictureCrop,
  type PictureCrop,
  type PictureDimensions,
} from '@/features/picture-editor';
import { Button } from '@/components/ui/button';

export function ProfilePictureCrop({
  source,
  crop,
  previewUrl,
  disabled,
  onChange,
}: {
  source: PictureDimensions;
  crop: PictureCrop;
  previewUrl: string;
  disabled: boolean;
  onChange: (crop: PictureCrop) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const viewport = useRef<HTMLFieldSetElement>(null);
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (disabled) return;
    event.preventDefault();
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? (viewport.current?.clientHeight ?? 0)
          : 1;
    onChange(wheelPictureCrop(crop, source, event.deltaY * unit));
  });
  useEffect(() => {
    const element = viewport.current;
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div className="space-y-3">
      <fieldset
        ref={viewport}
        aria-label="Picture crop"
        className="relative mx-auto aspect-square w-full max-w-64 touch-none overflow-hidden rounded-full border bg-muted cursor-grab"
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (disabled || !previous || previous.pointer !== event.pointerId) return;
          const width = event.currentTarget.getBoundingClientRect().width;
          if (!width) return;
          onChange(
            movePictureCrop(
              crop,
              source,
              ((event.clientX - previous.x) * crop.size) / width,
              ((event.clientY - previous.y) * crop.size) / width
            )
          );
          drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <img
          src={previewUrl}
          alt="Selected avatar"
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: `${(source.width / crop.size) * 100}%`,
            height: `${(source.height / crop.size) * 100}%`,
            left: `${(-crop.x / crop.size) * 100}%`,
            top: `${(-crop.y / crop.size) * 100}%`,
          }}
        />
      </fieldset>
      <fieldset aria-label="Move picture" className="flex flex-wrap justify-center gap-2">
        {[
          { label: 'Left', x: -1, y: 0 },
          { label: 'Right', x: 1, y: 0 },
          { label: 'Up', x: 0, y: -1 },
          { label: 'Down', x: 0, y: 1 },
        ].map(({ label, x, y }) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Move picture ${label.toLowerCase()}`}
            disabled={disabled}
            onClick={() =>
              onChange(movePictureCrop(crop, source, (x * crop.size) / 10, (y * crop.size) / 10))
            }
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <label htmlFor="picture-zoom" className="text-sm">
          Zoom
        </label>
        <input
          id="picture-zoom"
          type="range"
          className="min-w-0 flex-1"
          min={1}
          max={crop.maxZoom}
          step={0.01}
          value={crop.zoom}
          disabled={disabled || crop.maxZoom === 1}
          aria-describedby={crop.lowResolution ? 'picture-quality' : undefined}
          onChange={(event) => onChange(zoomPictureCrop(crop, source, Number(event.target.value)))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(initialPictureCrop(source))}
        >
          Reset
        </Button>
      </div>
      {crop.lowResolution && (
        <p id="picture-quality" className="text-sm text-muted-foreground">
          This picture is smaller than 64 pixels. It may look blurry. Further zoom is disabled, but
          you can still apply it.
        </p>
      )}
    </div>
  );
}
