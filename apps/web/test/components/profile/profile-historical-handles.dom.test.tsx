import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileHistoricalHandles } from '@/components/profile/profile-historical-handles';

describe('Configured Handle history', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains expiry using the server deadline without promising a fixed history window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-09T00:00:00.000Z'));
    render(
      <ProfileHistoricalHandles
        profile={{
          id: 'user_history',
          handle: 'current',
          displayName: 'Current Profile',
          biographyMarkdown: '',
          pictureAssetId: null,
          version: 2,
          createdAt: '2030-01-01T00:00:00.000Z',
          updatedAt: '2030-01-01T00:00:00.000Z',
          historicalHandles: [
            {
              handle: 'previous',
              eligibleUntil: '2030-01-08T00:00:00.000Z',
              unavailableReason: null,
            },
          ],
        }}
        disabled={false}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.getByText('Reactivate a recent Handle as a retained alias.')).toBeInTheDocument();
    expect(
      screen.getByText('This Handle is no longer in your recent history. Refresh aliases.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate @previous' })).toBeDisabled();
    expect(screen.getByTitle('2030-01-08T00:00:00.000Z')).toHaveAttribute(
      'datetime',
      '2030-01-08T00:00:00.000Z'
    );
  });
});
