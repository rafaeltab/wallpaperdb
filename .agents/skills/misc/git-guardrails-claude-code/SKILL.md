---
name: git-guardrails-claude-code
description: Set up Claude Code hooks to block dangerous git commands (push, reset --hard, clean, branch -D, etc.) before they execute. Use when user wants to prevent destructive git operations, add git safety hooks, or block git push/reset in Claude Code.
---

# Setup Git Guardrails

Install a PreToolUse hook that blocks dangerous git commands before Claude runs them.

## What Gets Blocked

- `git push`, including `--force`.
- `git reset --hard`.
- `git clean -f` and `git clean -fd`.
- `git branch -D`.
- `git checkout .` and `git restore .`.

Blocked commands tell Claude it lacks authority to run them.

## Steps

### 1. Ask scope

Ask whether to install for this project in `.claude/settings.json` or globally in `~/.claude/settings.json`.

### 2. Copy the hook script

Copy [scripts/block-dangerous-git.sh](scripts/block-dangerous-git.sh) to `.claude/hooks/block-dangerous-git.sh` under the project or home directory, according to scope. Make it executable with `chmod +x`.

### 3. Add hook to settings

Merge this entry into `hooks.PreToolUse` without overwriting other settings:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous-git.sh"
    }
  ]
}
```

For global installation, use `~/.claude/hooks/block-dangerous-git.sh` as the command instead.

### 4. Ask about customization

Ask whether to add or remove blocked patterns, then edit the copied script accordingly.

### 5. Verify

```sh
echo '{"tool_input":{"command":"git push origin main"}}' | <path-to-script>
```

Require exit code 2 and a BLOCKED message on stderr.
