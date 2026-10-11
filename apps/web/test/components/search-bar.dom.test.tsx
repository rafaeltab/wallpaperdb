import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from '@/components/search-bar';

describe('SearchBar', () => {
  it('renders a filter toggle button when requested', async () => {
    const user = userEvent.setup();
    const onToggleFilters = vi.fn();

    render(
      <SearchBar showFilterToggle={true} isFilterPanelOpen={false} onToggleFilters={onToggleFilters} />,
    );

    await user.click(screen.getByRole('button', { name: /toggle filters/i }));

    expect(onToggleFilters).toHaveBeenCalledTimes(1);
  });

  it('does not render the filter toggle away from the browse page', () => {
    render(<SearchBar />);

    expect(screen.queryByRole('button', { name: /toggle filters/i })).not.toBeInTheDocument();
  });
});
