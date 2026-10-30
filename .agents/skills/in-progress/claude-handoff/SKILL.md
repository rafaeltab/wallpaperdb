---
name: claude-handoff
description: Hand the current conversation off to a fresh background agent that picks up the work immediately.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Save a handoff summary in the OS temporary directory, then launch a background agent with it:

```sh
claude --bg --name "<descriptive name>" -- "$(cat <summary file>)"
```

The quoted substitution passes the summary without executing its backticks or expanding its `$` characters. The agent starts in the current directory and returns immediately; the user manages it with `claude agents`. Always supply a descriptive `--name` for the job list, session picker, and terminal title.

Include a "suggested skills" section naming skills the next agent should invoke. Link existing specs, plans, ADRs, issues, commits, and diffs rather than duplicating them. Redact secrets and personally identifiable information because the summary becomes a prompt.

If the user supplied arguments, tailor the handoff to that next-session focus.
