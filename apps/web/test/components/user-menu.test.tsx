import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
  useClerk: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { UserMenu } from '@/components/user-menu';

describe('UserMenu', () => {
  const mockSignOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useClerk as Mock).mockReturnValue({ signOut: mockSignOut });
  });

  it('shows Sign in button when user is signed out', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: false, isLoaded: true });
    (useUser as Mock).mockReturnValue({ user: null, isLoaded: true });

    render(<UserMenu />);

    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/sign-in');
  });

  it('returns null when auth is not loaded', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: false, isLoaded: false });
    (useUser as Mock).mockReturnValue({ user: null, isLoaded: false });

    const { container } = render(<UserMenu />);

    expect(container.innerHTML).toBe('');
  });

  it('shows user name when signed in', () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: true, isLoaded: true });
    (useUser as Mock).mockReturnValue({
      isLoaded: true,
      user: {
        fullName: 'John Doe',
        imageUrl: 'https://example.com/avatar.jpg',
        primaryEmailAddress: { emailAddress: 'john@example.com' },
      },
    });

    render(<UserMenu />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('shows sign out option in dropdown when signed in', async () => {
    (useAuth as Mock).mockReturnValue({ isSignedIn: true, isLoaded: true });
    (useUser as Mock).mockReturnValue({
      isLoaded: true,
      user: {
        fullName: 'Jane Smith',
        imageUrl: 'https://example.com/avatar2.jpg',
        primaryEmailAddress: { emailAddress: 'jane@example.com' },
      },
    });

    const user = userEvent.setup();
    render(<UserMenu />);

    const trigger = screen.getByRole('button', { name: /jane smith/i });
    await user.click(trigger);

    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('calls signOut when sign out is clicked', async () => {
    mockSignOut.mockResolvedValue(undefined);
    (useAuth as Mock).mockReturnValue({ isSignedIn: true, isLoaded: true });
    (useUser as Mock).mockReturnValue({
      isLoaded: true,
      user: {
        fullName: 'Jane Smith',
        imageUrl: 'https://example.com/avatar2.jpg',
        primaryEmailAddress: { emailAddress: 'jane@example.com' },
      },
    });

    const user = userEvent.setup();
    render(<UserMenu />);

    const trigger = screen.getByRole('button', { name: /jane smith/i });
    await user.click(trigger);

    const signOutItem = screen.getByRole('menuitem', { name: /sign out/i });
    await user.click(signOutItem);

    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});