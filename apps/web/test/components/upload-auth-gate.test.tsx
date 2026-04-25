import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => {
    const params = search ? new URLSearchParams(search).toString() : '';
    const href = params ? `${to}?${params}` : to;
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useRouter: () => ({ state: { location: { pathname: '/upload' } } }),
}));

import { useAuth } from '@clerk/react';
import { UploadAuthGate } from '@/components/upload-auth-gate';

describe('UploadAuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows sign-in CTA when user is not signed in', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: false, isLoaded: true });

    render(
      <UploadAuthGate>
        <div>Upload UI</div>
      </UploadAuthGate>,
    );

    expect(screen.getByRole('link', { name: /sign in to upload/i })).toHaveAttribute(
      'href',
      '/sign-in?redirect=%2Fupload',
    );
    expect(screen.queryByText('Upload UI')).not.toBeInTheDocument();
  });

  it('renders children when user is signed in', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: true, isLoaded: true });

    render(
      <UploadAuthGate>
        <div>Upload UI</div>
      </UploadAuthGate>,
    );

    expect(screen.getByText('Upload UI')).toBeInTheDocument();
    expect(screen.queryByText(/sign in to upload/i)).not.toBeInTheDocument();
  });

  it('returns null when auth is not loaded', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: false, isLoaded: false });

    const { container } = render(
      <UploadAuthGate>
        <div>Upload UI</div>
      </UploadAuthGate>,
    );

    expect(container.innerHTML).toBe('');
  });

  it('shows descriptive text explaining the user needs to sign in', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: false, isLoaded: true });

    render(
      <UploadAuthGate>
        <div>Upload UI</div>
      </UploadAuthGate>,
    );

    expect(screen.getByText(/sign in to upload wallpapers/i)).toBeInTheDocument();
  });
});
