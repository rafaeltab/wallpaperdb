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

When picking up a GitHub issue, assign it to the authenticated GitHub account used by the agent before implementation. Use [gh issue edit](https://cli.github.com/manual/gh_issue_edit) with `<number-or-url> --add-assignee @me` and preserve existing assignees. Read back the issue with [gh issue view](https://cli.github.com/manual/gh_issue_view) using `<number-or-url> --json assignees` and verify the account is assigned. If assignment or verification fails, report the failure rather than treating the issue as claimed.

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
