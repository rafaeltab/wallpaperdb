## Coding standards

Use the [coding guidelines index](CODING_STANDARDS.md) to select the authoritative guidelines relevant to the work. Skills govern their respective workflows; implementation examples do not add coding standards.

## Environment

For setup, execution, and tool-version assumptions, read [mise.toml](mise.toml) and [Makefile](Makefile). Run repository tasks through Make and direct tool commands through `mise exec --`; verify effective selection with `make toolchain`.

## Agent skills

For skill installation, updates, or moves, follow the [skill layout](.agents/skills/README.md).

### Task scope

Read [task scope](docs/agents/task-scope.md) when planning, implementing, reviewing, delegating, monitoring, or automatically picking up work, and when resuming any of those workflows.

### Issue tracker

Issues and specs are tracked in GitHub Issues, with membership and lifecycle status in the WallpaperDB GitHub Project. Read `docs/agents/issue-tracker.md` when creating, planning, implementing, reopening, or reviewing issue work. External pull requests are not a triage surface.

### Triage labels

Use the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

WallpaperDB uses a multi-context layout rooted at `GLOSSARY-MAP.md`; system-wide ADRs live in `docs/adr/`. See `docs/agents/domain.md`.

### Documentation

Keep documentation for setup pitfalls, domain language, decisions and their rationale, and policies that cannot be inferred from code. Link to source for commands, configuration, APIs, and implementation details. Update the existing authoritative document instead of adding another explanation of the same topic. Track unfinished work in issues; keep temporary handoffs and investigation notes outside the repository.
