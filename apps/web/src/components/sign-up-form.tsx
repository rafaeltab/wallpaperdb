import { useSignUp } from '@clerk/react';
import { Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatClerkGlobalErrors } from '@/lib/auth/clerk-errors';

function buildUrl(path: string): string {
  const basePath = import.meta.env.VITE_BASE_PATH || '';
  const full = `${basePath}${path.startsWith('/') ? '' : '/'}${path}`;
  return full.replace(/\/+/g, '/') || '/';
}

export function SignUpForm() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [redirectUrl] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('redirect') || '/';
  });

  const isSubmitting = fetchStatus === 'fetching';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!signUp) return;

    const { error } = await signUp.password({
      emailAddress: email,
      password,
    });

    if (error) return;

    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: async ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl(redirectUrl);
          if (url.startsWith('http')) {
            window.location.href = url;
          } else {
            void navigate({ to: url });
          }
        },
      });
    } else if (signUp.status === 'missing_requirements') {
      await signUp.verifications.sendEmailCode();
      setPendingVerification(true);
    }
  };

  const handleVerification = async (e: FormEvent) => {
    e.preventDefault();
    if (!signUp) return;

    const { error } = await signUp.verifications.verifyEmailCode({ code: verificationCode });

    if (error) return;

    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: async ({ session, decorateUrl }) => {
          if (session?.currentTask) return;
          const url = decorateUrl(redirectUrl);
          if (url.startsWith('http')) {
            window.location.href = url;
          } else {
            void navigate({ to: url });
          }
        },
      });
    }
  };

  const handleOAuthSignUp = async (strategy: 'oauth_google' | 'oauth_github') => {
    if (!signUp) return;

    await signUp.reset();
    await signUp.sso({
      strategy,
      redirectUrl: buildUrl(redirectUrl),
      redirectCallbackUrl: buildUrl('/sso-callback'),
    });
  };

  if (pendingVerification) {
    return (
      <Card className="border-0 shadow-none sm:border sm:shadow-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Verify your email</CardTitle>
          <CardDescription>
            We sent a verification code to {email}. Enter it below to complete your sign-up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleVerification} className="grid gap-4">
            {(errors?.fields?.code) && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {errors.fields.code.message}
              </div>
            )}
            {formatClerkGlobalErrors(errors?.global) && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {formatClerkGlobalErrors(errors?.global)}
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="verificationCode">Verification code</FieldLabel>
              <Input
                id="verificationCode"
                type="text"
                placeholder="Enter verification code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                required
                disabled={isSubmitting}
                autoComplete="one-time-code"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {fetchStatus === 'fetching' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {fetchStatus === 'fetching' ? 'Verifying...' : 'Verify email'}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-none sm:border sm:shadow-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign up</CardTitle>
        <CardDescription>Create an account to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {(errors?.fields?.emailAddress || errors?.fields?.password) && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {errors?.fields?.emailAddress?.message || errors?.fields?.password?.message}
            </div>
          )}
          {formatClerkGlobalErrors(errors?.global) && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {formatClerkGlobalErrors(errors?.global)}
            </div>
          )}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isSubmitting}
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          </Field>
          <div id="clerk-captcha" data-cl-size="flexible" />
          <Button type="submit" className="w-full" disabled={isSubmitting || !signUp}>
            {fetchStatus === 'fetching' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {fetchStatus === 'fetching' ? 'Signing up...' : 'Sign up'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-2">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">or continue with</span>
          <div className="flex-1 border-t" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={() => void handleOAuthSignUp('oauth_google')}
            disabled={isSubmitting || !signUp}
            aria-label="Sign up with Google"
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Google
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => void handleOAuthSignUp('oauth_github')}
            disabled={isSubmitting || !signUp}
            aria-label="Sign up with GitHub"
          >
            <svg
              className="mr-2 h-4 w-4"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </Button>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/sign-in"
            className="text-primary underline underline-offset-4 hover:text-primary/80"
          >
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}