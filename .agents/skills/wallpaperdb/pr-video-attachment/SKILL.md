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

Pass that same path with `--attach` and the body file with `--body-file` to `gh pr create` or `gh pr edit`. GitHub replaces the local reference with an uploaded attachment that renders as a video player. Follow $github-markdown-bodies for the rest of the PR body.

After publishing, run `make run PACKAGE=scripts SCRIPT=agent ARGS='verify-video <pr>'`. Fix any reported missing player, controls, source, or public-access failure before finishing.
