import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@clerk/react', () => ({
  useSignUp: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

import { useSignUp } from '@clerk/react';
import { SignUpForm } from '@/components/sign-up-form';

describe('SignUpForm', () => {
  const mockPassword = vi.fn();
  const mockFinalize = vi.fn();
  const mockSso = vi.fn();
  const mockReset = vi.fn();
  const mockSendEmailCode = vi.fn();
  const mockVerifyEmailCode = vi.fn();

  function mockSignUpReturn(overrides: Record<string, unknown> = {}) {
    return {
      signUp: {
        password: mockPassword,
        finalize: mockFinalize,
        sso: mockSso,
        reset: mockReset,
        status: 'complete',
        verifications: {
          sendEmailCode: mockSendEmailCode,
          verifyEmailCode: mockVerifyEmailCode,
        },
      },
      errors: null,
      fetchStatus: 'idle',
      ...overrides,
    };
  }

  async function submitCredentials(email: string, password: string) {
    // These tests cover submitted values, not per-keystroke behavior. Avoid a timer per character.
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
    await userEvent.click(screen.getByRole('button', { name: /^sign up$/i }));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (useSignUp as Mock).mockReturnValue(mockSignUpReturn());
  });

  it('renders the sign-up form with email and password fields', () => {
    render(<SignUpForm />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('renders social login buttons for Google and GitHub', () => {
    render(<SignUpForm />);

    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up with github/i })).toBeInTheDocument();
  });

  it('renders a link to the sign-in page', () => {
    render(<SignUpForm />);

    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows loading state when sign-up is in progress', () => {
    (useSignUp as Mock).mockReturnValue(mockSignUpReturn({ fetchStatus: 'fetching' }));

    render(<SignUpForm />);

    expect(screen.getByRole('button', { name: /signing up/i })).toBeDisabled();
  });

  it('displays error message when sign-up fails', () => {
    (useSignUp as Mock).mockReturnValue(
      mockSignUpReturn({
        errors: {
          global: [{ code: 'signup_rate_limit_exceeded', message: 'Too many sign up attempts' }],
          fields: { emailAddress: null, password: null },
        },
      })
    );

    render(<SignUpForm />);

    expect(screen.getByRole('alert')).toHaveTextContent(/too many sign up attempts/i);
  });

  it('displays field-level error message', () => {
    (useSignUp as Mock).mockReturnValue(
      mockSignUpReturn({
        errors: {
          global: null,
          fields: { emailAddress: { message: 'Invalid email format' }, password: null },
        },
      })
    );

    render(<SignUpForm />);

    expect(screen.getByRole('alert')).toHaveTextContent(/invalid email format/i);
  });

  it('calls signUp.finalize after successful sign-up', async () => {
    mockPassword.mockResolvedValue({ error: null });
    mockFinalize.mockResolvedValue(undefined);

    render(<SignUpForm />);

    await submitCredentials('new@example.com', 'Password123!');

    expect(mockPassword).toHaveBeenCalledExactlyOnceWith({
      emailAddress: 'new@example.com',
      password: 'Password123!',
    });
    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith(
        expect.objectContaining({ navigate: expect.any(Function) })
      );
    });
  });

  it('does not call finalize when password returns an error', async () => {
    const passwordResult = Promise.resolve({ error: { code: 'form_password_pwned' } });
    mockPassword.mockReturnValue(passwordResult);
    mockFinalize.mockResolvedValue(undefined);

    render(<SignUpForm />);

    await submitCredentials('new@example.com', 'Password123!');

    expect(mockPassword).toHaveBeenCalledExactlyOnceWith({
      emailAddress: 'new@example.com',
      password: 'Password123!',
    });
    // Settle the password response and React effects before asserting no finalization.
    await act(async () => {
      await passwordResult;
    });
    expect(mockFinalize).not.toHaveBeenCalled();
  });

  it('calls signUp.sso for Google OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    render(<SignUpForm />);

    await userEvent.click(screen.getByRole('button', { name: /sign up with google/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'oauth_google' }));
    });
  });

  it('calls signUp.sso for GitHub OAuth', async () => {
    mockSso.mockResolvedValue(undefined);
    mockReset.mockResolvedValue(undefined);

    render(<SignUpForm />);

    await userEvent.click(screen.getByRole('button', { name: /sign up with github/i }));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalled();
      expect(mockSso).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'oauth_github' }));
    });
  });

  it('shows verification form when sign-up requires verification', async () => {
    mockPassword.mockResolvedValue({ error: null });
    mockSendEmailCode.mockResolvedValue(undefined);

    (useSignUp as Mock).mockReturnValue(
      mockSignUpReturn({
        signUp: {
          password: mockPassword,
          finalize: mockFinalize,
          sso: mockSso,
          reset: mockReset,
          status: 'missing_requirements',
          verifications: { sendEmailCode: mockSendEmailCode, verifyEmailCode: mockVerifyEmailCode },
        },
        fetchStatus: 'idle',
      })
    );

    render(<SignUpForm />);

    await submitCredentials('new@example.com', 'Password123!');

    await waitFor(() => {
      expect(mockSendEmailCode).toHaveBeenCalledOnce();
      expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });
  });

  it('displays verification error from fields when verification code fails', async () => {
    mockPassword.mockResolvedValue({ error: null });
    mockSendEmailCode.mockResolvedValue(undefined);
    const verificationResult = Promise.resolve({ error: { code: 'form_code_incorrect' } });
    mockVerifyEmailCode.mockReturnValue(verificationResult);

    const signUpState = mockSignUpReturn({
      signUp: {
        ...mockSignUpReturn().signUp,
        status: 'missing_requirements',
      },
    });
    (useSignUp as Mock).mockReturnValue(signUpState);

    const { rerender } = render(<SignUpForm />);

    await submitCredentials('new@example.com', 'Password123!');

    const codeInput = await screen.findByLabelText(/verification code/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(codeInput, { target: { value: '123456' } });
    await userEvent.click(screen.getByRole('button', { name: /^verify email$/i }));

    expect(mockVerifyEmailCode).toHaveBeenCalledExactlyOnceWith({ code: '123456' });
    await act(async () => {
      await verificationResult;
    });

    // Clerk publishes errors through the hook after verification settles.
    (useSignUp as Mock).mockReturnValue({
      ...signUpState,
      errors: {
        global: null,
        fields: { code: { message: 'The verification code you entered is incorrect.' } },
      },
    });
    rerender(<SignUpForm />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The verification code you entered is incorrect.'
    );
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    expect(mockFinalize).not.toHaveBeenCalled();
  });
});
