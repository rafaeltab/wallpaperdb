import { useLayoutEffect, useRef } from 'react';
import './project-canvas-motion.css';

/** Synchronizes local opacity animations without updating inherited styles each frame. */
export function synchronizeProjectActivity(root: HTMLElement) {
  const timeline = root.ownerDocument.timeline;
  // DOM-only tests do not implement document timelines or CSS animations.
  if (!timeline || !root.getAnimations) return () => {};
  const epoch = timeline.currentTime;
  const aligned = new WeakSet<Animation>();
  function synchronize(animations: Animation[]) {
    if (epoch === null) return;
    for (const animation of animations) {
      if (
        !(animation instanceof CSSAnimation) ||
        animation.animationName !== 'cc-activity-pulse' ||
        aligned.has(animation)
      )
        continue;
      animation.startTime = epoch;
      aligned.add(animation);
    }
  }
  function start(event: AnimationEvent) {
    if (event.animationName === 'cc-activity-pulse' && event.target instanceof Element)
      synchronize(event.target.getAnimations({ subtree: true }));
  }
  root.addEventListener('animationstart', start);
  synchronize(root.getAnimations({ subtree: true }));
  return () => root.removeEventListener('animationstart', start);
}

export function useProjectCanvasMotion() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) return synchronizeProjectActivity(root.current);
  }, []);
  return root;
}
