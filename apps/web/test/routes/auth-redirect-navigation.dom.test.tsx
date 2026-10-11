import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as SignInRoute } from '@/routes/sign-in';
import { Route as SignUpRoute } from '@/routes/sign-up';

const auth = vi.hoisted(() => {
  const password = vi.fn();
  const reset = vi.fn();
  const sso = vi.fn();
  const finalize = vi.fn(
    async ({
      navigate,
    }: {
      navigate: (input: { session: null; decorateUrl: (url: string) => string }) => Promise<void>;
    }) => navigate({ session: null, decorateUrl: (url) => url })
  );
  return {
    password,
    reset,
    sso,
    finalize,
    signIn: {
      password,
      reset,
      sso,
      finalize,
      status: 'complete',
      supportedSecondFactors: [],
      mfa: { sendEmailCode: vi.fn() },
    },
    signUp: {
      password,
      reset,
      sso,
      finalize,
      status: 'complete',
      verifications: { sendEmailCode: vi.fn(), verifyEmailCode: vi.fn() },
    },
  };
});
vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
  useSignIn: () => ({ signIn: auth.signIn, errors: null, fetchStatus: 'idle' }),
  useSignUp: () => ({ signUp: auth.signUp, errors: null, fetchStatus: 'idle' }),
}));

function setup(path: '/sign-in' | '/sign-up') {
  window.history.replaceState(null, '', `${path}?redirect=%2Fupload`);
  const root = createRootRoute();
  const login = createRoute({
    getParentRoute: () => root,
    path: '/sign-in',
    component: SignInRoute.options.component,
    validateSearch: SignInRoute.options.validateSearch,
  });
  const register = createRoute({
    getParentRoute: () => root,
    path: '/sign-up',
    component: SignUpRoute.options.component,
    validateSearch: SignUpRoute.options.validateSearch,
  });
  const upload = createRoute({
    getParentRoute: () => root,
    path: '/upload',
    component: () => <div>Upload destination</div>,
  });
  const profile = createRoute({
    getParentRoute: () => root,
    path: '/settings/profile',
    component: () => <div>Profile destination</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([login, register, upload, profile]),
    history: createMemoryHistory({ initialEntries: [`${path}?redirect=%2Fupload`] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
function credentials() {
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'Password123!' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.password.mockResolvedValue({ error: null });
  auth.reset.mockResolvedValue(undefined);
  auth.sso.mockResolvedValue(undefined);
  auth.signIn.status = 'complete';
  auth.signUp.status = 'complete';
  auth.signUp.verifications.sendEmailCode.mockResolvedValue({ error: null });
  auth.signUp.verifications.verifyEmailCode.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

it.each([
  '/sign-in',
  '/sign-up',
] as const)('uses live router search for a new OAuth attempt on %s without remounting the form', async (path) => {
  const router = setup(path);
  const email = await screen.findByLabelText(/^email$/i);
  credentials();
  await act(() => router.navigate({ to: path, search: { redirect: '/settings/profile' } }));
  expect(screen.getByLabelText(/^email$/i)).toBe(email);
  expect(email).toHaveValue('test@example.com');
  fireEvent.click(screen.getByRole('button', { name: /with google/i }));
  await waitFor(() =>
    expect(auth.sso).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: expect.stringContaining('/settings/profile') })
    )
  );
});

it.each([
  '/sign-in',
  '/sign-up',
] as const)('uses live router search for a new password attempt on %s', async (path) => {
  const router = setup(path);
  await screen.findByLabelText(/^email$/i);
  await act(() => router.navigate({ to: path, search: { redirect: '/settings/profile' } }));
  credentials();
  fireEvent.click(
    screen.getByRole('button', { name: path === '/sign-in' ? /^sign in$/i : /^sign up$/i })
  );
  expect(await screen.findByText('Profile destination')).toBeInTheDocument();
});

it.each([
  '/sign-in',
  '/sign-up',
] as const)('preserves the accepted password attempt destination on %s when router search changes while pending', async (path) => {
  let complete!: (result: { error: null }) => void;
  auth.password.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  const router = setup(path);
  await screen.findByLabelText(/^email$/i);
  credentials();
  fireEvent.click(
    screen.getByRole('button', { name: path === '/sign-in' ? /^sign in$/i : /^sign up$/i })
  );
  await act(() => router.navigate({ to: path, search: { redirect: '/settings/profile' } }));
  await act(async () => complete({ error: null }));
  expect(await screen.findByText('Upload destination')).toBeInTheDocument();
});

it('keeps the sign-up destination across the email verification step', async () => {
  auth.signUp.status = 'missing_requirements';
  const router = setup('/sign-up');
  await screen.findByLabelText(/^email$/i);
  credentials();
  fireEvent.click(screen.getByRole('button', { name: /^sign up$/i }));
  const code = await screen.findByLabelText(/verification code/i);
  await act(() => router.navigate({ to: '/sign-up', search: { redirect: '/settings/profile' } }));
  auth.signUp.status = 'complete';
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /^verify email$/i }));
  expect(await screen.findByText('Upload destination')).toBeInTheDocument();
});

it.each([
  '/sign-in',
  '/sign-up',
] as const)('preserves the accepted OAuth destination on %s while SDK reset is pending', async (path) => {
  let reset!: () => void;
  auth.reset.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        reset = resolve;
      })
  );
  const router = setup(path);
  await screen.findByLabelText(/^email$/i);
  fireEvent.click(screen.getByRole('button', { name: /with google/i }));
  await act(() => router.navigate({ to: path, search: { redirect: '/settings/profile' } }));
  await act(async () => reset());
  expect(auth.sso).toHaveBeenCalledWith(
    expect.objectContaining({ redirectUrl: expect.stringContaining('/upload') })
  );
});
