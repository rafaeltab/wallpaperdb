import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ColorFilter } from '@/components/color-filter';
import { COLOR_TARGETS, type ColorPreference } from '@/lib/color-preferences';

function Harness({
  initial = [],
  changed = () => {},
}: {
  initial?: ColorPreference[];
  changed?: (value: ColorPreference[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ColorFilter
      value={value}
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}
describe('Color filter editor', () => {
  it('saves one optional-amount color, edits its match, and discards canceled changes', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await user.click(screen.getByRole('button', { name: 'Add color or feature' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Hex color' }), {
      target: { value: '#004AFF' },
    });
    fireEvent.change(within(dialog).getByRole('slider', { name: 'Match preference' }), {
      target: { value: '2' },
    });
    expect(changed).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([{ color: '#004AFF', quality: 'STRICT' }]);
    await user.click(screen.getByRole('button', { name: 'Edit #004AFF' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Match preference' }), {
      target: { value: '0' },
    });
    await user.keyboard('{Escape}');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit #004AFF' })).toHaveFocus();
  });
  it.each(
    COLOR_TARGETS
  )('supports $name as a named target without silently assigning an amount', async (option) => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await user.click(screen.getByRole('button', { name: 'Add color or feature' }));
    await user.click(screen.getByRole('tab', { name: option.category }));
    await user.click(screen.getByRole('button', { name: option.label }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([{ name: option.name, quality: 'FAVORITE' }]);
  });
});

describe('Color preference constraints', () => {
  it('caps an optional percentage at the remaining budget and clears it back to vibe', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <Harness initial={[{ color: '#004AFF', quality: 'STRICT', percent: 70 }]} changed={changed} />
    );
    await user.click(screen.getByRole('button', { name: 'Add color or feature' }));
    await user.click(screen.getByRole('tab', { name: 'Features' }));
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await user.click(screen.getByRole('button', { name: 'Add percentage' }));
    expect(screen.getByRole('slider', { name: 'Percentage' })).toHaveAttribute('max', '30');
    expect(screen.getByRole('slider', { name: 'Percentage' })).toHaveValue('30');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([
      { color: '#004AFF', quality: 'STRICT', percent: 70 },
      { name: 'DARK', quality: 'FAVORITE', percent: 30 },
    ]);
    await user.click(screen.getByRole('button', { name: 'Edit Dark' }));
    await user.click(screen.getAllByRole('button', { name: 'Clear percentage' })[0]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([
      { color: '#004AFF', quality: 'STRICT', percent: 70 },
      { name: 'DARK', quality: 'FAVORITE' },
    ]);
  });
  it('adds an explicit zero-percent preference when the budget is full', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <Harness initial={[{ name: 'BLUE', quality: 'FAVORITE', percent: 100 }]} changed={changed} />
    );
    await user.click(screen.getByRole('button', { name: 'Add color or feature' }));
    await user.click(screen.getByRole('tab', { name: 'Swatches' }));
    await user.click(screen.getByRole('button', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Add percentage' }));
    expect(screen.getByRole('slider', { name: 'Percentage' })).toHaveValue('0');
    expect(screen.getByRole('slider', { name: 'Percentage' })).toHaveAttribute('max', '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([
      { name: 'BLUE', quality: 'FAVORITE', percent: 100 },
      { name: 'RED', quality: 'FAVORITE', percent: 0 },
    ]);
  });
  it('restores focus to a neighboring preference, then Add after the last removal', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { name: 'BLUE', quality: 'FAVORITE' },
          { name: 'RED', quality: 'FAVORITE' },
        ]}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Remove Blue' }));
    expect(screen.getByRole('button', { name: 'Edit Red' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Remove Red' }));
    expect(screen.getByRole('button', { name: 'Add color or feature' })).toHaveFocus();
  });
  it('prevents invalid hex colors and duplicate preferences from committing', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Harness initial={[{ color: '#004AFF', quality: 'FAVORITE' }]} changed={changed} />);
    await user.click(screen.getByRole('button', { name: 'Add color or feature' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), {
      target: { value: '#BAD' },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), {
      target: { value: '#004AFF' },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Already selected/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(changed).not.toHaveBeenCalled();
  });
  it('enforces ten targets while allowing removal without changing the others', async () => {
    const user = userEvent.setup();
    const initial: ColorPreference[] = COLOR_TARGETS.slice(0, 10).map((option) => ({
      name: option.name,
      quality: 'FAVORITE',
    }));
    const changed = vi.fn();
    render(<Harness initial={initial} changed={changed} />);
    expect(screen.getByRole('button', { name: 'Add color or feature' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove Red' }));
    expect(screen.getByRole('button', { name: 'Add color or feature' })).toBeEnabled();
    expect(changed).toHaveBeenLastCalledWith(initial.slice(1));
  });
  it('lets keyboard boundaries grow out of all-zero requests and keeps the budget at 100%', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <Harness
        initial={[
          { name: 'BLUE', quality: 'FAVORITE', percent: 0 },
          { name: 'RED', quality: 'FAVORITE', percent: 0 },
        ]}
        changed={changed}
      />
    );
    const slider = screen.getByRole('slider', { name: 'Amount boundary for Blue' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(changed).toHaveBeenLastCalledWith([
      { name: 'BLUE', quality: 'FAVORITE', percent: 10 },
      { name: 'RED', quality: 'FAVORITE', percent: 0 },
    ]);
    await user.keyboard('{End}');
    expect(slider).toHaveAttribute('aria-valuenow', '100');
  });
  it('supports distribution strength percentages for monochromatic and rainbow', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <Harness initial={[{ name: 'MONOCHROMATIC', quality: 'FAVORITE' }]} changed={changed} />
    );
    await user.click(screen.getByRole('button', { name: 'Edit Monochromatic' }));
    await user.click(screen.getByRole('button', { name: 'Add percentage' }));
    expect(screen.getByRole('slider', { name: 'Distribution strength' })).toHaveValue('40');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(changed).toHaveBeenLastCalledWith([
      { name: 'MONOCHROMATIC', quality: 'FAVORITE', percent: 40 },
    ]);
  });
});
