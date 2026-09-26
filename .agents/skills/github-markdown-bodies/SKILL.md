---
name: github-markdown-bodies
description: Preserve multiline Markdown in GitHub bodies. Use before creating or editing PRs, issues, reviews, or comments with gh.
---

# GitHub Markdown bodies

Write multiline Markdown to a temporary file, then pass `--body-file`. A normal double-quoted shell string containing `\n` sends literal backslashes to GitHub.

```sh
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
## Changes

Describe the change and its validation here.
EOF
gh pr create --title "Title" --body-file "$body_file"
rm -f "$body_file"
```

Use the same pattern for issues, comments, and reviews. For an API mutation, use a file-backed field where supported or encode the request with a real JSON encoder. Do not interpolate long Markdown into shell arguments.

After publishing, read the body back with `gh pr view <number> --json body --jq .body`, `gh issue view`, or the appropriate API endpoint. Verify real newlines, intact code fences, and no unintended literal `\n` text.
