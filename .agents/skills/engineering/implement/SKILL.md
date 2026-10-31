---
name: implement
description: Implement and validate one issue in the supplied checkout, stopping before independent review and PR publication. Use for the implementation stage or from do-work.
---

Use the existing checkout and branch. Accept the issue URL, comparison base or predecessor PR, and retained requirements and scope decisions from the caller. Read the issue and comments and any parent spec for context; implement only the selected issue. Follow [task scope](../../../../docs/agents/task-scope.md) throughout, including significant scope changes and new test seams requiring explicit approval.

1. Follow the [issue workflow](../../../../docs/agents/issue-tracker.md) to verify the issue is open, claim it, verify dependency readiness and project membership, and verify `In Progress` before edits.
2. Inspect the relevant code and clarify missing requirements. Make an implementation checklist. Record the starting comparison, originating requirements, user decisions, exclusions, and pending proposals in session state or an outside-repository ledger. Retain these for review and publication; the issue URL and thread context remain the requirements source.
3. Use $tdd and $development-principles. Work in small increments; check, format, and commit each before starting the next. Respect an issue's explicit acceptance-verification policy, including prose-only extraction without mirrored tests.
4. Run [`make ci`](../../../../CONTRIBUTING.md#check-a-change) and fix failures. Use $testing for focused checks and E2E guidance. Preserve meaningful testing, coverage, and applicable configured CRAP checks. Mutation-pilot checks are advisory and excluded from completion requirements. Report available outcomes and proceed without waiting or retrying merely to turn the pilot green. Build baselines in CI; local mutation diagnostics require a concrete question and at most five minutes overall including shutdown. Follow [mutation guidance](../../../../CONTRIBUTING.md#incremental-mutation-testing-pilot). Ordinary CI remains mandatory.
5. Prepare a concise demonstration appropriate to the change for publication. Use a recording for observable UI behavior or direct output for nonvisual changes. Report any material limits.

After the agreed implementation is committed and required validation passes, return the issue URL, full head SHA and tree, comparison base, requirements/scope record, validation results, demonstration, and any limitations for the next stage. Emit `<TASK>COMPLETE</TASK>` only then. Unresolved required work, validation failures, or pending scope decisions leave the stage incomplete; report the blocker without the marker. This stage stops before independent review and publication.

A factory caller can use a small prompt with its retained context:

```text
Use $implement for <issue URL> in this bound checkout against <base ref/SHA>.
Retained scope and decisions: <context or ledger path>.
Return the implementation handoff; stop after this stage.
```
