import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileFilter } from '@/components/profile/profile-filter';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ada = {
  id: 'user_Ada',
  handle: 'ada-lovelace',
  displayName: 'Ada Lovelace',
  picture: { id: 'picture_ada', url: 'https://example.com/ada.png' },
  canonicalPath: '/profiles/@ada-lovelace',
};

function response(data: unknown) {
  return new Response(JSON.stringify({ data }), {
    headers: { 'content-type': 'application/json' },
  });
}

function renderFilter(profileId?: string) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProfileFilter profileId={profileId} onChange={onChange} />
    </QueryClientProvider>
  );
  return { onChange, client };
}

describe('Profile wallpaper filter', () => {
  beforeEach(() => mockFetch.mockReset());

  it('searches a Handle alias and selects the current Profile identity by its exact ID', async () => {
    mockFetch.mockResolvedValue(response({
      searchProfiles: {
        edges: [{ node: ada }],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      },
    }));
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), ' countess ');
    const result = await screen.findByRole('button', { name: 'Select Ada Lovelace (@ada-lovelace)' });
    expect(screen.getByRole('img', { name: "Ada Lovelace's profile picture" })).toHaveAttribute('src', ada.picture.url);
    expect(onChange).not.toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      operationName: 'SearchProfiles',
      variables: { query: 'countess', first: 10, after: null },
    });
    await user.click(result);
    expect(onChange).toHaveBeenCalledWith('user_Ada');
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Profile' })).toHaveValue(''));
  });
});
