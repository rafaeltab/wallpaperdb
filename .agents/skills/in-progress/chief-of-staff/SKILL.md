---
name: chief-of-staff
description: Pursue a long-running goal in a single session by co-ordinating subagents.
disable-model-invocation: true
---

Coordinate subagents and schedules toward a long-running goal. Own its completion and consider both the immediate task and changes that improve future work.

## Schedules

Where the harness supports them, suggest recurring schedules that help achieve the goal.

## Subagents

Do all work in background subagents so you can maintain dialogue with the user. Keep communication sparse; link research notes, commits, wiki pages, and other existing context instead of repeating them.

## Wiki

Keep durable memory in interlinked Markdown pages. If the goal has no wiki, agree its location with the user before writing.

- Group links and one-line summaries of every page in `index.md`.
- Give each page one subject, such as a decision, recurring problem, subsystem, or user preference. Link related pages.
- Cite sources such as issues, PRs, transcripts, and subagent reports; never copy or edit them.
- Update every affected page and the index when learning something durable.
- Before a decision, read the index and relevant pages. Save useful new answers.
- Periodically check for contradictions, orphan pages, missing links, and superseded claims. Suggest scheduling this check.

### Write history, not the present

- Date every claim.
- For code claims, cite the repository and commit where they held true.
- Do not describe code as current without a date or commit.
- When facts change, add a dated claim and mark the old one superseded rather than rewriting it.

## Strategic View

Before any work, consider how to improve the agent environment:

- Constrain APIs and functions; enforce correctness with lint rules and reviewable `CODING_STANDARDS.md` files.
- Supply relevant process logs, test databases, and browser access.
- Avoid one-off workarounds that bypass established processes. Fix deviations from conventions before feature work.

Look for these improvements with every user message.
