# Shared Vitest configuration

Workspaces can override these test output and coverage defaults:

- Suppresses console output for passing tests and retains it for failures.
- Sets a slow-test threshold for tests using real infrastructure.
- Produces coverage for local inspection, repository-wide merging, and Codecov.

Workspaces using a different Vitest major should compose the runtime-independent [defaults](src/defaults.ts) with their own configuration. Other workspaces can use the [shared configuration factory](src/index.ts).
