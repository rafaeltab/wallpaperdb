import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FieldError } from '@/components/ui/field';

describe('Field error messages', () => {
  it('prefers explicit content over generated messages', () => {
    render(<FieldError errors={[{ message: 'Ignored' }]}>Try again</FieldError>);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again');
    expect(screen.queryByText('Ignored')).not.toBeInTheDocument();
  });

  it.each([undefined, [], [undefined], [{ message: '' }], [undefined, {}]])(
    'renders no alert for errors without messages: %j', (errors) => {
      render(<FieldError errors={errors} />);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('deduplicates messages and renders a single message without a list', () => {
    render(<FieldError errors={[undefined, { message: 'Required' }, { message: 'Required' }]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('lists distinct messages in their original order and updates when errors change', () => {
    const { rerender } = render(<FieldError errors={[
      { message: 'Required' }, undefined, { message: 'Too short' }, { message: 'Required' },
    ]} />);
    expect(within(screen.getByRole('alert')).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['Required', 'Too short']);
    rerender(<FieldError errors={[]} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
