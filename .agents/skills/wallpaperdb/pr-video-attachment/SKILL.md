---
name: pr-video-attachment
description: Attach a browser recording as a playable video in a GitHub pull request description when creating or updating a PR.
---

# PR video attachment

For a PR-only demonstration, keep the recording outside Git. Use a GitHub CLI version whose `gh pr create` or `gh pr edit` help lists `--attach`; update the CLI or use GitHub's attachment UI if the flag is absent.

Put the video reference alone in its paragraph in the PR body file:

```markdown
![](/absolute/path/demo.webm)
```

Pass that same path with `--attach` and the body file with `--body-file` to `gh pr create` or `gh pr edit`. GitHub replaces the local reference with an uploaded attachment that renders as a video player. Follow [github-markdown-bodies](../github-markdown-bodies/SKILL.md) for the rest of the PR body.

After publishing, read the PR body back and inspect its rendered HTML with `gh api repos/OWNER/REPO/issues/NUMBER -H 'Accept: application/vnd.github.full+json' --jq .body_html`. Confirm it contains a `<video` element with `controls`, then GET the attachment URL without authentication to check reviewer access. Fix a missing or inaccessible attachment before finishing.
