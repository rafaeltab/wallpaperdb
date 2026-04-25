import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({
  useClerk: vi.fn(),
}));

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useNavigate: () => mockNavigate,
}));

import { useClerk } from '@clerk/clerk-react';
import { Route, SSOCallbackPage, consumeSsoRedirect, storeSsoRedirect } from '@/routes/sso-callback';

describe('SSOCallbackPage', () => {
  const mockHandleRedirectCallback = vi.fn();
  const originalUseSearch = Route.useSearch;

  beforeEach(() => {
    vi.clearAllMocks();
    (useClerk as Mock).mockReturnValue({
      handleRedirectCallback: mockHandleRedirectCallback,
    });
    sessionStorage.clear();
    const url = new URL(window.location.href);
    url.searchParams.delete('__clerk_status');
    window.history.replaceState({}, '', url.toString());
  });

  afterEach(() => {
    Route.useSearch = originalUseSearch;
  });

  it('calls handleRedirectCallback when __clerk_status is present', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('__clerk_status', 'test');
    window.history.replaceState({}, '', url.toString());

    mockHandleRedirectCallback.mockResolvedValue({});

    render(<SSOCallbackPage />);

    await waitFor(() => {
      expect(mockHandleRedirectCallback).toHaveBeenCalledOnce();
    });
  });

  it('navigates to stored redirect after successful callback', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('__clerk_status', 'test');
    window.history.replaceState({}, '', url.toString());

    storeSsoRedirect('/upload');
    mockHandleRedirectCallback.mockResolvedValue({});

    render(<SSOCallbackPage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/upload' });
    });
  });

  it('navigates to / when no stored redirect after successful callback', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('__clerk_status', 'test');
    window.history.replaceState({}, '', url.toString());

    mockHandleRedirectCallback.mockResolvedValue({});

    render(<SSOCallbackPage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' });
    });
  });

  it('does not call handleRedirectCallback when no __clerk_status param', () => {
    mockHandleRedirectCallback.mockResolvedValue({});

    render(<SSOCallbackPage />);

    expect(mockHandleRedirectCallback).not.toHaveBeenCalled();
  });

  it('navigates to stored redirect when no __clerk_status param', () => {
    storeSsoRedirect('/upload');

    render(<SSOCallbackPage />);

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/upload' });
  });

  it('displays error message when handleRedirectCallback fails', async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('__clerk_status', 'test');
    window.history.replaceState({}, '', url.toString());

    mockHandleRedirectCallback.mockRejectedValue(new Error('OAuth callback failed'));

    render(<SSOCallbackPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/oauth callback failed/i);
    });
  });

  it('displays loading state while processing redirect', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('__clerk_status', 'test');
    window.history.replaceState({}, '', url.toString());

    mockHandleRedirectCallback.mockReturnValue(new Promise(() => {}));

    render(<SSOCallbackPage />);

    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });
});

describe('storeSsoRedirect / consumeSsoRedirect', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores and retrieves a redirect path', () => {
    storeSsoRedirect('/upload');
    expect(consumeSsoRedirect()).toBe('/upload');
  });

  it('returns / when nothing is stored', () => {
    expect(consumeSsoRedirect()).toBe('/');
  });

  it('clears the stored value after consuming', () => {
    storeSsoRedirect('/upload');
    consumeSsoRedirect();
    expect(consumeSsoRedirect()).toBe('/');
  });
});