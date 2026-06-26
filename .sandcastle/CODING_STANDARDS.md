# WallpaperDB Sandcastle Coding Standards

## General

- Keep changes small, issue-scoped, and easy to review.
- Prefer explicit, boring TypeScript over clever abstractions.
- Preserve existing public behavior unless the issue explicitly requests a behavior change.
- Do not leave commented-out code, vague TODOs, or unrelated cleanup in commits.

## TypeScript

- Keep type safety strong: avoid `any`, unsafe casts, and unchecked non-null assertions unless they are narrowly justified.
- Prefer named exports and existing workspace conventions.
- Keep GraphQL/API contracts aligned with existing schema/resolver patterns.

## Testing and Verification

- Follow Red → Green → Refactor for bug fixes or new behavior: add/adjust a failing test first when practical.
- Run the narrowest relevant test while implementing, then run the broader checks before committing.
- Before closing an issue, run the full repository CI command from the sandbox:

```bash
make ci
```

- If `make ci` fails because of a pre-existing or unrelated issue, document the exact failure in the issue instead of closing it.

## Docker/Sandbox Awareness

- The sandbox has Docker socket access specifically so Testcontainers and the full `make ci` suite can run inside the sandbox.
- Do not modify `.sandcastle/.env`, OpenCode credentials, GitHub tokens, or host-specific secrets.
