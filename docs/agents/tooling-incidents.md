# Automation incident reporting

Report suspected harm from repository checks, Biome rules, generators and agent tooling. This includes false positives, crashes, unexpected execution cost, lost coverage, and any proposed exception, bypass or weakening. Ordinary diagnostics correctly identifying a code violation are not tooling incidents. When the distinction is uncertain, report the suspicion and its evidence without claiming a proven cause.

1. Tell the user in the active chat immediately: name the tool, the observed problem, its impact, and the proposed next step. Do this before applying a workaround. A delegated agent reports the incident to its coordinator, which owns the user notification.
2. Publish a durable report with `make run PACKAGE=scripts SCRIPT=agent ARGS='report-tooling-incident /absolute/path/incident.json'`. The [reporter](../../scripts/report-tooling-incident.ts) defines the input and verifies delivery. Use a stable incident ID for the same concern, sanitized evidence, and an explicit workaround value of `none` when applicable. Include the failing command, head SHA or run link, expected and observed behavior, impact, and current outcome. Keep credentials and unsanitized logs out of reports.
3. Include the returned issue URL and notice in chat. A terminal message or a buried PR comment alone does not notify the user. If publication or assignment verification fails, tell the user explicitly and keep reporting incomplete. Preserve the evidence outside the repository for recovery.
4. Repair within the agreed scope after disclosure. Obtain explicit user approval before disabling, excluding, downgrading, loosening, or bypassing enforcement, including temporary changes. Record the approved exception, its scope, and removal condition in the incident. Passing after a bypass is not evidence that the original requirement passes.
5. Update the same report when diagnosis, workaround or outcome changes. Reuse its stable ID so the reporter preserves earlier observations. A closed report requires an explained reopening under the issue-tracker workflow before recording a recurrence. Report the incident and final outcome in the task handoff even if a repair makes every check pass. Keep the issue open through verified default-branch landing and maintainer disposition; a successful workaround or retry does not close it.

Reports are labeled `automation-impact` and assigned to `rafaeltab`. This label is the durable impact list for deciding whether to repair or revert the automation. Preserve unrelated labels and assignees. If more than one agent races to create the same report, reconcile duplicates explicitly; GitHub issue creation has no atomic uniqueness guarantee.

Before publication, record `automationIncidents` in the review evidence ledger. Use an explicit empty array if none occurred; otherwise record each report's `url`, `userNotified: true` after the chat notice, and its `outcome`. The [review evidence command](../../scripts/agent-workflow.ts) rejects missing disclosure, incomplete entries, and reports that are not open, labeled and assigned to the user. This declaration covers incidents encountered during the task, including repaired ones; carry earlier records forward when resuming. Existing review ledgers need this current disclosure assessment rather than silently inheriting an empty value.

Example input, with real evidence substituted before publication:

```json
{
  "id": "route-cache-baseline",
  "tool": "scripts/check-generated.ts",
  "command": "make run PACKAGE=scripts SCRIPT=check:generated ARGS=routes",
  "expected": "A valid cached build passes artifact verification",
  "observed": "An absent ignored route tree is reported stale",
  "impact": "Valid pull requests are blocked",
  "workaround": "none",
  "evidence": "Failing run URL and affected full commit SHA",
  "outcome": "blocked pending diagnosis"
}
```

Recognizing a tooling regression and delivering a chat message require agent judgment. The reporter verifies the durable GitHub issue, assignment and content; it cannot prove that an agent disclosed every incident. Preserve the mandatory chat disclosure even when another system has already recorded a CI failure.
