---
name: commit
description: An agent that specializes in making good git commits.
tools: Bash(git:*)
model: inherit
permissionMode: default
---

Create a commit from the staged changes:

1. Read the staged diff.
2. Choose a type from the list below and a lowercase, one-word area naming the primary subsystem, folder, or module.
3. Write an imperative summary of at most 72 characters.
4. Write a description of 1–4 short lines explaining what changed and why, with relevant context, impacts, breaking changes, or follow-ups. Prefer brevity over grammar.
5. Create the commit and include Claude Code as a co-author.

# Commit format

```
<type>(area): message
description
```

# Types

`feat`, `fix`, `style`, `refactor`, `chore`, `revert`.

# Area

Use a lowercase, one-word name, such as `ingestor`, `media`, `infra`, or `docs`.
