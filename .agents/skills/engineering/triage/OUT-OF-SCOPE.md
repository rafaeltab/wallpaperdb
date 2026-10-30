# Out-of-scope knowledge base

The `.out-of-scope/` directory records rejected features and their rationale so triage can recognize repeated requests.

## Directory structure

Keep one Markdown file per concept, grouping all requests for that feature.

## File format

Write a short explanation of the decision and its rationale, with links to prior requests. Use code or examples only when they clarify the reason.

```markdown
# Dark mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

`ThemeConfig` resolves a single palette at build time. Runtime themes would
require changes throughout rendering and preference persistence. The project
focuses on content authoring; downstream consumers own theming.

## Prior requests

- #42: Add dark mode support
```

### Naming the file

Use a descriptive kebab-case name such as `dark-mode.md`.

### Writing the reason

Explain the relevant project scope, technical constraint, or strategic decision. Temporary constraints such as lack of time are deferrals, not rejections.

## When to check `.out-of-scope/`

During triage's context gathering, read all `.out-of-scope/` files. Match by concept, so "night theme" matches `dark-mode.md`. Show the maintainer any matching decision and its reason, then ask whether it still applies.

The maintainer may:

- **Confirm**: the new issue gets added to the existing file's "Prior requests" list, then closed
- **Reconsider**: the out-of-scope file gets deleted or updated, and the issue proceeds through normal triage
- **Disagree**: the issues are related but distinct, proceed with normal triage

## When to write to `.out-of-scope/`

Record enhancements rejected as `wontfix`, including enhancement PRs. Do not record bugs.

For already-implemented requests, link the implementation in the closing comment instead. Recording them here would misclassify later requests as rejected.

The flow:

1. Maintainer decides a feature request is out of scope
2. Check if a matching `.out-of-scope/` file already exists
3. If yes: append the new issue to the "Prior requests" list
4. If no: create a new file with the concept name, decision, reason, and first prior request
5. Post a comment on the issue explaining the decision and mentioning the `.out-of-scope/` file
6. Close the issue with the `wontfix` label

## Updating or removing out-of-scope files

If the maintainer changes their mind about a previously rejected concept:

- Delete the `.out-of-scope/` file
- The skill does not need to reopen old issues; they're historical records
- The new issue that triggered the reconsideration proceeds through normal triage
