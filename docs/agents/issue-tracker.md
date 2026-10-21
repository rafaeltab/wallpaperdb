# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, including labels and the full body.
- **List issues**: `gh issue list` with appropriate state and label filters and JSON output when structured data is needed.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.
- **Reopen an issue**: [gh issue reopen](https://cli.github.com/manual/gh_issue_reopen) accepts an issue number or URL. Explain why the recurrence warrants reopening in an issue comment. After reopening, use [gh issue view](https://cli.github.com/manual/gh_issue_view) with `--json state,url` and verify `state` is `OPEN` before relying on the issue as active tracking. Report a failed mutation or verification instead of treating the issue as open.

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Claiming an issue

When picking up a GitHub issue, assign it to the authenticated GitHub account used by the agent before planning or implementation. Use [gh issue edit](https://cli.github.com/manual/gh_issue_edit) with `<number-or-url> --add-assignee @me` and preserve existing assignees. Read back the issue with [gh issue view](https://cli.github.com/manual/gh_issue_view) using `<number-or-url> --json assignees` and verify the account is assigned.

If assignment or verification fails, stop work on that issue and report the failure. Resume planning and implementation only after assignment is verified.

## Project lifecycle

Track repository issues in [WallpaperDB, project 7](https://github.com/users/rafaeltab/projects/7), owned by `rafaeltab`. Always select that owner explicitly; the authenticated agent account can be different.

| Status | Meaning |
| --- | --- |
| `Backlog` | Needs refinement |
| `Todo` | Ready for planning with an agent |
| `Planning` | Planning is underway |
| `Planned` | Has an agreed plan and can be picked up once dependencies permit |
| `In Progress` | Implementation or substantive review fixes are underway |
| `In Review` | Implementation is published and ready for review |
| `Done` | Completed work has reached the default branch |
| `Canary` | Available to some users |
| `Released` | Available to all users |
| `Cancelled` | Will not be picked up |

Planning belongs to grilling before implementation. For an existing issue, verify assignment and set `Planning` when grilling starts. Set `Planned` after the agreed plan is recorded in the issue. Planning without an existing issue has no project item to update. `to-spec` and `to-tickets` publish prepared specs and tickets as `Planned`.

Active work requires an open issue. Read `state` before moving an existing issue to `Planning`, `Planned`, `In Progress`, or `In Review`. For a closed issue, use the user's existing authorization to resume work, or clarify that intent when absent, then follow the [reopening convention](#conventions), explain the recurrence in an issue comment, and verify `OPEN` before changing status. Discussing historical work leaves its closed state and project status unchanged.

Implementation starts with `In Progress`, including explicitly requested work on an issue currently in `Backlog` or `Todo`. Check [dependency readiness](#relationships) first. A checklist inside `do-work` does not move an implementation ticket back into `Planning`. After the completed implementation is pushed and its PR is ready for review, verify `In Review` before handing it back. Draft PRs keep their tickets `In Progress`; stack tickets enter `In Review` after the complete-spec review and final head/base checks pass and their PRs are marked ready. During substantive review fixes use `In Progress`, then restore `In Review` after the tested fixes are pushed and the PR is ready for review. Merely monitoring CI or investigating feedback does not change status.

Update only the selected issue's item. Creating child tickets does not authorize changing their parent's status. Track each stack ticket when its own implementation starts and reaches review; leave unstarted siblings at their existing status. Close the parent only after all tickets have landed and the complete spec is validated.

### CLI and verification

Use the named-field syntax in [gh project item-edit](https://cli.github.com/manual/gh_project_item-edit). It is supported by the installed CLI. Set `ISSUE_URL` to the selected issue's verified URL before these commands:

```sh
gh project item-edit 7 --owner rafaeltab --url "$ISSUE_URL" --field Status --value 'In Progress'
gh issue view "$ISSUE_URL" --json state,projectItems
```

Use the exact status names above, including capitalization and spaces; replace the value with `Planning`, `Planned`, or `In Review` at the relevant transition. Read the result back and verify the WallpaperDB item's status. Before code edits, verify `In Progress`; before reporting review handoff, verify `In Review`. A successful command alone does not establish the transition. Report a failed write or read-back instead of claiming it succeeded.

Verify membership with [gh issue view](https://cli.github.com/manual/gh_issue_view)'s `projectItems` before the first status change and after issue creation or sub-issue linking. Allow the auto-add workflow to run and read back again. If the item is still absent, use [gh project item-add](https://cli.github.com/manual/gh_project_item-add) with `7 --owner rafaeltab --url "$ISSUE_URL"`, then verify membership before editing its fields. Reuse existing items.

If a different installation rejects named-field flags, inspect `gh --version` and `gh project item-edit --help` before retrying. Use the documented ID-based form with project, item, field, and option IDs discovered from live data through [field-list](https://cli.github.com/manual/gh_project_field-list), [item-list](https://cli.github.com/manual/gh_project_item-list), or the [Projects API](https://docs.github.com/en/graphql/reference/projects). Do not guess IDs or repeatedly try unsupported flag combinations.

### Automation and terminal states

The project's enabled built-in workflows are `Auto-add to project`, `Auto-add sub-issues to project`, `Item added to project`, `Pull request linked to issue`, `Code changes requested`, `Pull request merged`, `Item closed`, and `Auto-close issue`. These are GitHub Projects workflows, separate from GitHub Actions. Let applicable automation run and verify its result before writing the same intermediate status manually. Correct a missing intermediate transition only after rereading the issue and confirming the work still warrants it; preserve later release states.

Workflow names and enabled flags are exposed by the [Projects GraphQL API](https://docs.github.com/en/graphql/reference/projects#projectv2workflow); their filters, item types, and target statuses require the authenticated project's Workflows settings. Discover the live configuration when investigating automation; names alone do not prove the configured action.

The intended completion path is verified default-branch landing, linked issue closure, then `Item closed` setting `Done`. Verify both issue closure and project status after landing. Report missing closure or an incorrect terminal status, with the landing evidence; do not compensate by setting `Done` before landing. The enabled `Auto-close issue` workflow means a terminal status write can itself close an issue. Opening a PR, passing CI, obtaining approval, or merging into another feature branch does not establish completion.

For stacked PRs, [closing keywords only create closing links when the PR targets the default branch](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue). Verify those links as layers are retargeted and verify closure after actual landing; the original PR description alone is insufficient.

On reopening, verify `OPEN` under the reopening convention above, then restore the status appropriate to the resumed work. Cancellation requires an explicit decision and an issue close reason of `not planned`; verify `Cancelled` rather than treating closure as completion. Use `Canary` or `Released` only with evidence of the corresponding deployment. Implementation and PR-monitoring skills do not infer release from merge or approval.

## Pull requests as a triage surface

External pull requests are not a request or triage surface. Triage GitHub issues only.

## Publishing

When a skill says to publish to the issue tracker, create a GitHub issue.

When a skill says to fetch a ticket, retrieve its full body, comments, and labels with `gh`.

## Relationships

- Use GitHub sub-issues for parent-child relationships when available.
- Use GitHub native issue dependencies for blocking edges when available.
- If either native feature is unavailable, record `Parent: #<number>` and `Blocked by: #<number>` references in the issue body.
- A ticket is ready to work when every blocking issue is closed. During PR stack implementation, an open blocker also satisfies readiness when all of the following hold:
  - Its changes are present in an ancestor layer of the same stack.
  - Its acceptance criteria and required validation and review have passed.
  - Its PR URL and validated commit are recorded in the blocking issue.
- Every blocker must satisfy the readiness rule. An open PR alone is insufficient, and the stack exception does not make a ticket ready for implementation outside that stack.
- Keep implementation tickets open until their changes reach the default branch. Verify landing before closing a ticket; close the parent spec only after every ticket has landed and the complete spec is validated.
