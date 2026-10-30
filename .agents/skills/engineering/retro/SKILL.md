---
name: retro
description: "Conduct a retrospective on a coding session."
disable-model-invocation: true
---

Suggest changes to the coding agent's environment that would improve future runs.

## Steps

1. Load `writing-for-agents`.
2. Read the specified session's primary sources, searching local logs if needed. Default to the current session.
3. Identify improvements in the categories below.
4. Present candidates in severity order.

Consider:

- **Navigation.** Missing pointers or hidden dependencies that delayed finding information.
- **Automated checks.** Mistakes linting, types, tests, or filesystem checks could catch. Read existing check commands and CI before proposing replacements. Unwired or broken checks, and the absence of both pre-commit and CI checks, are findings.
- **Coding standards.** Rules the reviewer missed, needs clarified, or no longer needs. Mechanical patterns require deterministic checks in the existing linter, hook, or CI. Prefer building those checks to adding prose rules. Reserve standards for judgment that cannot be automated.
- **Global instructions.** Oversized repository or user-level `AGENTS.md` content that belongs in standards or automated checks.
- **Tool economy.** Expensive calls or inefficient CLI and MCP tooling.
- **No-ops.** Steering instructions that do not change behavior.
- **Information access.** Missing logs, read-only service access, or other information that would have resolved a blocker.

## Reference

### Implementation vs Review

Implementation combines exploration, coding, and debugging under greater context pressure. Let the independent reviewer enforce coding standards.

### Files

- `CLAUDE.md` and `AGENTS.md` load into every agent's context. Keep them sparse, mainly navigation pointers.
- `CODING_STANDARDS.md` guides review. Above 1,000 lines, use pointers to supporting documents.
- Reuse existing reference docs before creating new ones.
- Skills provide references or user-invoked workflows. Follow `writing-for-agents` for their design.
