## Coding standards

Use the [coding guidelines index](CODING_STANDARDS.md) to select the authoritative guidelines relevant to the work. Skills and contribution guides govern their respective workflows; implementation examples do not add coding standards.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

WallpaperDB uses a multi-context layout rooted at `CONTEXT-MAP.md`; system-wide ADRs live in `docs/adr/`. See `docs/agents/domain.md`.

### Documentation

Keep documentation for setup pitfalls, domain language, decisions and their rationale, and policies that cannot be inferred from code. Link to source for commands, configuration, APIs, and implementation details. Update the existing authoritative document instead of adding another explanation of the same topic. Track unfinished work in issues; keep temporary handoffs and investigation notes outside the repository.
