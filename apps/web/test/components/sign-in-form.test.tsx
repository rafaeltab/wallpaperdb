import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/react', () => ({
  useSignIn: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

import { useSignIn } from '@clerk/react';
import { SignInForm } from '@/components/sign-in-form';

describe('SignInForm', () => {
  const mockPassword = vi.fn();
  const mockFinalize = vi.fn();
  const mockSso = vi.fn();
  const mockReset = vi.fn();
  const mockSendEmailCode = vi.fn();

  function mockSignInReturn(overrides: Record<string, unknown> = {}) {
    return {
      signIn: {
        password: mockPassword,
        finalize: mockFinalize,
        sso: mockSso,
        reset: mockReset,
        status: 'complete',
        supportedSecondFactors: [],
        mfa: { sendEmailCode: mockSendEmailCode },
      },
      errors: null,
      fetchStatus: 'idle',
      ...overrides,
    };
  }

  async function submitCredentials(email: string, password: string) {
    // These tests cover submitted values, not per-keystroke behavior. Avoid a timer per character.
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (useSignIn as Mock).mockReturnValue(mockSignInReturn());
  });

  it('renders the sign-in form with email and password fields', () => {
    render(<SignInForm />);

    expect(screen.getByTestId('sign-in-form')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-email-input')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-password-input')).toBeInTheDocument();
    expect(screen.getByTestId('sign-in-submit-button')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('renders social login buttons for Google and GitHub', () => {
    render(<SignInForm />);

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument();
  });

  it('renders a link to the sign-up page', () => {
    render(<SignInForm />);

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toBeInTheDocument();
    expect(signUpLink).toHaveAttribute('href', '/sign-up');
  });

  it('shows loading state when sign-in is in progress', () => {
    (useSignIn as Mock).mockReturnValue(mockSignInReturn({ fetchStatus: 'fetching' }));

    render(<SignInForm />);

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('displays error message when sign-in fails', () => {
    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({
        errors: {
          global: [
            { code: 'form_password_incorrect', message: 'The password you entered is incorrect.' },
          ],
          fields: { identifier: null, password: null },
        },
      })
    );

    render(<SignInForm />);

    expect(screen.getByTestId('sign-in-error-alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/password you entered is incorrect/i);
  });

  it('displays field-level error message', () => {
    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({
        errors: {
          global: null,
          fields: { identifier: { message: 'Invalid email' }, password: null },
        },
      })
    );

    render(<SignInForm />);

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid email/i);
  });

  it('calls signIn.finalize after successful sign-in', async () => {
    mockPassword.mockResolvedValue({
      error: null,
      status: 'complete',
    });
    mockFinalize.mockResolvedValue(undefined);

    render(<SignInForm />);

    await submitCredentials('test@example.com', 'password123');

    expect(mockPassword).toHaveBeenCalledExactlyOnceWith({
      emailAddress: 'test@example.com',
      password: 'password123',
    });
    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith(
        expect.objectContaining({ navigate: expect.any(Function) })
      );
    });
  });

  it('does not call finalize when password returns an error', async () => {
    const passwordResult = Promise.resolve({ error: { code: 'form_password_incorrect' } });
    mockPassword.mockReturnValue(passwordResult);
    mockFinalize.mockResolvedValue(undefined);

    render(<SignInForm />);

    await submitCredentials('test@example.com', 'wrongpassword');

    expect(mockPassword).toHaveBeenCalledExactlyOnceWith({
      emailAddress: 'test@example.com',
      password: 'wrongpassword',
    });
    // Settle the password response and React effects before asserting no finalization.
    await act(async () => {
      await passwordResult;
    });
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('calls signIn.sso for Google OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    render(<SignInForm />);

    await userEvent.click(screen.getByRole('button', { name: /sign in with google/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'oauth_google' }));
    });
  });

  it('calls signIn.sso for GitHub OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    render(<SignInForm />);

    await userEvent.click(screen.getByRole('button', { name: /sign in with github/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'oauth_github' }));
    });
  });

  it('calls mfa.sendEmailCode when sign-in requires second factor', async () => {
    mockPassword.mockResolvedValue({ error: null });
    mockSendEmailCode.mockResolvedValue(undefined);

    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({
        signIn: {
          password: mockPassword,
          finalize: mockFinalize,
          sso: mockSso,
          reset: mockReset,
          status: 'needs_second_factor',
          supportedSecondFactors: [{ strategy: 'email_code' }],
          mfa: { sendEmailCode: mockSendEmailCode },
        },
        fetchStatus: 'idle',
      })
    );

    render(<SignInForm />);

    await submitCredentials('test@example.com', 'password123');

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledOnce();
    });
  });

  it('sign-up link navigates to /sign-up', () => {
    render(<SignInForm />);

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toHaveAttribute('href', '/sign-up');
  });
});
