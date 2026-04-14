import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({
  useSignUp: vi.fn(),
  useClerk: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

import { useClerk, useSignUp } from '@clerk/clerk-react';
import { SignUpForm } from '@/components/sign-up-form';

describe('SignUpForm', () => {
  const mockCreate = vi.fn();
  const mockAuthenticateWithRedirect = vi.fn();
  const mockSetActive = vi.fn();
  const mockOnSuccess = vi.fn();

  function mockSignUpReturn(overrides: Record<string, unknown> = {}) {
    return {
      isLoaded: true,
      signUp: {
        create: mockCreate,
        authenticateWithRedirect: mockAuthenticateWithRedirect,
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (useSignUp as Mock).mockReturnValue(mockSignUpReturn());
    (useClerk as Mock).mockReturnValue({ setActive: mockSetActive });
  });

  it('renders the sign-up form with email, password, and confirm password fields', () => {
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('renders social login buttons for Google and GitHub', () => {
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up with github/i })).toBeInTheDocument();
  });

  it('renders a link to the sign-in page', () => {
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows loading state when sign-up is in progress', async () => {
    mockCreate.mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing up/i })).toBeDisabled();
    });
  });

  it('displays error message when sign-up fails', async () => {
    mockCreate.mockRejectedValue({
      errors: [{ message: 'Email address already exists' }],
    });

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'taken@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/email address already exists/i);
    });
  });

  it('calls onSuccess after successful sign-up', async () => {
    mockCreate.mockResolvedValue({
      createdSessionId: 'sess_123',
      status: 'complete',
    });

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith('/');
    });
  });

  it('calls authenticateWithRedirect for Google OAuth', async () => {
    mockAuthenticateWithRedirect.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.click(screen.getByRole('button', { name: /sign up with google/i }));

    await waitFor(() => {
      expect(mockAuthenticateWithRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'oauth_google' }),
      );
    });
  });

  it('calls authenticateWithRedirect for GitHub OAuth', async () => {
    mockAuthenticateWithRedirect.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.click(screen.getByRole('button', { name: /sign up with github/i }));

    await waitFor(() => {
      expect(mockAuthenticateWithRedirect).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'oauth_github' }),
      );
    });
  });

  it('displays OAuth error when social sign-up fails', async () => {
    mockAuthenticateWithRedirect.mockRejectedValue({
      errors: [{ message: 'OAuth provider error' }],
    });

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.click(screen.getByRole('button', { name: /sign up with google/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/oauth provider error/i);
    });
  });

  it('uses redirect search param on success', async () => {
    mockCreate.mockResolvedValue({
      createdSessionId: 'sess_123',
      status: 'complete',
    });

    const originalLocation = window.location;
    vi.stubGlobal('location', { ...originalLocation, search: '?redirect=/upload' });

    const user = userEvent.setup();
    render(<SignUpForm onSuccess={mockOnSuccess} />);

    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledWith('/upload');
    });

    vi.stubGlobal('location', originalLocation);
  });
});