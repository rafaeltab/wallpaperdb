# Maintaining the coding guidelines

Scope: authority and maintenance of the coding guidelines across the repository.

## Authority and applicability

- [CODING_STANDARDS.md](../../CODING_STANDARDS.md) indexes the authoritative coding guidelines. Each guideline defines its scope; all applicable rules remain binding regardless of when they are consulted. Workflow instructions govern when guidelines are read and checked.
- These guidelines define the required end state, including existing code within their scope. Implementation examples, historical plans, and guidance elsewhere do not add coding standards unless adopted into this collection.
- Coding guidelines do not govern development workflows, agent behavior, contribution processes, or migration planning. Sandcastle, skills, and their respective workflow instructions remain separate and authoritative within their scopes.
- Project-wide rules apply across workspaces. Backend rules apply to backend code and are not automatically requirements for frontend code. Frontend-specific guidelines have not yet been established.
- Applicability follows the responsibilities touched by a change, not merely its folder. No guideline document is mandatory reading for every task; the relevant workflow determines when guidance is consulted or reviewed.

## Organization

- Keep the root entry point an index only, with links describing when the destination applies.
- Give each rule one authoritative home. Reference shared rules with contextual links rather than copying them into every topic.
- Use progressive disclosure: make it clear which further sections apply to the work at hand. Avoid unconditional reading lists that require the entire collection.
- Split a document when the volume of rules and clearly cohesive groups justify separate documents. An architectural boundary alone does not justify a file; keep small related groups as sections and link to those sections.
- Place testing guidance with the subject being tested. Keep only broadly applicable testing principles in a shared section.
- State scope explicitly. Keep project-wide organization separate from backend requirements, and develop frontend guidance on its own terms.
- Preserve rule meaning when reorganizing or improving readability. Identify substantive policy changes explicitly; do not present them as reorganization or readability edits. Moving text must not silently change requirements.
- Formatting, import ordering, type strictness, and other mechanically checkable syntax belong in tool configuration. Semantic design constraints belong in the guidelines even when mechanically enforced.

For the current topic map, return to the [guideline index](../../CODING_STANDARDS.md).
