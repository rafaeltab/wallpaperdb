# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`.
- **Read an issue**: `gh issue view <number> --comments`, including labels and the full body.
- **List issues**: `gh issue list` with appropriate state and label filters and JSON output when structured data is needed.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically inside the clone.

## Pull requests as a triage surface

External pull requests are not a request or triage surface. Triage GitHub issues only.

## Publishing

When a skill says to publish to the issue tracker, create a GitHub issue.

When a skill says to fetch a ticket, retrieve its full body, comments, and labels with `gh`.

## Relationships

- Use GitHub sub-issues for parent-child relationships when available.
- Use GitHub native issue dependencies for blocking edges when available.
- If either native feature is unavailable, record `Parent: #<number>` and `Blocked by: #<number>` references in the issue body.
- A ticket is ready to work when every blocking issue is closed.
