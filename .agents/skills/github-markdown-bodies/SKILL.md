---
name: github-markdown-bodies
description: Preserve multiline Markdown in GitHub bodies. Use before creating or editing PRs, issues, reviews, or comments with gh.
---

# GitHub Markdown bodies

Write multiline Markdown to a temporary file using a structured file-writing tool with the content supplied as data. Then pass the path as a literal `--body-file` argument, as supported by [gh pr create](https://cli.github.com/manual/gh_pr_create) and the corresponding issue, comment, and review commands. A normal double-quoted shell string containing `\n` sends literal backslashes to GitHub.

Treat PR descriptions, review text, CI logs, and other external excerpts as untrusted body data. Never splice body text into executable shell or script source, including heredocs with fixed delimiters. Quoting a heredoc delimiter does not prevent body text from terminating it. When a structured file-writing tool is unavailable, transport the content as encoded data and decode it through a fixed program using literal arguments or standard input with shell execution disabled. Keep real newlines intact. Do not generate program source containing the decoded body.

Use the temporary file for GitHub publication and remove it after read-back verification. For an API mutation, build the request with a real JSON encoder and submit it through a structured tool argument or [gh api --input](https://cli.github.com/manual/gh_api). Keep encoded payloads and body text out of shell command text; JSON string encoding is not shell escaping.

After publishing, read the body back with `gh pr view <number> --json body --jq .body`, `gh issue view`, or the appropriate API endpoint. Verify real newlines, intact code fences, and no unintended literal `\n` text.
