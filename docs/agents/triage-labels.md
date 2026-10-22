# Triage Labels

The skills use five canonical triage roles. Each role maps to the same-named GitHub label in this repository.

When triaging an issue, follow the [triage workflow](../../.agents/skills/engineering/triage/SKILL.md), including its agent-brief guidance.

| Canonical role | GitHub label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Ready for autonomous implementation, including necessary investigation |
| `ready-for-human` | `ready-for-human` | Needs maintainer attention or a human decision before an agent can proceed |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role, use the corresponding GitHub label from this table.

Complete triage with exactly one state label. Choose `ready-for-agent` when the evidence, scope, and acceptance criteria let an agent proceed without a human decision. An unknown root cause or implementation detail alone does not require human attention.

The GitHub Project's [lifecycle status](issue-tracker.md#project-lifecycle) records progress. Agent-ready work is `Planned` or later, rather than `Todo`. A `Planned` ticket can still have blocking dependencies; apply the issue tracker's dependency rules before starting it.

## Deferred work

`future-work` is a tag, not a sixth triage state. Use it for open issues the maintainer has explicitly postponed. Keep the issue's category and triage state labels so its status is available when work resumes.

Postponement does not cancel an issue. Adding `future-work` alone does not change its project status to `Cancelled` or close it.

Exclude `future-work` issues from routine triage discovery and priority overviews by default, including the unlabeled, `needs-triage`, and `needs-info` queues. Use `-label:future-work` in GitHub issue searches or filter it out after fetching issues. An explicitly named issue remains in scope for triage. Remove the tag when the maintainer brings the work back into the active queue.
