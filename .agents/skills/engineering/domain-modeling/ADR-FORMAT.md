# ADR format

Use sequential filenames in `docs/adr/`: `0001-slug.md`, `0002-slug.md`. Create the directory with the first ADR.

## Template

```md
# {Short decision title}

{1-3 sentences giving context, the decision, and why it was chosen.}
```

## Optional sections

Include only when needed:

- Status frontmatter: `proposed | accepted | deprecated | superseded by ADR-NNNN`.
- Considered options worth remembering.
- Non-obvious consequences.

## Numbering

Scan the directory for the highest existing number and increment it.

## When to offer an ADR

Apply the [ADR criteria](SKILL.md#offer-adrs-sparingly): hard to reverse, surprising without context, and the result of a real trade-off.

### What qualifies

Examples include architectural choices, cross-context integration or ownership, technology lock-in, non-obvious rejected alternatives, and constraints absent from code. Record deliberate deviations that a future reader might otherwise undo.
