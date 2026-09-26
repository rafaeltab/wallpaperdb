## Coding standards

Use the [coding guidelines index](CODING_STANDARDS.md) to select the authoritative guidelines relevant to the work. Skills and contribution guides govern their respective workflows; implementation examples do not add coding standards.

## Repository workflow

### Issue tracker

Issues and PRDs live in GitHub Issues. Use `gh` from this clone so it resolves the repository from the Git remote. External pull requests are not a triage surface.

- Fetch an issue's full body, comments, and labels before working on it.
- When a skill says to publish to the issue tracker, create a GitHub issue.
- Use native sub-issues for parent-child relationships and native dependencies for blocking edges. If unavailable, record `Parent: #<number>` and `Blocked by: #<number>` in the body.
- An issue is ready to work when all its blocking issues are closed.
- Use the [GitHub Markdown skill](.agents/skills/github-markdown-bodies/SKILL.md) for multiline bodies.

### Triage labels

| Label | Meaning |
| --- | --- |
| `needs-triage` | A maintainer needs to evaluate the issue |
| `needs-info` | Waiting on the reporter for information |
| `ready-for-agent` | Fully specified and ready for an unattended agent |
| `ready-for-human` | Requires human implementation |
| `wontfix` | Will not be actioned |

### Domain docs

Start with [CONTEXT-MAP.md](CONTEXT-MAP.md), then read the relevant context's `CONTEXT.md` and ADRs. System-wide decisions live in `docs/adr/`; contexts may have their own `docs/adr/`. Older decisions remain in `apps/docs/content/docs/architecture/decisions/`.

Use canonical glossary terms in issues, specifications, tests, and code. Surface conflicts with an ADR before proposing a different direction. Create missing glossaries and ADR directories only when there is a resolved term or decision to record.

### Documentation

Keep documentation for setup pitfalls, domain language, decisions and their rationale, and policies that cannot be inferred from code. Link to source for commands, configuration, APIs, and implementation details. Update the existing authoritative document instead of adding another explanation of the same topic. Track unfinished work in issues; keep temporary handoffs and investigation notes outside the repository.
