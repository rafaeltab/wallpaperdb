import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { TitleMode } from './geometry-types';
import type { CanvasData } from './view-model';

export interface ProjectCanvasTooltipHandle {
  show(target: Element): void;
  hide(): void;
}

/** Tooltip updates have an independent render lifetime from Project items. */
export const ProjectCanvasTooltip = forwardRef<
  ProjectCanvasTooltipHandle,
  {
    metadata: CanvasData['metadata'];
    titleMode: TitleMode;
    onHoverName: (name: string | undefined) => void;
  }
>(function ProjectCanvasTooltip({ metadata, titleMode, onHoverName }, ref) {
  const [tooltip, setTooltip] = useState<{
    text: string;
    x: number;
    y: number;
    above: boolean;
    labels?: number;
  }>();
  const anchor = useRef<Element | null>(null);
  useEffect(() => {
    if (tooltip?.labels && !metadata[tooltip.labels]) {
      anchor.current = null;
      setTooltip(undefined);
    }
  }, [metadata, tooltip]);
  useImperativeHandle(
    ref,
    () => ({
      hide() {
        anchor.current = null;
        setTooltip(undefined);
      },
      show(target) {
        if (titleMode === 'expand')
          onHoverName(
            target.closest('[data-expand-title]')?.getAttribute('data-expand-title') ?? undefined
          );
        const next = target.closest('[data-tip],[data-label-list]');
        if (next === anchor.current) return;
        anchor.current = next;
        if (!next) {
          setTooltip(undefined);
          return;
        }
        const labelId = next.getAttribute('data-label-list');
        const text = labelId ? 'Labels' : next.getAttribute('data-tip');
        if (!text) return;
        const bounds = next.getBoundingClientRect();
        setTooltip({
          text,
          x: Math.max(8, Math.min(window.innerWidth - 368, bounds.left)),
          y: bounds.bottom + 7,
          above: bounds.bottom > window.innerHeight - 110,
          labels: labelId ? Number(labelId) : undefined,
        });
      },
    }),
    [titleMode, onHoverName]
  );
  if (!tooltip || (tooltip.labels && !metadata[tooltip.labels])) return null;
  return (
    <div
      className="cc-tooltip"
      role="tooltip"
      style={{
        left: tooltip.x,
        top: tooltip.above ? undefined : tooltip.y,
        bottom: tooltip.above ? window.innerHeight - tooltip.y + 20 : undefined,
      }}
    >
      {tooltip.labels ? (
        <>
          <strong>Labels</strong>
          <div className="cc-tooltip-labels">
            {metadata[tooltip.labels].labels.map((label) => (
              <span
                className="cc-label"
                key={label.name}
                style={{
                  color: `color-mix(in srgb,#${label.color} 45%,#edf2ef)`,
                  borderColor: `#${label.color}80`,
                  background: `#${label.color}25`,
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        </>
      ) : (
        tooltip.text
      )}
    </div>
  );
});
