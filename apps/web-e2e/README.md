# Browser journeys

Playwright tests complete journeys through the local-development ingress and real application services.

- Sign in as the seeded user and reuse saved authentication state.
- Upload fixtures with per-file completion, follow their IDs through catalogue/color/format search, and compare declared rendition dimensions with decoded pixels.
- Return from upload notifications to the queue and open details with the keyboard.
- Upload and remove Profile pictures; verify anonymous delivery, generated-avatar restoration, and `404` with `Cache-Control: no-store` for retired URLs.
- Check readiness before testing and report stack health diagnostics on failure.

GitHub Actions runs the full suite. Local `make ci` excludes E2E; `make test-e2e PACKAGE=web-e2e` provisions and releases an isolated stack using development Clerk credentials and a seeded account. `ARGS` selects specs or Playwright options. See [local E2E setup](../../CONTRIBUTING.md#check-a-change) for prerequisites, ownership, deadlines and diagnostics. Results are never cached because external state and credentials can change independently.

The [picture journey](specs/profile-picture-journey.spec.ts) creates a disposable Clerk owner per attempt, leaving the seeded user's Profile unchanged. The [owner fixture](src/disposable-owner.ts) requires a `sk_test_` key, rejects production keys before requests, and fails missing configuration. Cleanup targets only the returned user ID, including after failures; cleanup errors fail the test. See the [auth resolver](src/auth-state.ts), Clerk's [user creation](https://clerk.com/docs/reference/backend/user/create-user) and [test email guidance](https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows).

The [catalogue journey](specs/catalogue-journey.spec.ts) uploads unique pixels per attempt so existing images cannot mask processing failures. Wallpapers remain as isolated test data because the application has no public deletion flow.

Assertions wait for observable HTTP, projection and DOM changes with deadlines, without fixed delays. Failures retain screenshots, traces and videos. Keep authentication state and browser reports out of Git.
