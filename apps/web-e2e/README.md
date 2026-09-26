# Browser journeys

This workspace tests complete user journeys in the WallpaperDB web application. Playwright drives a real browser through the same ingress used for local development, checking that the web UI and backend services work together.

## Core coverage

- Verifies that the seeded user can sign in through the web UI.
- Uploads committed image fixtures through the authenticated UI and checks that every file completes successfully.
- Reuses saved authentication state for authenticated journeys after a dedicated sign-in setup step.
- Checks service readiness before browser tests start and reports health diagnostics when the application stack is unavailable.

The suite requires the running application stack and a seeded Clerk account; it does not provision them. Browser journeys run separately from the default test command so they can require this integrated environment.

Follow [contributor setup](../../CONTRIBUTING.md). Authentication state and browser reports are local artifacts and must stay out of Git.
