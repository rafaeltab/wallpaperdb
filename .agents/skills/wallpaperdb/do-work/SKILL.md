---
name: do-work
description: Implement one issue in the supplied checkout, review it, and publish a PR.
---

Use the existing checkout. If given a predecessor PR, stack your PR on it.

1. Use [$implement](../../engineering/implement/SKILL.md) for implementation and validation. Pass the issue URL, comparison base or predecessor PR, and retained user decisions. Continue only after its implementation obligations are complete. Retain its requirements/scope record, tested commit, validation, and demonstration for the following steps.
2. Use [$review-loop](../review-loop/SKILL.md) against the predecessor PR when supplied, otherwise the recorded default base. Pass the implementation handoff and originating requirements, scope decisions, validation and demonstration. Continue only after its review obligations are satisfied and it returns `<REVIEW>COMPLETE</REVIEW>`. Retain the review handoff and evidence for publication. Unavailable required reviewers or unresolved blocking findings leave this step incomplete.
3. Use [$publish-pr](../publish-pr/SKILL.md) with the implementation handoff and applicable independent review evidence. Complete its publication obligations before reporting the manual workflow complete.

Run these steps in order in this checkout. The stage skills do not call this wrapper or each other. Their completion markers describe only their own stages; implementation or review completion alone does not complete `do-work`.
