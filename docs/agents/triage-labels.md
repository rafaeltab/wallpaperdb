# Triage Labels

Follow the [triage workflow](../../.agents/skills/engineering/triage/SKILL.md), including its agent brief. Use exactly one of these state labels:

| Label | Meaning |
| --- | --- |
| `needs-triage` | Needs evaluation |
| `needs-info` | Waiting on the reporter |
| `ready-for-agent` | Ready for autonomous implementation, including investigation |
| `ready-for-human` | Needs maintainer attention or a human decision |
| `wontfix` | Will not be actioned |

Choose `ready-for-agent` when evidence, scope, and acceptance criteria permit work without a human decision. An unknown root cause or implementation detail alone does not require human attention.

The GitHub Project's [lifecycle status](issue-tracker.md#project-lifecycle) records progress. Agent-ready work is `Planned` or later, rather than `Todo`. A `Planned` ticket can still have blocking dependencies; apply the issue tracker's dependency rules before starting it.

## Deferred work

Add `future-work` only when the maintainer explicitly postpones an open issue. Keep its category and triage state; postponement neither closes it nor sets `Cancelled`.

Exclude it from routine discovery and priority overviews with `-label:future-work`, including unlabeled, `needs-triage`, and `needs-info` queues. Explicitly named issues remain in scope. Remove the tag when the maintainer resumes the work.
