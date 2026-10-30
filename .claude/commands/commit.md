Invoke the commit subagent immediately:

```text
Task(subagent_type='commit', prompt='Create a commit for the currently staged changes', description='Create git commit')
```

The subagent handles the entire commit process. Do not run git commands directly, including status, diff, log, add, or commit, and do not write the commit message yourself.
