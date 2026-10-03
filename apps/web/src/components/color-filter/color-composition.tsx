import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  type ColorPreference,
  colorPreferenceAppearance,
  colorPreferenceKey,
  colorPreferenceLabel,
  MATCH_LABELS,
} from '@/features/browse';

function layout(value: readonly ColorPreference[]) {
  const used = value.reduce((sum, target) => sum + (target.percent ?? 0), 0);
  const unspecified = value.filter((target) => target.percent === undefined).length;
  const zeros = value.filter((target) => target.percent === 0).length;
  const share = unspecified ? Math.max((100 - used) / unspecified, 12) : 0;
  const free = unspecified ? 0 : 100 - used;
  const zeroWidth = Math.min(8, 100 / Math.max(value.length, 1));
  const flexible = value.reduce((sum, target) => sum + (target.percent ?? share), 0) + free;
  const scale = flexible > 0 ? (100 - zeros * zeroWidth) / flexible : 1;
  return {
    weights: value.map((target) =>
      target.percent === 0 ? zeroWidth : (target.percent ?? share) * scale
    ),
    free: free * scale,
    scale,
  };
}
function moveBoundary(
  value: readonly ColorPreference[],
  index: number,
  requested: number
): ColorPreference[] {
  const target = value[index];
  if (target?.percent === undefined) return [...value];
  const nextIndex = value.findIndex((target, i) => i > index && target.percent !== undefined);
  const next = nextIndex < 0 ? undefined : value[nextIndex];
  const used = value.reduce((sum, target) => sum + (target.percent ?? 0), 0);
  const pair = target.percent + (next?.percent ?? 0);
  const amount = Math.max(0, Math.min(pair + 100 - used, Math.round(requested / 10) * 10));
  return value.map((target, i) =>
    i === index
      ? { ...target, percent: amount }
      : i === nextIndex
        ? { ...target, percent: Math.max(0, pair - amount) }
        : target
  );
}
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
  const { weights, free, scale } = layout(targets);
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
        const next = targets.find((target, i) => i > index && target.percent !== undefined);
        const remaining = 100 - targets.reduce((sum, target) => sum + (target.percent ?? 0), 0);
        const maximum = percent + (next?.percent ?? 0) + remaining;
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
              start.updated = moveBoundary(
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
                onChange(moveBoundary(value, index, amount));
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
