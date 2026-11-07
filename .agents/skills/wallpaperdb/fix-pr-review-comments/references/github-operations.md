# GitHub operations

Use the connected GitHub tools when they expose the required operation, or `gh api`. Inspect returned errors as well as exit status; a GraphQL response can contain errors even when the HTTP request succeeds. Inspect the current schema when an operation or field is unsupported instead of guessing IDs or falling back to a different comment.

## Discover all selected feedback

`gh pr view <pr> --json number,url,body,closingIssuesReferences,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,isCrossRepository` identifies the target, its actual head repository, and issue-selection candidates. Select the owning issue through the [shared policy](../../../../../docs/agents/issue-tracker.md#selecting-issues-for-pr-fixes) before lifecycle writes. A fork PR's branch must be fetched and pushed through its head repository.

Run `make run PACKAGE=scripts SCRIPT=agent ARGS='feedback <pr>'` and retain its JSON outside the repository. The collector paginates threads, each thread's comments, review summaries, and conversation comments. Preserve comment kinds and IDs when selecting work. On resume, compare existing replies and reactions with current code; their presence alone does not establish that feedback was handled.

## Reply in the right place

For a review thread, use GraphQL `addPullRequestReviewThreadReply` with `pullRequestReviewThreadId` and `body`. For review summaries and PR conversation comments, use `gh pr comment <pr> --body-file <file>` and include the original comment URL. A review summary is a review node, not an issue comment or a review thread.

Follow $github-markdown-bodies. With `gh api`, pass a Markdown file as `-F body=@<file>` when the endpoint supports form fields, or build a JSON payload with an encoder and use `--input <file>`. Read the posted body back and verify its contents before continuing.

## React to the original comment

GraphQL `addReaction` accepts the original comment's node ID as `subjectId` and `THUMBS_UP` or `THUMBS_DOWN` as `content`. It supports `PullRequestReviewComment`, `IssueComment`, and `PullRequestReview`, so it also covers review summaries. Check `viewerCanReact` and the viewer's existing reactions. Add only the required reaction, preserving other users' reactions. If this invocation changes a prior verdict, remove only the acting account's obsolete thumbs reaction; mixed comments must have no verdict reaction from that account.

For inline review comments and PR conversation comments, the [REST reaction API](https://docs.github.com/en/rest/reactions/reactions) is an alternative. It uses `+1` and `-1` at the respective `/pulls/comments/{comment_id}/reactions` and `/issues/comments/{comment_id}/reactions` endpoints. These use numeric comment IDs, not the PR number or thread ID. Use GraphQL for review-summary reactions.

## Resolve and verify

Use GraphQL `resolveReviewThread` with the thread node ID as `threadId`, after the skill's handling criteria are met. Check `viewerCanResolve` first and confirm `thread { id isResolved }` in the result. Refresh the thread to verify remote state. Posting a reply, reacting, or pushing a commit does not resolve a thread.

PR conversation comments and review summaries have no equivalent resolved flag. Report their replies and reactions, and reserve "resolved" for review threads confirmed as resolved by GitHub.

After a failed or ambiguous mutation, re-read the corresponding reply, viewer reaction, or thread state before retrying. If the operation remains blocked, leave it pending and report the exact missing permission or failed operation.
