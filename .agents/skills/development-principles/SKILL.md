---
name: development-principles
description: Core development principles for this repository: TDD, incremental changes, documentation, migration strategy, and command execution policy. Use when starting any implementation task, making code changes, refactoring, or running build/test commands.
---

# Development Principles

## Test-First Development (TDD)

- **Write tests before implementation** — every change must have a corresponding test
- Tests validate the change works; implementation follows the test
- No change is complete without a passing test that covers it

## Incremental Changes

- Make **small, focused changes** — one thing at a time
- Never big-bang refactoring; extract or migrate **one piece at a time**
- Test after each increment before moving to the next

## Document As You Go

When architecture or significant decisions change:

- Update `apps/docs/content/docs/` (rendered via `make dev PACKAGE=docs`)
- Create ADRs in `apps/docs/content/docs/architecture/decisions/`
- Update `plans/` when decisions are made or plans evolve

## Migration Strategy

When changing existing structure:

1. Create the new structure **alongside** the old
2. Migrate piece by piece, verifying tests pass after each piece
3. Remove old structure **only** after migration is fully complete

## Command Execution Policy

- **Always use Make** — run `make help` to discover available commands
- **Never use raw `pnpm` or `turbo` commands** directly in terminal
- Use shared targets with `PACKAGE=<workspace>` for workspace tasks.
- Use `make run PACKAGE=<workspace> SCRIPT=<script>` for package-specific scripts.
- Add a Make target only for a new repository-wide workflow:
  1. Edit `Makefile` following existing patterns.
  2. Declare it `.PHONY` and add a `##` description for generated help.
  3. Test with `make <new-command>`.
