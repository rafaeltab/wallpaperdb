---
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the skills in this repo.
disable-model-invocation: true
---

# Choose a workflow

Read a skill before recommending it. These are choices for the user, not instructions to invoke user-only skills automatically.

## Planning and implementation

- $grill-with-docs interviews the user and records resolved domain terms and decisions. Use $grill-me for a discussion without repository records.
- $wayfinder resolves an effort too uncertain for one implementation session into decision tickets.
- $prototype answers a design question with runnable code. Use $handoff when moving between directories or sessions.
- $to-spec turns agreed decisions into a spec; $to-tickets splits it into dependency-linked work.
- $implement handles one ticket; $implement-spec coordinates a spec's tickets. Both use $tdd and $code-review.
- $triage processes incoming issues according to the repository's tracker policy.
- $diagnosing-bugs establishes a reproducible failure and fixes it with a regression check.
- $pr writes a PR body. $retro reviews a completed session for changes to the agent environment.

## Design and reference

- $improve-codebase-architecture identifies module deepening opportunities. $codebase-design supplies the design vocabulary.
- $domain-modeling resolves domain terminology and records decisions.
- $research gathers primary-source evidence for a concrete question.
- $writing-for-agents guides skill and agent-instruction edits.

## Other tasks

- $to-questionnaire prepares questions for someone outside the conversation.
- $wizard prepares a procedure for steps only a human can perform.
- $wait-what restates the last explanation in plain language.
- $teach guides a learning workspace over multiple sessions.
- $setup-matt-pocock-skills configures tracker and documentation conventions before using these workflows in a new repository.

## Session boundaries

Continue when the current context is still useful. Read [phase boundaries](PHASE-BOUNDARIES.md) when choosing between continuing, clearing, compaction, delegation, or a portable handoff. `/clear` and `/compact` are session commands.
