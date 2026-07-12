# Domain Docs

WallpaperDB uses a multi-context domain documentation layout.

## Before exploring

- Read `CONTEXT-MAP.md` at the repository root.
- Read each context `CONTEXT.md` relevant to the task.
- Read relevant system-wide decisions in `docs/adr/`.
- Read context-local ADRs when the context has a `docs/adr/` directory.

If a context glossary or ADR directory does not exist, proceed silently. Domain documentation is created lazily when terms or decisions are resolved.

## Layout

```text
/
|-- CONTEXT-MAP.md
|-- docs/adr/                  # system-wide decisions
|-- apps/
|   |-- user/
|       |-- CONTEXT.md
|       |-- docs/adr/          # optional context-local decisions
```

## Vocabulary

Use each context glossary's canonical terms in issue titles, specifications, tests, and code. Avoid synonyms explicitly listed by the glossary.

If an implementation proposal conflicts with an ADR, surface the conflict rather than silently overriding it.
