import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/react', () => ({
  useSignIn: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
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

  beforeEach(() => {
    vi.clearAllMocks();
    (useSignIn as Mock).mockReturnValue(mockSignInReturn());
  });

  it('renders the sign-in form with email and password fields', () => {
    render(<SignInForm />);

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
    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({ fetchStatus: 'fetching' }),
    );

    render(<SignInForm />);

    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('displays error message when sign-in fails', async () => {
    mockPassword.mockResolvedValue({ error: null });
    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({
        errors: {
          global: [{ code: 'form_password_incorrect', message: 'The password you entered is incorrect.' }],
          fields: { identifier: null, password: null },
        },
        signIn: {
          password: mockPassword,
          finalize: mockFinalize,
          sso: mockSso,
          reset: mockReset,
          status: 'complete',
          supportedSecondFactors: [],
          mfa: { sendEmailCode: mockSendEmailCode },
        },
        fetchStatus: 'idle',
      }),
    );

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/password you entered is incorrect/i);
    });
  });

  it('displays field-level error message', async () => {
    mockPassword.mockResolvedValue({ error: null });
    (useSignIn as Mock).mockReturnValue(
      mockSignInReturn({
        errors: {
          global: null,
          fields: {
            identifier: { message: 'Invalid email' },
            password: null,
          },
        },
        signIn: {
          password: mockPassword,
          finalize: mockFinalize,
          sso: mockSso,
          reset: mockReset,
          status: 'complete',
          supportedSecondFactors: [],
          mfa: { sendEmailCode: mockSendEmailCode },
        },
        fetchStatus: 'idle',
      }),
    );

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email/i), 'bad@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid email/i);
    });
  });

  it('calls signIn.finalize after successful sign-in', async () => {
    mockPassword.mockResolvedValue({ error: null });
    mockFinalize.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith(
        expect.objectContaining({ navigate: expect.any(Function) }),
      );
    });
  });

  it('does not call finalize when password returns an error', async () => {
    mockPassword.mockResolvedValue({ error: { code: 'form_password_incorrect' } });
    mockFinalize.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockPassword).toHaveBeenCalled();
    });
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('calls signIn.sso for Google OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole('button', { name: /sign in with google/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'oauth_google' }),
      );
    });
  });

  it('calls signIn.sso for GitHub OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.click(screen.getByRole('button', { name: /sign in with github/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(
        expect.objectContaining({ strategy: 'oauth_github' }),
      );
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
      }),
    );

    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

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