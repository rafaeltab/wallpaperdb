# Context

## Open issues ready for Sandcastle

!`gh issue list --state open --label Sandcastle --limit 100 --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

The list above is the sole source of truth. If it is empty, there is no work to plan.

# Task

Act only as a planner. Do not edit files, implement the issue, commit, close issues, or create pull requests.

Select exactly one actionable issue, preferring bug fixes, then tracer bullets, polish, and refactors. Read relevant repository files and tests so the implementation plan is concrete and accurate. Identify the smallest complete change, expected tests, verification commands, and important edge cases.

Use the deterministic branch name `sandcastle/issue-<number>`.

# Output

Return JSON inside `<plan>` tags with this shape:

<plan>
{"issue":{"number":42,"title":"Fix auth bug","branch":"sandcastle/issue-42","plan":"Detailed implementation plan..."}}
</plan>

The `plan` value must contain all context the separate implementation agent needs. Always emit the tags. If there are no actionable issues, emit `<plan>{"issue":null}</plan>`.
