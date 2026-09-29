# Triage Labels

The skills use five canonical triage roles. Each role maps to the same-named GitHub label in this repository.

| Canonical role | GitHub label | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified and ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill names a role, use the corresponding GitHub label from this table.

## Deferred work

`future-work` is a tag, not a sixth triage state. Use it for open issues the maintainer has explicitly postponed. Keep the issue's category and triage state labels so its status is available when work resumes.

Exclude `future-work` issues from routine triage discovery and priority overviews by default, including the unlabeled, `needs-triage`, and `needs-info` queues. Use `-label:future-work` in GitHub issue searches or filter it out after fetching issues. An explicitly named issue remains in scope for triage. Remove the tag when the maintainer brings the work back into the active queue.
