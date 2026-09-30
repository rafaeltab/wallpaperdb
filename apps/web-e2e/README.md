# Browser journeys

This workspace tests complete user journeys in the WallpaperDB web application. Playwright drives a real browser through the same ingress used for local development, checking that the web UI and backend services work together.

## Core coverage

- Verifies that the seeded user can sign in through the web UI and reuses saved authentication state after a dedicated setup step.
- Uploads committed image fixtures through the authenticated UI and checks that every file completes successfully.
- Follows fresh uploads through the catalogue and colour and format filters, and compares a selected variant's declared dimensions with the browser's decoded pixels.
- Returns from an upload notification to the same queue and opens accessible wallpaper details with the keyboard.
- Uploads and removes Profile pictures, with a separate anonymous browser checking public delivery, the restored generated avatar, and `404` with `Cache-Control: no-store` for the retired URL.
- Checks service readiness before browser tests start and reports health diagnostics when the application stack is unavailable.

The suite requires the running application stack and a seeded Clerk account; it does not provision them. Browser journeys run separately from the default test command. E2E results are never cached because deployed services, infrastructure state, and credentials can change independently of this workspace. Follow [contributor setup](../../CONTRIBUTING.md).

The [Profile picture journey](specs/profile-picture-journey.spec.ts) creates a disposable Clerk test owner for each attempt and signs in through the application. It leaves the seeded user's picture and Profile fields unchanged. The [owner fixture](src/disposable-owner.ts) requires a `sk_test_` development key, rejects production keys before any request, and fails missing configuration instead of skipping the test. Cleanup targets only its own returned Clerk user ID, including after login or assertion failures. Cleanup errors fail the test. See the [authentication configuration resolver](src/auth-state.ts) and Clerk's [backend user creation](https://clerk.com/docs/reference/backend/user/create-user) and [test email guidance](https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows).

The [catalogue journey](specs/catalogue-journey.spec.ts) uploads unique pixels on every attempt and locates that uploaded ID in public search results. Existing images cannot hide a broken processing path. Uploaded wallpapers remain as isolated test data because the public application has no deletion flow.

Assertions wait for observable HTTP, projection, and DOM changes with deadlines. They use real application services and no fixed delays. Failed attempts retain screenshots, traces, and videos. Authentication state and browser reports are local artifacts and must stay out of Git.
