import { useEffect, useRef } from 'react';

interface HeaderLayoutProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}

export function HeaderLayout({ left, center, right }: HeaderLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const leftEl = leftRef.current;
    const rightEl = rightRef.current;
    const spacerEl = spacerRef.current;
    if (!container || !leftEl || !rightEl || !spacerEl) return;

    const update = () => {
      const spacerW = spacerEl.offsetWidth;
      const leftW = leftEl.offsetWidth;
      const rightW = rightEl.offsetWidth;
      const rawOffset = (rightW - leftW) / 2;
      const clampedOffset = Math.max(-spacerW, Math.min(spacerW, rawOffset));
      container.style.setProperty('--search-offset', `${clampedOffset}px`);
    };

    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(leftEl);
    observer.observe(rightEl);
    observer.observe(spacerEl);

    update();

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex w-full items-center gap-4 px-4">
      <div ref={leftRef} className="flex items-center gap-4 shrink-0">
        {left}
      </div>
      <div ref={spacerRef} className="flex-1 min-w-0" />
      <div
        className="w-full max-w-xl min-w-0 shrink"
        style={{ transform: 'translateX(var(--search-offset, 0px))' }}
      >
        {center}
      </div>
      <div className="flex-1 min-w-0" />
      <div ref={rightRef} className="flex items-center gap-2 shrink-0">
        {right}
      </div>
    </div>
  );
}
