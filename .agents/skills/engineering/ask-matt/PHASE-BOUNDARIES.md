# Phase boundaries

Choose how to manage context between phases, such as design, implementation, and QA. Mid-phase, continue or delegate remaining work; compacting then risks losing the current reasoning.

## The five options

| Option | Effect |
| ------ | ------ |
| Continue | Keep the full session context. |
| `/clear` | Empty the context window. The old session remains resumable. |
| `/handoff` | Write a portable Markdown file for another session. |
| Subagent | Delegate a scoped task to a separate context and receive a report. |
| `/compact` | Replace the current context with a summary for the next phase. |

## The tree

At the boundary, use the first matching option:

1. **Continue** if the next phase needs this session's reasoning verbatim, or enough [smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone) remains for it.
2. **Clear** if all current exploration, decisions, and rejected approaches are irrelevant to the next work. Clearing relevant context loses rationale that the diff cannot reconstruct.
3. **Handoff** when changing harnesses or directories, passing work to a colleague, or forking a side task found mid-phase. Use it for portability.
4. **Delegate** if the task is scoped enough to run without human steering, such as an automated review.
5. Otherwise, **compact**, telling the summarizer what the next phase needs, for example `/compact we're going to QA this area`.

## Primary and secondary sources

Continuing preserves the session verbatim. Compacting and handoffs preserve a lossy summary while freeing context. Prefer the original reasoning when the next phase depends on it.

## These are judgement calls

Apply the questions in order at a phase boundary; their answers depend on the work and remaining context.
