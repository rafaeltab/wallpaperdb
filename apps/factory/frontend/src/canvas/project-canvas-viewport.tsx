import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Icon } from './canvas-presentation';
import type { Box, Stage } from './geometry-types';
import { stages } from './geometry';

type Bounds = { x: number; y: number; width: number; height: number };
export interface ProjectCanvasViewportHandle {
  fit(bounds?: Bounds): void;
}

/** Navigation owns its render lifetime so movement never renders Project item content. */
export const ProjectCanvasViewport = forwardRef<
  ProjectCanvasViewportHandle,
  {
    width: number;
    height: number;
    areas: { id: Stage; y: number; width: number; height: number }[];
    boxes: Box[];
    children: ReactNode;
    overlay?: ReactNode;
    empty?: ReactNode;
    pending?: boolean;
    initializing?: boolean;
    onCollapse: () => void;
    onExpand: () => void;
    onNavigate: () => void;
    suppressCanvasClick: MutableRefObject<boolean>;
  }
>(function ProjectCanvasViewport(
  {
    width,
    height,
    areas,
    boxes,
    children,
    overlay,
    empty,
    pending: loading,
    initializing,
    onCollapse,
    onExpand,
    onNavigate,
    suppressCanvasClick,
  },
  ref
) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => ({
    x: 12,
    y:
      new URLSearchParams(location.search).get('focus') === 'review'
        ? 20 - (areas.find((area) => area.id === 'review')?.y ?? 0) * 0.9
        : 12,
    scale: 0.9,
  }));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<
    { id: number; x: number; y: number; vx: number; vy: number; moved: boolean } | undefined
  >(undefined);
  const frame = useRef<number | undefined>(undefined);
  const pending = useRef<{ x: number; y: number } | undefined>(undefined);
  const fit = useCallback(
    (bounds?: Bounds) => {
      const element = viewport.current;
      if (!element) return;
      const viewportBounds = element.getBoundingClientRect();
      const target = bounds ?? { x: 0, y: 0, width, height };
      const scale = Math.min(
        1,
        (viewportBounds.width - 60) / (target.width + 40),
        (viewportBounds.height - 110) / (target.height + 40)
      );
      setView({
        scale,
        x: (viewportBounds.width - target.width * scale) / 2 - target.x * scale,
        y: 20 - target.y * scale,
      });
    },
    [width, height]
  );
  useImperativeHandle(ref, () => ({ fit }), [fit]);
  const zoom = useCallback((factor: number, point?: { x: number; y: number }) => {
    const element = viewport.current;
    if (!element) return;
    const anchor = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    setView((current) => {
      const scale = Math.min(1.8, Math.max(0.02, current.scale * factor));
      return {
        scale,
        x: anchor.x - ((anchor.x - current.x) * scale) / current.scale,
        y: anchor.y - ((anchor.y - current.y) * scale) / current.scale,
      };
    });
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('.cc-controls,.cc-minimap,.cc-selection')) return;
      event.preventDefault();
      onNavigate();
      if (event.ctrlKey || event.metaKey || (!event.shiftKey && Math.abs(event.deltaX) < 1)) {
        const bounds = element.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * 0.002), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      } else
        setView((current) => ({
          ...current,
          x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
          y: current.y - (event.shiftKey ? 0 : event.deltaY),
        }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom, onNavigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('input,textarea,select,button,a')) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        fit();
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoom(1.2);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoom(1 / 1.2);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fit, zoom]);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    []
  );
  function flush() {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const next = pending.current;
    pending.current = undefined;
    if (next) setView((current) => ({ ...current, ...next }));
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      (event.target as Element).closest(
        '.cc-item,.cc-parent-head,.cc-selection,button,a,input,select,textarea,.cc-minimap'
      ) ||
      event.button !== 0
    )
      return;
    suppressCanvasClick.current = false;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) current.moved = true;
    if (!current.moved) return;
    pending.current = {
      x: current.vx + event.clientX - current.x,
      y: current.vy + event.clientY - current.y,
    };
    if (frame.current === undefined)
      frame.current = requestAnimationFrame(() => {
        setDragging(true);
        flush();
      });
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (event.type === 'pointerup' && current?.id === event.pointerId && current.moved)
      pending.current = {
        x: current.vx + event.clientX - current.x,
        y: current.vy + event.clientY - current.y,
      };
    if (drag.current) suppressCanvasClick.current = drag.current.moved;
    flush();
    drag.current = undefined;
    setDragging(false);
  }
  return (
    <div
      className={`cc-viewport ${dragging ? 'dragging' : ''}`}
      ref={viewport}
      aria-busy={loading}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div
        className="cc-world"
        style={{
          width,
          height,
          visibility: initializing ? 'hidden' : undefined,
          transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`,
        }}
      >
        {children}
      </div>
      {initializing && (
        <p className="cc-empty" role="status">
          Preparing Project canvas…
        </p>
      )}
      {empty}
      <nav className="cc-controls" aria-label="Canvas navigation">
        <button type="button" aria-label="Collapse all sections" onClick={onCollapse}>
          <Icon kind="collapse" size={13} />
          Collapse all
        </button>
        <button type="button" aria-label="Expand all sections" onClick={onExpand}>
          <Icon kind="expand" size={13} />
          Expand all
        </button>
        <i />
        {stages
          .filter((stage) => areas.some((area) => area.id === stage.id))
          .map((stage) => (
            <button
              type="button"
              key={stage.id}
              onClick={() => {
                const area = areas.find((value) => value.id === stage.id);
                if (area)
                  setView((current) => ({ ...current, x: 12, y: 20 - area.y * current.scale }));
              }}
            >
              {stage.name}
            </button>
          ))}
        <i />
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          −
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          +
        </button>
        <button type="button" aria-label="Fit all nodes" onClick={() => fit()}>
          <Icon kind="fit" />
        </button>
      </nav>
      {overlay}
      <svg
        className="cc-minimap"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: 144, height: Math.min(160, (144 * height) / width) }}
        aria-label="Canvas minimap"
        onPointerDown={(event) => {
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - bounds.left) / bounds.width) * width,
            y = ((event.clientY - bounds.top) / bounds.height) * height;
          const element = viewport.current;
          if (element)
            setView((current) => ({
              ...current,
              x: element.clientWidth / 2 - x * current.scale,
              y: element.clientHeight / 2 - y * current.scale,
            }));
        }}
      >
        {areas.map((area) => (
          <rect
            key={area.id}
            className="cc-map-area"
            x="16"
            y={area.y}
            width={area.width - 32}
            height={area.height}
          />
        ))}
        {boxes.map((box) => (
          <rect
            className={`cc-map-card ${box.item.stage}`}
            key={box.id}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
          />
        ))}
        <rect
          className="cc-map-view"
          x={-view.x / view.scale}
          y={-view.y / view.scale}
          width={(viewport.current?.clientWidth ?? 1280) / view.scale}
          height={(viewport.current?.clientHeight ?? 800) / view.scale}
        />
      </svg>
    </div>
  );
});
