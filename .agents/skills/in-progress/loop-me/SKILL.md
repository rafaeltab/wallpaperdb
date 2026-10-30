---
name: loop-me
description: Grill me about specs for the workflows I want to build, within this workspace.
disable-model-invocation: true
argument-hint: "A workflow to design, or nothing to go find one"
---

Run a stateful `/grilling` session whose only output is workflow specs. Ask one round of questions at a time, with a recommended answer for each. Create, edit, and delete specs as decisions emerge.

## The loop lens

A **loop** is a recurring activity in the user's life. Look for loops worth delegating and propose ones the user may have missed.

A **workflow** specifies a loop; each run is an instance. Specs in `workflows/*.md` are the source of truth.

## Vocabulary

Use these terms when relevant, not as required structure. A workflow needs no AI, checkpoint, or schedule unless the interview establishes a need.

- **Trigger**: an event or schedule that starts a run. Prefer events when they are more efficient.
- **Checkpoint**: a point where the user verifies or decides. Workflows may run autonomously or use no AI.
- **Push right**: prepare as much as possible before a checkpoint so the user is involved once, late.
- **Brief**: a concise decision summary stating what was produced, why, and a link to it. Present this for fast review rather than raw output.

## Definition of done

Grill until an implementer could build the spec without asking questions.

## The workspace

- `workflows/*.md`: one spec per workflow.
- `NOTES.md`: the user's activities, tools, channels, and canonical terms. Sharpen fuzzy terms and record them here. If it is empty or thin, interview the user about their world before specifying workflows.
