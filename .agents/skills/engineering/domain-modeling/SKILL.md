---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a GLOSSARY.md, or recording or editing an ADR.
---

# Domain modeling

Challenge unclear terms, test domain relationships with concrete scenarios, and record resolved vocabulary and decisions during design. Reading an existing glossary alone does not require this skill.

## File structure

A single-context repo uses root `GLOSSARY.md` and `docs/adr/`. If root `GLOSSARY-MAP.md` exists, follow it to the relevant contexts. Their glossaries and context-specific ADRs live beside each context; system-wide ADRs stay in root `docs/adr/`.

Create a glossary when the first term is resolved, and an ADR directory when the first ADR is needed.

## During the session

### Challenge against the glossary

Point out conflicts with existing definitions and ask which meaning applies.

### Sharpen fuzzy language

Propose precise canonical terms for vague or overloaded words. Distinguish concepts currently sharing one name.

### Discuss concrete scenarios

Test domain relationships with edge cases that clarify the boundaries between concepts.

### Cross-reference with code

Check claimed behavior against the code. Surface contradictions for resolution.

### Update GLOSSARY.md inline

Record each resolved term immediately using [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md). Keep implementation details, specs, scratch notes, and implementation decisions out of the glossary.

### Offer ADRs sparingly

Offer an ADR only when the decision is all of:

1. Hard to reverse at meaningful cost.
2. Surprising without its context.
3. A choice among real alternatives with specific trade-offs.

Otherwise skip it. Use [ADR-FORMAT.md](ADR-FORMAT.md).
