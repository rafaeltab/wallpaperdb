CRITICAL: You MUST use the Task tool to invoke the commit subagent. DO NOT run git commands directly.

Execute this immediately:
- Use Task tool with subagent_type='commit'
- The commit agent has access to git commands and will handle the entire commit process
- Do NOT use Bash tool for git status, git diff, git add, git commit, or any other git commands

Example invocation:
Task(subagent_type='commit', prompt='Create a commit for the currently staged changes', description='Create git commit')

DO NOT:
- Run git status yourself
- Run git diff yourself
- Run git log yourself
- Create the commit message yourself
- Use the Bash tool for any git operations

The commit agent will handle all of this autonomously.
