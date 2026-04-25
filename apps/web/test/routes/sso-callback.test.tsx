import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

const mockAuthenticateWithRedirectCallback = vi.fn(({ signInForceRedirectUrl, signUpForceRedirectUrl }) => (
  <div
    data-testid="authenticate-callback"
    data-sign-in-redirect-url={signInForceRedirectUrl}
    data-sign-up-redirect-url={signUpForceRedirectUrl}
  />
));

vi.mock('@clerk/react', () => ({
  AuthenticateWithRedirectCallback: (props: Record<string, string>) => mockAuthenticateWithRedirectCallback(props),
}));

const mockUseSearch = vi.fn(() => ({}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => mockUseSearch(),
  }),
  useNavigate: () => vi.fn(),
}));

import { SSOCallbackPage } from '@/routes/sso-callback';

describe('SSOCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearch.mockReturnValue({});
  });

  it('renders the AuthenticateWithRedirectCallback component', () => {
    render(<SSOCallbackPage />);

    expect(screen.getByTestId('authenticate-callback')).toBeInTheDocument();
  });

  it('passes default redirect URL when no redirect param is present', () => {
    mockUseSearch.mockReturnValue({});

    render(<SSOCallbackPage />);

    expect(mockAuthenticateWithRedirectCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        signInForceRedirectUrl: expect.stringMatching(/\/(web\/)?$/),
        signUpForceRedirectUrl: expect.stringMatching(/\/(web\/)?$/),
      }),
    );
  });

  it('passes the redirect search param to AuthenticateWithRedirectCallback', () => {
    mockUseSearch.mockReturnValue({ redirect: '/upload' });

    render(<SSOCallbackPage />);

    expect(mockAuthenticateWithRedirectCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        signInForceRedirectUrl: expect.stringContaining('upload'),
        signUpForceRedirectUrl: expect.stringContaining('upload'),
      }),
    );
  });

  it('displays signing in text', () => {
    render(<SSOCallbackPage />);

    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
  });
});