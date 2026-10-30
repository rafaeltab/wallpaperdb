---
name: writing-for-agents
description: Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.
---

Reference for writing skills, `AGENTS.md`, `CLAUDE.md`, and documents agents reach through links. Aim for a predictable process across runs.

For skill frontmatter, invocation, and routers, read [SKILL-MECHANICS.md](SKILL-MECHANICS.md).

## Context pointers

A context pointer names material and the conditions for reading it. Skill descriptions and links in `AGENTS.md` are pointers. Their wording determines whether agents reach the target.

- State what the material covers and each distinct trigger branch.
- Put the main trigger first. Collapse synonyms for the same branch.
- Cut identity the body already carries.
- Sharpen a weak pointer before inlining its target. Always-loaded pointers cost context on every turn.

## The two loads

- Context load is always-loaded text, including agent instructions and skill descriptions.
- Cognitive load is the human's effort to remember which documents exist and when to use them. Spend it where human judgment matters.

A linked reference costs the pointer's context; an unlinked document relies on the human to find it.

## Information hierarchy

Place material by when the agent needs it:

1. In-file steps state the actions in order.
2. In-file reference holds definitions, rules, and facts needed across branches. Flat lists of peer rules are fine.
3. Disclosed reference lives in another file behind a conditional pointer.

Use progressive disclosure for branch-specific material; keep what every branch needs inline. Excess inline reference can bury steps, while excessive disclosure can hide necessary instructions. Split long documents even when every line is unique if their length obscures the current task.

Co-locate a concept's definition, rules, and caveats under one heading. Scattering fragments a meaning; duplication repeats it.

## Steps and completion criteria

Give every step a checkable completion criterion:

- Clarity distinguishes done from not done. Sharpen vague criteria first. If later steps still cause premature completion, hide them behind a real context boundary, such as a handoff or subagent dispatch. An inline call does not remove them from context.
- Demand sets the required depth. "Every modified model accounted for" requires more investigation than "produce a change list." Exhaustive criteria also apply to reference documents, such as requiring every review rule to be checked.

## When to split

Split only when the benefit earns the context or cognitive load:

- By sequence when visible later steps cause the agent to rush the current one. Merging sequences can reintroduce this problem.
- By invocation when a skill needs independent discovery. See [SKILL-MECHANICS.md](SKILL-MECHANICS.md).

## Leading words

Use a compact, familiar concept to recall a defined behavior. Repeat the term rather than its full definition. Use the same term in prompts, pointers, and document bodies to improve discovery and execution. Invented terms need explicit definitions.

Prefer a concrete criterion such as "red" for a test that fails on the bug over vague encouragement such as "be thorough."

State the target behavior positively. Keep prohibitions for hard guardrails and pair them with what to do instead.

## Pruning

- Keep each meaning in one authoritative place. Repeating a defined term is useful; repeating its explanation is not.
- Treat configuration, directory layout, and `--help` as sources. Repeat their contents only when lookup is expensive. Document unwritten conventions, rationale, and non-obvious pitfalls.
- Remove stale or irrelevant material; disclose branch-specific reference.
- Delete instructions that do not change the model's default behavior. Resolve disagreements about defaults by running the document.
