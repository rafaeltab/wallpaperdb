# AGENTS.md

This file provides guidance to AI agents (Claude, Gemini, etc.) when working with code in this repository.

---

## Known Tool Behaviors

### Bash Command Execution Order

**Issue:** OpenCode sometimes doesn't perform bash tasks in the order they appear, especially when one of them needs to ask for permission.

**Impact:** When making multiple bash tool calls in parallel (e.g., `git add` followed by `git status`), if one requires user permission, the second command may execute before the first one completes. This can lead to seeing stale state.

**Workaround:** Chain dependent commands with `&&` in a single bash call, or wait for permission-requiring commands to complete before issuing subsequent commands.

**What happened:** When moving files with `git mv` and then checking status, the status command ran before the move permission was granted, showing incorrect state. However, the moves were actually performed correctly.
