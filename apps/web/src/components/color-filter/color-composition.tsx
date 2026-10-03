import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  compositionLayout,
  moveColorBoundary,
  colorBoundaryMaximum,
  type ColorPreference,
  colorPreferenceAppearance,
  colorPreferenceKey,
  colorPreferenceLabel,
  MATCH_LABELS,
} from '@/features/browse';

export function ColorComposition({
  value,
  onChange,
  onEdit,
  onEmpty,
}: {
  value: readonly ColorPreference[];
  onChange: (value: ColorPreference[]) => void;
  onEdit: (index: number, button: HTMLButtonElement) => void;
  onEmpty: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{
    x: number;
    index: number;
    scale: number;
    original: readonly ColorPreference[];
    updated: ColorPreference[];
  } | null>(null);
  const [preview, setPreview] = useState<readonly ColorPreference[] | null>(null);
  const targets = preview ?? value;
  const { weights, free, scale } = compositionLayout(targets);
  return (
    <div ref={track} className="color-composition" aria-label={undefined}>
      <div className="color-composition-segments">
        {targets.map((target, index) => {
          const label = colorPreferenceLabel(target);
          return (
            <div
              key={colorPreferenceKey(target)}
              className="color-composition-segment"
              style={{ flexGrow: weights[index], background: colorPreferenceAppearance(target) }}
            >
              <button
                type="button"
                ref={(button) => {
                  const key = colorPreferenceKey(target);
                  if (button) editButtons.current.set(key, button);
                  else editButtons.current.delete(key);
                }}
                className="color-composition-edit"
                aria-label={`Edit ${label}`}
                title={`${label}${target.percent === undefined ? '' : ` · ${target.percent}%`} · ${MATCH_LABELS[target.quality]}`}
                onClick={(event) => onEdit(index, event.currentTarget)}
              >
                <span>{label}</span>
                {target.percent !== undefined && <small>{target.percent}%</small>}
              </button>
              <button
                type="button"
                className="color-composition-remove"
                aria-label={`Remove ${label}`}
                onClick={() => {
                  const neighbor = value[index + 1] ?? value[index - 1];
                  const next = neighbor
                    ? editButtons.current.get(colorPreferenceKey(neighbor))
                    : undefined;
                  onChange(value.filter((_, i) => i !== index));
                  if (next) next.focus();
                  else onEmpty();
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {free > 0 && <div className="color-composition-free" style={{ flexGrow: free }} />}
      </div>
      {targets.map((target, index) => {
        const percent = target.percent;
        if (percent === undefined) return null;
        const position = weights.slice(0, index + 1).reduce((sum, weight) => sum + weight, 0);
        const maximum = colorBoundaryMaximum(targets, index);
        return (
          <button
            key={`boundary-${colorPreferenceKey(target)}`}
            type="button"
            role="slider"
            className="color-composition-handle"
            style={{ left: `${position}%` }}
            aria-label={`Amount boundary for ${colorPreferenceLabel(target)}`}
            aria-valuemin={0}
            aria-valuemax={maximum}
            aria-valuenow={target.percent}
            aria-valuetext={`${target.percent}%`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, index, scale, original: value, updated: [...value] };
            }}
            onPointerMove={(e) => {
              const start = drag.current,
                rect = track.current?.getBoundingClientRect();
              if (!start || !rect || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
              start.updated = moveColorBoundary(
                start.original,
                start.index,
                (start.original[start.index].percent ?? 0) +
                  (((e.clientX - start.x) / rect.width) * 100) / start.scale
              );
              setPreview(start.updated);
            }}
            onPointerUp={() => {
              if (drag.current) {
                onChange(drag.current.updated);
                drag.current = null;
                setPreview(null);
              }
            }}
            onPointerCancel={() => {
              drag.current = null;
              setPreview(null);
            }}
            onKeyDown={(e) => {
              const amount =
                e.key === 'ArrowRight'
                  ? percent + 10
                  : e.key === 'ArrowLeft'
                    ? percent - 10
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? maximum
                        : undefined;
              if (amount !== undefined) {
                e.preventDefault();
                onChange(moveColorBoundary(value, index, amount));
              }
            }}
          >
            <span />
          </button>
        );
      })}
    </div>
  );
}
