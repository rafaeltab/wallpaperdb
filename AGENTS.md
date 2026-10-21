## Coding standards

Use the [coding guidelines index](CODING_STANDARDS.md) to select the authoritative guidelines relevant to the work. Skills and contribution guides govern their respective workflows; implementation examples do not add coding standards.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues, with membership and lifecycle status in the WallpaperDB GitHub Project. Read `docs/agents/issue-tracker.md` when creating, planning, implementing, reopening, or reviewing issue work. External pull requests are not a triage surface.

### Triage labels

Use the five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Code factory

For scheduled code-quality discovery and automatic `ready-for-agent` pickup, use [code-factory](.agents/skills/code-factory/SKILL.md).

### Domain docs

WallpaperDB uses a multi-context layout rooted at `GLOSSARY-MAP.md`; system-wide ADRs live in `docs/adr/`. See `docs/agents/domain.md`.

### Documentation

Keep documentation for setup pitfalls, domain language, decisions and their rationale, and policies that cannot be inferred from code. Link to source for commands, configuration, APIs, and implementation details. Update the existing authoritative document instead of adding another explanation of the same topic. Track unfinished work in issues; keep temporary handoffs and investigation notes outside the repository.
