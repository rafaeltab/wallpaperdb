# GitHub operations

Use the connected GitHub tools when they expose the required operation, or `gh api`. Inspect returned errors as well as exit status; a GraphQL response can contain errors even when the HTTP request succeeds. Inspect the current schema when an operation or field is unsupported instead of guessing IDs or falling back to a different comment.

## Discover all selected feedback

`gh pr view <pr> --json number,url,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,isCrossRepository` identifies the target and its actual head repository. A fork PR's branch must be fetched and pushed through its head repository.

Use the PR's `reviewThreads` GraphQL connection for thread IDs, `isResolved`, `isOutdated`, `viewerCanResolve`, and each thread's `comments` connection. Retain comment `id`, `url`, `body`, author, and timestamps. Fetch every page of both connections. Advancing the outer thread cursor does not paginate the comments inside each thread. Query review summaries and PR conversation comments as well, using GraphQL connections or these REST lists:

- `GET /repos/{owner}/{repo}/pulls/{number}/reviews` for review summaries.
- `GET /repos/{owner}/{repo}/issues/{number}/comments` for PR conversation comments.

Use `gh api --paginate` for REST lists. REST `node_id` is the GraphQL node ID; REST numeric `id` belongs to the REST endpoint. Keep each comment's kind with its ID. When resuming, read previous replies and reactions alongside current code to identify already completed operations.

See GitHub's [GraphQL reference](https://docs.github.com/en/graphql/reference), [PR review REST API](https://docs.github.com/en/rest/pulls/reviews), and [issue comment REST API](https://docs.github.com/en/rest/issues/comments) for current fields and endpoints.

## Reply in the right place

For a review thread, use GraphQL `addPullRequestReviewThreadReply` with `pullRequestReviewThreadId` and `body`. For review summaries and PR conversation comments, use `gh pr comment <pr> --body-file <file>` and include the original comment URL. A review summary is a review node, not an issue comment or a review thread.

Follow [github-markdown-bodies](../../github-markdown-bodies/SKILL.md). With `gh api`, pass a Markdown file as `-F body=@<file>` when the endpoint supports form fields, or build a JSON payload with an encoder and use `--input <file>`. Read the posted body back and verify its contents before continuing.

## React to the original comment

GraphQL `addReaction` accepts the original comment's node ID as `subjectId` and `THUMBS_UP` or `THUMBS_DOWN` as `content`. It supports `PullRequestReviewComment`, `IssueComment`, and `PullRequestReview`, so it also covers review summaries. Check `viewerCanReact` and the viewer's existing reactions. Add only the required reaction, preserving other users' reactions. If this invocation changes a prior verdict, remove only the acting account's obsolete thumbs reaction; mixed comments must have no verdict reaction from that account.

For inline review comments and PR conversation comments, the [REST reaction API](https://docs.github.com/en/rest/reactions/reactions) is an alternative. It uses `+1` and `-1` at the respective `/pulls/comments/{comment_id}/reactions` and `/issues/comments/{comment_id}/reactions` endpoints. These use numeric comment IDs, not the PR number or thread ID. Use GraphQL for review-summary reactions.

## Resolve and verify

Use GraphQL `resolveReviewThread` with the thread node ID as `threadId`, after the skill's handling criteria are met. Check `viewerCanResolve` first and confirm `thread { id isResolved }` in the result. Refresh the thread to verify remote state. Posting a reply, reacting, or pushing a commit does not resolve a thread.

PR conversation comments and review summaries have no equivalent resolved flag. Report their replies and reactions, and reserve "resolved" for review threads confirmed as resolved by GitHub.

After a failed or ambiguous mutation, re-read the corresponding reply, viewer reaction, or thread state before retrying. If the operation remains blocked, leave it pending and report the exact missing permission or failed operation.
