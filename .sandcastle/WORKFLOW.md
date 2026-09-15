# WallpaperDB Sandcastle Workflow

Read [CODING_STANDARDS.md](../CODING_STANDARDS.md) for the repository's coding and testing requirements. This file covers Sandcastle execution.

## Change scope

- Keep changes small, issue-scoped, and easy to review.
- Preserve existing public behavior unless the issue explicitly requests a behavior change.

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
