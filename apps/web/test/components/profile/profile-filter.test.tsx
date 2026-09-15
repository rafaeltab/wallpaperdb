import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('restores the selected Profile from its saved ID and lets the reader clear the filter', async () => {
    mockFetch.mockResolvedValue(response({ profile: { ...ada, biographyMarkdown: '' } }));
    const user = userEvent.setup();
    const { onChange } = renderFilter(ada.id);

    expect(await screen.findByText('@ada-lovelace')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      operationName: 'GetProfile',
      variables: { id: 'user_Ada' },
    });
    await user.click(screen.getByRole('button', { name: 'Clear Profile filter' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('explains search loading, failure, and empty results while allowing a retry', async () => {
    let rejectSearch: (error: Error) => void = () => {};
    mockFetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSearch = reject; }));
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), 'missing');
    expect(await screen.findByRole('status')).toHaveTextContent('Searching Profiles…');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    rejectSearch(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not search Profiles. Try again.');
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false },
    } }));
    await user.click(screen.getByRole('button', { name: 'Retry Profile search' }));
    expect(await screen.findByText('No Profiles found. Try another Handle or Display name.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an unavailable selected Profile removable and retries lookup failures', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    const { onChange } = renderFilter(ada.id);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the selected Profile.');
    expect(onChange).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(response({ profile: null }));
    await user.click(screen.getByRole('button', { name: 'Retry selected Profile' }));
    expect(await screen.findByText('Selected Profile is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Loading selected Profile…')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear Profile filter' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('loads another page with its opaque cursor and can select a later result', async () => {
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [{ node: ada }],
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'opaque_cursor' },
    } }));
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), 'ada');
    const loadMore = await screen.findByRole('button', { name: 'Load more Profiles' });
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [{ node: { ...ada, id: 'user_Grace', handle: 'grace', displayName: 'Grace Hopper' } }],
      pageInfo: { hasNextPage: false, hasPreviousPage: true },
    } }));
    await user.click(loadMore);
    await user.click(await screen.findByRole('button', { name: 'Select Grace Hopper (@grace)' }));
    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string).variables).toEqual({ query: 'ada', first: 10, after: 'opaque_cursor' });
    expect(onChange).toHaveBeenCalledWith('user_Grace');
  });

  it('accepts a displayed @Handle and does not search a lone @', async () => {
    mockFetch.mockResolvedValue(response({ searchProfiles: {
      edges: [{ node: ada }], pageInfo: { hasNextPage: false, hasPreviousPage: false },
    } }));
    const user = userEvent.setup();
    renderFilter();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), '@');
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(mockFetch).not.toHaveBeenCalled();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), ' ADA ');
    await screen.findByRole('button', { name: 'Select Ada Lovelace (@ada-lovelace)' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).variables.query).toBe('ada');
  });

  it('keeps existing results and retries a failed next page with the same cursor', async () => {
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [{ node: ada }], pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cursor_ada' },
    } }));
    const user = userEvent.setup();
    renderFilter();
    await user.type(screen.getByRole('searchbox', { name: 'Profile' }), 'ada');
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await user.click(await screen.findByRole('button', { name: 'Load more Profiles' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load more Profiles.');
    expect(screen.getByRole('button', { name: 'Select Ada Lovelace (@ada-lovelace)' })).toBeInTheDocument();
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: true },
    } }));
    await user.click(screen.getByRole('button', { name: 'Retry loading more Profiles' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [, init] = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(init.body as string).variables.after).toBe('cursor_ada');
  });

  it('ignores late results from an earlier query and hides results immediately when text changes', async () => {
    let resolveEarlier: (value: Response) => void = () => {};
    mockFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveEarlier = resolve; }));
    const user = userEvent.setup();
    const { onChange } = renderFilter();
    const input = screen.getByRole('searchbox', { name: 'Profile' });
    await user.type(input, 'ada');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    mockFetch.mockResolvedValueOnce(response({ searchProfiles: {
      edges: [{ node: { ...ada, id: 'user_Grace', handle: 'grace', displayName: 'Grace Hopper' } }],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    } }));
    await user.clear(input);
    await user.type(input, 'grace');
    await screen.findByRole('button', { name: 'Select Grace Hopper (@grace)' });
    await act(async () => {
      resolveEarlier(response({ searchProfiles: {
        edges: [{ node: ada }], pageInfo: { hasNextPage: false, hasPreviousPage: false },
      } }));
    });
    expect(screen.queryByRole('button', { name: 'Select Ada Lovelace (@ada-lovelace)' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Grace Hopper (@grace)' })).toBeInTheDocument();
    await user.type(input, 'x');
    expect(screen.queryByRole('button', { name: 'Select Grace Hopper (@grace)' })).not.toBeInTheDocument();
    await user.clear(input);
    expect(screen.queryByRole('list', { name: 'Matching Profiles' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
