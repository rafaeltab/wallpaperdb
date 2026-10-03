import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WallpaperGridSkeleton } from '@/components/grid/WallpaperGridSkeleton';

function intrinsicSize(element: HTMLElement, dimension: 'width' | 'height'): number {
  if (dimension === 'width' && element.classList.contains('muuri')) return 2560;
  const value = element.style[dimension];
  if (value.endsWith('px')) return Number.parseFloat(value);
  if (element.firstElementChild instanceof HTMLElement) {
    return intrinsicSize(element.firstElementChild, dimension);
  }
  return dimension === 'width' ? 2560 : 0;
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 2560);
  vi.stubGlobal('innerHeight', 1440);
  // JSDOM has no layout engine. Supply intrinsic measurements while the real
  // Muuri instance computes item positions and the container height.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(2560);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, intrinsicSize(this, 'width'), intrinsicSize(this, 'height'));
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WallpaperGridSkeleton', () => {
  it('packs mixed placeholder shapes without reserving the tallest height for each row', async () => {
    const { container } = render(<WallpaperGridSkeleton />);
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons).toHaveLength(12);

    await waitFor(() => {
      for (const skeleton of skeletons) expect(skeleton).toBeVisible();
      const positioned = container.querySelectorAll<HTMLElement>('[style*="translateX"]');
      expect(positioned).toHaveLength(12);
      const bounds = Array.from(positioned, (element) => {
        const coordinates = element.style.transform.match(/translateX\(([-\d.]+)px\) translateY\(([-\d.]+)px\)/);
        if (!coordinates) throw new Error('Placeholder has no final position');
        return {
          x: Number(coordinates[1]),
          y: Number(coordinates[2]),
          width: intrinsicSize(element, 'width'),
          height: intrinsicSize(element, 'height'),
        };
      });
      for (const [index, a] of bounds.entries()) {
        for (const b of bounds.slice(index + 1)) {
          expect(
            a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 ||
            a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5
          ).toBe(true);
        }
      }
      const firstRow = bounds.filter((item) => item.y === 0);
      const tallestBottom = Math.max(...firstRow.map((item) => item.height));
      expect(bounds.some((item) => item.y > 0 && item.y < tallestBottom)).toBe(true);
    });
    expect(container.querySelector('button')).toBeNull();
  });
});
