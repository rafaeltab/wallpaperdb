import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorComposition } from '@/components/color-filter/color-composition';

const value = [
  { name: 'BLUE' as const, quality: 'FAVORITE' as const, percent: 30 },
  { name: 'RED' as const, quality: 'FAVORITE' as const, percent: 20 },
];

function setup() {
  const onChange = vi.fn();
  const { container } = render(<ColorComposition value={value} onChange={onChange} onEdit={vi.fn()} onEmpty={vi.fn()} />);
  const slider = screen.getByRole('slider', { name: 'Amount boundary for Blue' });
  const capture = vi.fn();
  const captured = vi.fn(() => true);
  Object.assign(slider, { setPointerCapture: capture, hasPointerCapture: captured });
  vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 30));
  // jsdom has no PointerEvent. Supply its coordinates on the dispatched DOM event.
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { clientX: x, pointerId: 1 });
    fireEvent(slider, event);
  };
  return { slider, onChange, capture, captured, pointer };
}

afterEach(() => vi.restoreAllMocks());

describe('Color boundary pointer adapter', () => {
  it('previews a measured drag and commits only on release', () => {
    const { slider, pointer, onChange, capture } = setup();
    pointer('pointermove', 100);
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointerdown', 60);
    expect(capture).toHaveBeenCalledWith(1);
    pointer('pointermove', 100);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    expect(onChange).not.toHaveBeenCalled();
    pointer('pointerup', 100);
    expect(onChange).toHaveBeenCalledExactlyOnceWith([
      { ...value[0], percent: 50 }, { ...value[1], percent: 0 },
    ]);
    pointer('pointerup', 100);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores uncaptured movement and discards canceled previews', () => {
    const { slider, pointer, onChange, captured } = setup();
    pointer('pointerdown', 60);
    captured.mockReturnValue(false);
    pointer('pointermove', 100);
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    captured.mockReturnValue(true);
    pointer('pointermove', 100);
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    pointer('pointercancel', 100);
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    pointer('pointerup', 100);
    expect(onChange).not.toHaveBeenCalled();
  });
});
