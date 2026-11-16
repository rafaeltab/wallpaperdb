import { cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ProjectCanvasViewport,
  type ProjectCanvasViewportHandle,
} from '../src/canvas/project-canvas-viewport';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('zooms the Project canvas without rendering Project item content again', () => {
  let renders = 0;
  function Item() {
    renders++;
    return <span>Project item</span>;
  }
  const { container, getByRole } = render(
    <ProjectCanvasViewport
      ref={createRef<ProjectCanvasViewportHandle>()}
      width={1200}
      height={800}
      areas={[]}
      boxes={[]}
      onCollapse={() => {}}
      onExpand={() => {}}
      onNavigate={() => {}}
      suppressCanvasClick={{ current: false }}
    >
      <Item />
    </ProjectCanvasViewport>
  );
  expect(container.querySelector('.cc-world')?.getAttribute('style')).toContain('scale(0.9)');
  fireEvent.click(getByRole('button', { name: 'Zoom in' }));
  expect(container.querySelector('.cc-world')?.getAttribute('style')).toContain('scale(1.08)');
  expect(renders).toBe(1);
});

it('flushes the final drag position before pointer release and suppresses its background click', () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
    frames.push(frame);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const suppress = { current: false };
  const { container } = render(
    <ProjectCanvasViewport
      width={1200}
      height={800}
      areas={[]}
      boxes={[]}
      onCollapse={() => {}}
      onExpand={() => {}}
      onNavigate={() => {}}
      suppressCanvasClick={suppress}
    >
      <span>Project item</span>
    </ProjectCanvasViewport>
  );
  const viewport = container.querySelector<HTMLElement>('.cc-viewport');
  if (!viewport) throw new Error('Expected Project canvas viewport');
  viewport.setPointerCapture = () => {};
  function pointer(type: string, x: number, y: number) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(viewport!, event);
  }
  pointer('pointerdown', 10, 20);
  pointer('pointermove', 25, 45);
  pointer('pointermove', 40, 60);
  expect(frames).toHaveLength(1);
  pointer('pointerup', 45, 70);
  expect(container.querySelector('.cc-world')?.getAttribute('style')).toContain(
    'translate(47px,62px)'
  );
  expect(suppress.current).toBe(true);
});
