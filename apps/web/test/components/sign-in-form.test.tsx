import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({
  useSignIn: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { useSignIn } from '@clerk/clerk-react';
import { SignInForm } from '@/components/sign-in-form';

describe('SignInForm', () => {
  const mockCreate = vi.fn();
  const mockSetActive = vi.fn();
  const mockAuthenticateWithRedirect = vi.fn();
  const mockOnSuccess = vi.fn();

  function mockSignInReturn(overrides: Record<string, unknown> = {}) {
    return {
      isLoaded: true,
      signIn: {
        create: mockCreate,
        setActive: mockSetActive,
        authenticateWithRedirect: mockAuthenticateWithRedirect,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (useSignIn as Mock).mockReturnValue(mockSignInReturn());
  });

  it('renders the sign-in form with email and password fields', () => {
    render(<SignInForm onSuccess={mockOnSuccess} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('renders social login buttons for Google and GitHub', () => {
    render(<SignInForm onSuccess={mockOnSuccess} />);

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('renders a link to the sign-up page', () => {
    render(<SignInForm onSuccess={mockOnSuccess} />);

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toBeInTheDocument();
    expect(signUpLink).toHaveAttribute('href', '/sign-up');
  });

  it('shows loading state when sign-in is in progress', async () => {
    mockCreate.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    render(<SignInForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
    });
  });

  it('displays error message when sign-in fails', async () => {
    mockCreate.mockRejectedValue({
      errors: [{ message: 'Invalid email or password' }],
    });

    const user = userEvent.setup();
    render(<SignInForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email or password/i);
    });
  });

  it('calls onSuccess after successful sign-in', async () => {
    mockCreate.mockResolvedValue({
      createdSessionId: 'sess_123',
      status: 'complete',
    });
    mockSetActive.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith('/');
    });
  });

  it('sign-up link navigates to /sign-up', async () => {
    render(<SignInForm onSuccess={mockOnSuccess} />);

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toHaveAttribute('href', '/sign-up');
  });
});