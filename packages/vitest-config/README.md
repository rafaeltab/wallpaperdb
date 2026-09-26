# Shared Vitest configuration

Shared Vitest configuration keeps workspace test output and coverage conventions consistent. Workspaces can add their own settings while inheriting the repository defaults.

## Core capabilities

- Suppresses console output for passing tests while retaining output for failures.
- Sets a slow-test threshold suitable for tests that use real infrastructure.
- Produces coverage reports for local inspection, repository-wide merging, and Codecov.

Workspaces using a different Vitest major should import the runtime-independent [defaults entry point](src/defaults.ts) and compose it with their own Vitest configuration. Other workspaces can use the [shared configuration factory](src/index.ts).
