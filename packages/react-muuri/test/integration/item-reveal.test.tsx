import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { type LayoutFunction, MuuriGrid, MuuriItem } from '../../src/index.js';

afterEach(cleanup);

describe('item reveal', () => {
  it('reveals appended items only after their layout finishes and keeps existing items visible', async () => {
    let finishLayout: (() => void) | undefined;
    const layout: LayoutFunction = (_grid, id, items, _width, _height, callback) => {
      finishLayout = () =>
        callback({
          id,
          items,
          slots: items.flatMap((_, index) => [index * 120, 80]),
          styles: { height: '180px' },
        });
    };
    function Gallery({ ids }: { ids: string[] }) {
      return (
        <MuuriGrid layout={layout} layoutDuration={0}>
          {ids.map((id) => (
            <MuuriItem key={id} data-testid={id}>
              <div style={{ width: 100, height: 100 }}>{id}</div>
            </MuuriItem>
          ))}
        </MuuriGrid>
      );
    }
    const { rerender } = render(<Gallery ids={['existing']} />);
    await waitFor(() => expect(finishLayout).toBeDefined());
    await act(async () => finishLayout?.());
    await waitFor(() => expect(screen.getByTestId('existing')).toBeVisible());

    finishLayout = undefined;
    rerender(<Gallery ids={['existing', 'portrait', 'ultrawide']} />);
    await waitFor(() => expect(finishLayout).toBeDefined());
    expect(screen.getByTestId('existing')).toBeVisible();
    expect(screen.getByTestId('portrait')).not.toBeVisible();
    expect(screen.getByTestId('ultrawide')).not.toBeVisible();

    await act(async () => finishLayout?.());
    await waitFor(() => expect(screen.getByTestId('portrait')).toBeVisible());
    expect(screen.getByTestId('portrait')).toHaveStyle({
      transform: 'translateX(120px) translateY(80px)',
    });
    expect(screen.getByTestId('ultrawide')).toBeVisible();
    expect(screen.getByTestId('ultrawide')).toHaveStyle({
      transform: 'translateX(240px) translateY(80px)',
    });
    expect(screen.getByTestId('existing')).toHaveStyle({
      transform: 'translateX(0px) translateY(80px)',
    });
  });
});
