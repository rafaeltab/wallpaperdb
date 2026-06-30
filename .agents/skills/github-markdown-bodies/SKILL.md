---
name: github-markdown-bodies
description: Create correctly formatted GitHub PR, issue, and comment bodies with the gh CLI. Use before running gh pr create/edit, gh issue create/edit/comment, gh pr review, or gh api GraphQL mutations with multi-line Markdown bodies.
---

# GitHub Markdown Bodies

Use this whenever you create or edit GitHub PRs, issues, reviews, or comments with multi-line Markdown.

## Core rule

Never pass multi-line Markdown as a normal double-quoted shell string containing `\n` escapes:

```sh
# Bad: GitHub receives literal backslash-n text
gh pr create --body "## Summary\n- item\n"
```

In POSIX shells, `\n` inside double quotes stays as the two characters backslash + `n`. GitHub will render visible `\n` text.

## Preferred pattern: body files

Write the body to a temporary Markdown file with a quoted heredoc, then pass `--body-file`:

```sh
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
## Summary

- Refs #123
- Explain what changed.

## Verification

- `make test` passed.
EOF

gh pr create \
  --base main \
  --head my-branch \
  --title "Add feature" \
  --body-file "$body_file"

rm -f "$body_file"
```

Use the same pattern for issues:

```sh
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
Observed while running the local stack.

```text
error output here
```
EOF

gh issue create --title "Document startup failure" --body-file "$body_file"
rm -f "$body_file"
```

And for issue comments:

```sh
body_file=$(mktemp)
cat > "$body_file" <<'EOF'
Progress update:

- Completed the focused verification.
- Follow-up issue: #456
EOF

gh issue comment 123 --body-file "$body_file"
rm -f "$body_file"
```

## Acceptable inline pattern

If the body is tiny and inline text is truly simpler, use Bash ANSI-C quoting deliberately:

```sh
gh issue comment 123 --body $'Line one\n\n- Real Markdown bullet'
```

Do not use this for long bodies, code fences, or text containing secrets or quotes. Prefer `--body-file`.

## GraphQL/API comments

For `gh api graphql` mutations such as `updateIssueComment`, avoid putting long Markdown directly in `-f body=...`. Use a file plus `--field body=@file` if supported, or build JSON with a real JSON encoder:

```sh
python3 - <<'PY' > /tmp/comment-vars.json
import json
body = """Line one

- Real bullet
"""
print(json.dumps({"id": "COMMENT_NODE_ID", "body": body}))
PY

gh api graphql \
  -f query='mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id}}}' \
  --input /tmp/comment-vars.json
```

## Required verification

After creating or editing a GitHub body, verify GitHub received real newlines:

```sh
gh pr view <number> --json body --jq .body
# or
gh issue view <number> --json body --jq .body
```

If you need a machine check:

```sh
body=$(gh pr view <number> --json body --jq .body)
python3 - <<'PY'
import os
body = os.environ["BODY"]
assert "\\n" not in body, "Body contains literal backslash-n text"
assert "\n" in body, "Body has no real newlines"
PY
```

Run that with `BODY="$body" python3 ...`.

## Checklist

Before finishing any GitHub PR/issue/comment operation:

- [ ] Multi-line Markdown was passed with `--body-file`, not `--body "...\n..."`.
- [ ] Code fences were preserved as real Markdown.
- [ ] `gh ... view --json body --jq .body` shows normal line breaks.
- [ ] There is no visible literal `\n` text unless the text is intentionally documenting escape sequences.
