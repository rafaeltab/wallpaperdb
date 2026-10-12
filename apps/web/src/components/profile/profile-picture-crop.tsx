import { useEffect, useEffectEvent, useRef } from 'react';
import {
  initialPictureCrop,
  movePictureCrop,
  zoomPictureCrop,
  wheelPictureCrop,
  pinchPictureCrop,
  type PictureCrop,
  type PictureDimensions,
} from '@/features/picture-editor';
import { RotateCcw } from 'lucide-react';
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
  const apertureFraction = 0.75;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ crop: PictureCrop; distance: number } | null>(null);
  function distance() {
    const [first, second] = pointers.current.values();
    return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0;
  }
  function release(pointerId: number) {
    pointers.current.delete(pointerId);
    pinch.current = null;
  }
  const viewport = useRef<HTMLFieldSetElement>(null);
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (disabled) return;
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? (viewport.current?.clientHeight ?? 0)
          : 1;
    const next = wheelPictureCrop(crop, source, event.deltaY * unit);
    if (next.zoom === crop.zoom) return;
    event.preventDefault();
    onChange(next);
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
        aria-describedby="picture-crop-help"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className="relative mx-auto aspect-square w-full max-w-[55dvh] touch-none overflow-hidden rounded-xl border bg-muted cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
          const directions: Record<string, { x: number; y: number }> = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
          };
          const direction = Object.hasOwn(directions, event.key) ? directions[event.key] : undefined;
          if (!direction) return;
          event.preventDefault();
          onChange(
            movePictureCrop(
              crop,
              source,
              (direction.x * crop.size) / 10,
              (direction.y * crop.size) / 10
            )
          );
        }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) pinch.current = { crop, distance: distance() };
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (disabled || !previous) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size > 1) {
            const start = pinch.current;
            if (start) onChange(pinchPictureCrop(start.crop, source, start.distance, distance()));
            return;
          }
          const width = event.currentTarget.getBoundingClientRect().width * apertureFraction;
          if (!width) return;
          onChange(
            movePictureCrop(
              crop,
              source,
              ((event.clientX - previous.x) * crop.size) / width,
              ((event.clientY - previous.y) * crop.size) / width
            )
          );
        }}
        onPointerUp={(event) => release(event.pointerId)}
        onPointerCancel={(event) => release(event.pointerId)}
        onLostPointerCapture={(event) => release(event.pointerId)}
      >
        <img
          src={previewUrl}
          alt="Selected avatar"
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            width: `${(source.width / crop.size) * apertureFraction * 100}%`,
            height: `${(source.height / crop.size) * apertureFraction * 100}%`,
            left: `${((1 - apertureFraction) / 2 - (crop.x / crop.size) * apertureFraction) * 100}%`,
            top: `${((1 - apertureFraction) / 2 - (crop.y / crop.size) * apertureFraction) * 100}%`,
          }}
        />
        <div
          aria-hidden="true"
          data-testid="picture-crop-boundary"
          className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_999px_rgb(0_0_0_/0.55)]"
          style={{ inset: `${(1 - apertureFraction) * 50}%` }}
        />
      </fieldset>
      <p id="picture-crop-help" className="sr-only">
        Drag the picture or use the arrow keys to move it. Use the Zoom slider, mouse wheel, or
        pinch to resize it.
      </p>
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
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={() => onChange(initialPictureCrop(source))}
          aria-label="Reset crop"
        >
          <RotateCcw className="size-4" />
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
