---
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the skills in this repo.
disable-model-invocation: true
---

# Ask Matt

Read a skill's `SKILL.md` before describing it or recommending that a step be skipped. This router is only an index.

## The main flow: idea → ship

1. Use `/grill-with-docs` to sharpen an idea in a working directory. It combines `/grilling` with glossary and ADR updates. Without a working directory, use `/grill-me`.
2. If a question needs a runnable answer, use `/handoff` to move to a separate prototype directory, run `/prototype`, then `/handoff` the findings back to the idea thread.
3. For a multi-session build, run `/to-spec`, then `/to-tickets` to create self-contained tickets with blocking edges. Work blockers first using `/implement` with `/clear` between tickets, or run `/implement-spec` for the whole spec. For a single-session build, use `/implement` in the current context. Implementation uses `/tdd` and closes with the Standards and Spec axes of `/code-review`. `/pr` shapes the PR body and evidence.
4. Run `/retro` after the build to identify improvements to navigation, checks, standards, steering files, and tooling.

### Context hygiene

Keep grilling, spec synthesis, and ticket breakdown in one context window until `/to-tickets` finishes. Each ticket's `/implement` starts fresh. Run `/retro` before clearing, or supply the session log afterward.

If context approaches the [smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone), compact at the nearest phase boundary. See [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md).

## On-ramps

- Incoming bugs and requests: `/triage` produces agent-ready issues for `/implement`. Do not triage tickets created by `/to-tickets`; they are already agent-ready.
- Hard bugs, flakes, or regressions: `/diagnosing-bugs` builds a command that detects the reported failure before testing hypotheses. Follow the fix with `/retro`; a missing test seam may warrant `/improve-codebase-architecture`.
- Efforts too large to understand in one session: `/wayfinder` resolves decision tickets on a shared map. It plans by default. When the route is clear, use `/to-spec`, `/to-tickets`, and `/implement`. Go directly to `/implement` only if the effort proved small.

## Codebase health

`/improve-codebase-architecture` surveys deepening opportunities. Take a chosen candidate into `/grill-with-docs`; use `/codebase-design` to design its interface.

## Vocabulary underneath

- `/domain-modeling` sharpens domain terms, updates glossaries, and records qualifying decisions as ADRs.
- `/codebase-design` defines module, interface, depth, seam, adapter, leverage, and locality for architecture and testability work.

## Phase boundaries

At a phase boundary, choose among continuing, `/clear`, `/handoff`, a subagent, or `/compact` using the ordered tree in [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md). Mid-phase, continue or delegate the remaining work.

## Standalone

- `/grill-me`: a stateless interview when there is no working directory. In a repository, use `/grill-with-docs` to retain glossary and ADR decisions.
- `/grilling`: the interview primitive used by those wrappers and several engineering workflows.
- `/prototype`: throwaway logic or UI code that answers a design question. Preserve it on a `prototype/<name>` branch outside main, linked from the implementation issue.
- `/research`: background reading against primary sources, producing cited Markdown findings for later design work.
- `/to-questionnaire`: interview the sender about what they need from someone else, then write that person a questionnaire.
- `/wizard`: generate an interactive bash script for steps only a human can perform, such as dashboard setup, credentials, or a cutover. The agent performs steps it can do itself.
- `/wait-what`: rephrase the last message in plain English with the missing context and glossary vocabulary.
- `/teach`: learn a concept across sessions using the current directory as state.
- `/writing-for-agents`: guidance for skills, agent instructions, and referenced documents.

## Precondition

Run `/setup-matt-pocock-skills` before the first engineering flow to configure the tracker, triage labels, and domain documentation layout. Custom trackers are supported.
