# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use `mise exec -- gh` from the checkout. External pull requests are not a triage surface.

## Conventions

Read tickets with `gh issue view <number> --comments`, including their body and labels. Use [gh issue](https://cli.github.com/manual/gh_issue) for mutations and [multiline body handling](../../.agents/skills/wallpaperdb/github-markdown-bodies/SKILL.md) when publishing.

Reopen a closed issue only when resuming it is authorized. Explain the recurrence in a comment, run `gh issue reopen`, and verify `OPEN` with `gh issue view <number> --json state,url` before using it as active tracking. Report failed writes or verification. Historical discussion alone leaves the issue closed.

## Claiming an issue

Before planning or implementation, assign the issue to the authenticated account with `gh issue edit <number> --add-assignee @me`, preserving other assignees. Verify with `gh issue view <number> --json assignees`. Stop work on that issue if assignment or verification fails.

## Project lifecycle

Use [WallpaperDB, project 7](https://github.com/users/rafaeltab/projects/7), explicitly selecting owner `rafaeltab` even when authenticated as another account.

| Status | Meaning |
| --- | --- |
| `Backlog` | Needs refinement |
| `Todo` | Needs planning |
| `Planning` | Planning underway |
| `Planned` | Agreed plan; implementation awaits dependency readiness |
| `In Progress` | Implementation or substantive review fixes underway |
| `In Review` | Published and ready for review |
| `Done` | Landed on the default branch |
| `Canary` | Deployed to some users |
| `Released` | Deployed to all users |
| `Cancelled` | Explicitly abandoned |

Verify the issue is open before moving it to an active status. Reopen authorized work through [Conventions](#conventions) first.

- Set `Planning` when grilling an assigned issue for human decisions. Record the agreed plan before `Planned`. Triage can establish a plan when evidence, bounded scope and testable acceptance criteria leave no human decisions. Otherwise keep `Todo`. `to-spec` and `to-tickets` publish as `Planned`.
- Set and verify `In Progress` before implementation, including authorized work from `Backlog` or `Todo`. Check [dependencies](#relationships) first. A `do-work` checklist does not return an implementation ticket to planning.
- Set and verify `In Review` after tested work is pushed and its PR is ready. Drafts remain `In Progress`; stacks also require complete-spec review and final head/base checks. Substantive review fixes return to `In Progress`, then `In Review` when ready. Monitoring and investigation alone leave status unchanged.

Update only the selected issue. Creating children does not authorize parent status changes. Track stack tickets individually; leave unstarted siblings unchanged. Planning without an issue has no project item to update.

### Selecting issues for PR fixes

Use the user's selected issue. For a PR-only request, read its authenticated `closingIssuesReferences` and body with `gh pr view`. Read candidate issues and match their repository, full URL and acceptance criteria to the diff and fixes. Body references can identify stack tickets whose PR targets another branch.

Select the owning issue before substantive edits or status writes. Ask if associations conflict or several candidates remain plausible; continue independent investigation. A PR without a repository issue has no issue status to update.

Record the full issue URL in the review/babysitting ledger and use it for both status transitions. On resume, revalidate current PR links and issue state. Resolve changed or ambiguous associations before dependent work.

### CLI and verification

Set `ISSUE_URL` to the verified selected issue URL:

```sh
mise exec -- gh project item-edit 7 --owner rafaeltab --url "$ISSUE_URL" --field Status --value 'In Progress'
mise exec -- gh issue view "$ISSUE_URL" --json state,projectItems
```

Use exact status names and verify the read-back at each transition. Report failures rather than claiming success.

Check `projectItems` before the first transition and after issue creation or sub-issue linking. Allow auto-add to run, then reread. If still absent, use `gh project item-add 7 --owner rafaeltab --url "$ISSUE_URL"` and verify membership. Reuse existing items.

If another CLI version rejects named fields, inspect `gh --version` and `gh project item-edit --help`. Discover IDs through `field-list`, `item-list` or the [Projects API](https://docs.github.com/en/graphql/reference/projects) for its documented ID-based form; do not guess IDs or retry unsupported flag combinations.

### Automation and terminal states

Let applicable GitHub Projects automation run and verify it before duplicating a status write. Correct missing intermediate transitions only after rereading the issue; preserve later release states. Inspect live Workflows settings when investigating automation. API workflow names and enabled flags do not reveal filters or target statuses.

Completion requires verified default-branch landing, linked issue closure and `Done` status. Verify both closure and status after landing; report discrepancies with landing evidence. The enabled `Auto-close issue` workflow can close an issue on a terminal status write, so do not set `Done` early. A PR, passing CI, approval or a feature-branch merge does not establish completion.

[Closing keywords link issues only for default-branch PRs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue). Recheck links when retargeting stack layers and closure after landing.

Reopened work resumes at the appropriate active status after verifying `OPEN`. Cancellation requires an explicit decision, close reason `not planned`, and verified `Cancelled` status. `Canary` and `Released` require deployment evidence.

## Pull requests as a triage surface

Triage GitHub issues only, not external pull requests.

## Publishing

A skill's instruction to publish to the tracker means create a GitHub issue. Fetching a ticket means reading its full body, comments and labels.

## Relationships

Use native sub-issues for parent-child relationships and native issue dependencies for blockers. If unavailable, record `Parent: #<number>` and `Blocked by: #<number>` in the body.

Every blocker must be closed before implementation, with one stack exception: its changes are in an ancestor layer of the same stack, acceptance criteria and required validation/review have passed, and its PR URL and validated commit are recorded in the blocker. An open PR alone is insufficient; this exception does not authorize implementation outside that stack.

Keep tickets open until verified default-branch landing. Close the parent spec only after all tickets land and the complete spec is validated.
