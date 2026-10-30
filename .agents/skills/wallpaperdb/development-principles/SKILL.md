---
name: development-principles
description: "Core development principles for this repository: TDD, incremental changes, documentation, migration strategy, and command execution policy. Use when starting any implementation task, making code changes, refactoring, or running build/test commands."
---

# Development principles

## Test-first development (TDD)

For defect fixes, follow [defect verification](../testing/SKILL.md#verify-defect-fixes).

Write a test before each implementation change. A change is complete only when its covering test passes.

## Incremental changes

Make small, focused changes. Extract or migrate one piece at a time, testing each increment before continuing.

## Documentation

Follow [AGENTS.md](../../../../AGENTS.md#documentation). Record new system-wide decisions in `docs/adr/` and context-specific decisions beside the context. Preserve existing ADRs. Update the authoritative guide when a workflow or non-obvious constraint changes; code changes do not need a parallel implementation document. Track unfinished work in GitHub issues.

## Migration strategy

When changing existing structure:

1. Create the new structure alongside the old
2. Migrate piece by piece, verifying tests pass after each piece
3. Remove the old structure only after migration is complete

## Command execution policy

- Run repository tasks through Make, not raw `pnpm` or `turbo`. Use `make help` to discover commands.
- Use shared targets with `PACKAGE=<workspace>` for workspace tasks.
- Use `make run PACKAGE=<workspace> SCRIPT=<script>` for package-specific scripts.
- Add a Make target only for a new repository-wide workflow:
  1. Edit `Makefile` following existing patterns.
  2. Declare it `.PHONY` and add a `##` description for generated help.
  3. Test with `make <new-command>`.
