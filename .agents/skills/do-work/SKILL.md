---
name: do-work
description: Structured workflow for implementing tasks. Use when the user asks you to implement, build, or make changes to the codebase, or when a task requires more than a single quick fix.
---

# Do Work

## Steps

### 1. Understand

Gather context. Read relevant files, search the codebase, and clarify ambiguities before proceeding.

### 2. Plan

Create a todo list of the implementation steps.

### 3. Implement

Make the changes. Follow existing code conventions and patterns.

### 4. Validate

```sh
make ci
```

This runs build, lint, and all tests. Fix any failures before continuing.

### 5. Format and Commit

```sh
make format
```

Then use the commit subagent to commit the changes.
