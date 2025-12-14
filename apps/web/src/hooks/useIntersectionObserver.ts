import { useEffect, useRef, useState } from 'react';

interface UseIntersectionObserverOptions {
  threshold?: number;
  rootMargin?: string;
  enabled?: boolean;
}

export function useIntersectionObserver({
  threshold = 0,
  rootMargin = '200px',
  enabled = true,
}: UseIntersectionObserverOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  // Track if observer has been disabled at least once
  // We only skip initial callbacks after a disable/re-enable cycle
  const hasBeenDisabled = useRef(false);
  const skipNextCallback = useRef(false);

  useEffect(() => {
    if (!enabled || !ref.current) {
      setIsIntersecting(false);
      // Mark that we've been disabled - next enable should skip initial callback
      if (ref.current) {
        hasBeenDisabled.current = true;
        skipNextCallback.current = true;
      }
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // After a disable/re-enable cycle, skip the initial "intersecting" callback
        // This prevents immediate re-triggering when the element was already visible
        if (skipNextCallback.current && hasBeenDisabled.current) {
          skipNextCallback.current = false;
          // Only skip if it reports intersecting - if not intersecting, allow it
          if (entry.isIntersecting) {
            return;
          }
        }
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold, rootMargin }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold, rootMargin, enabled]);

  return { ref, isIntersecting };
}
