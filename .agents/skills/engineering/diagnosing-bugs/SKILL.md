---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.
---

# Diagnosing bugs

Skip phases only with explicit justification. Read relevant glossary definitions and ADRs before exploring.

## Redact

Redact every secret as `<REDACTED>` before showing commands, output, or artifacts. Use environment variables for credentials. Captures may contain auth headers; quote only relevant lines. If redacted output is insufficient, explain and ask the user.

## Phase 1: Build a feedback loop

Apply [defect verification](../../wallpaperdb/testing/SKILL.md#verify-defect-fixes) when building the loop and evaluating fixes. Build a fast, specific, deterministic pass/fail command before forming hypotheses. Spend the effort needed to make it detect the reported bug.

### Ways to construct one, in roughly this order

1. A failing unit, integration, or end-to-end test at the seam that reaches the bug.
2. An HTTP script against a dev server.
3. A CLI fixture with output compared against a known-good snapshot.
4. A headless browser script asserting DOM, console, or network behavior.
5. A captured request, payload, or event log replayed in isolation.
6. A minimal temporary program exercising the affected service and dependencies.
7. A property or fuzz loop for intermittent incorrect output.
8. Automated setup and checks suitable for `git bisect run` between known states.
9. A comparison of old and new versions or configurations on the same input.
10. As a last resort, `scripts/hitl-loop.template.sh` for necessary human interaction and captured results.

### Tighten the loop

Cache setup, skip unrelated initialization, and narrow scope. Assert the exact symptom. Pin time, random seeds, filesystem state, and network inputs where relevant.

### Non-deterministic bugs

Raise and pin the reproduction rate through repeated triggers, stress, parallelism, or controlled timing. Keep improving a rare failure until it can support diagnosis.

### When you genuinely cannot build a loop

Stop, explain what you tried, and request access to a reproducing environment, a redacted capture, or permission for temporary production instrumentation. Do not hypothesize without a loop.

### Completion criterion: a tight loop that goes red

Show one command you have already run and its redacted output. It must:

- Exercise the actual bug path and assert the user's exact symptom, so it can fail before and pass after the fix.
- Return a deterministic verdict, or a pinned high reproduction rate for a flaky bug.
- Run in seconds rather than minutes.
- Run unattended, except necessary human steps through `scripts/hitl-loop.template.sh`.

Do not start Phase 2 without this command.

## Phase 2: Reproduce + minimise

Run the loop and observe the reported failure across repeated runs, or at a high rate for an intermittent bug. Capture the exact error, output, or timing for later verification.

### Minimise

Remove inputs, callers, configuration, data, and steps one at a time, rerunning after each cut. Finish when removing any remaining element makes the failure disappear. Reproduce and minimize before proceeding.

## Phase 3: Hypothesise

Generate 3–5 ranked hypotheses before testing. Each needs a falsifiable prediction, such as "If X causes this, changing Y will remove the failure."

Show the ranking to the user before testing so they can contribute context. Do not block if they are away; proceed with the ranking.

## Phase 4: Instrument

Map each probe to a Phase 3 prediction and change one variable at a time. Prefer debugger or REPL inspection, then targeted logs that distinguish hypotheses. Do not log everything.

Tag each debug log with a unique prefix such as `[DEBUG-a4f2]` for removal afterward.

For performance regressions, establish baseline timings with a profiler, query plan, or timing command, then bisect. Measure before fixing.

## Phase 5: Fix + regression test

Write a regression test before the fix only at a seam that exercises the real bug pattern as it occurs at the call site. A shallow seam that cannot reproduce the triggering chain gives false confidence. If no suitable seam exists, record that architectural limitation for the next phase.

At a suitable seam:

1. Turn the minimal reproduction into a failing test and observe its failure.
2. Apply the fix and observe the test pass.
3. Rerun the Phase 1 loop against the original scenario.

## Phase 6: Cleanup

Before declaring completion:

- Rerun the original reproduction and confirm it no longer fails.
- Confirm the regression test passes, or document the missing seam.
- Search for and remove all tagged debug instrumentation.
- Delete temporary prototypes or move them to a clearly marked debug location.
- State the confirmed cause in the commit or PR message.
