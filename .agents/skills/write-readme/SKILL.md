---
name: write-readme
description: Write or refresh a workspace README with its purpose, core capabilities, and relevant technology choices.
---

# Write a workspace README

Read the workspace's public entry points, relevant behavior, and domain decisions before writing. Keep accurate existing content when it earns its place.

Include:

- What the workspace does and why it exists, in one or two sentences.
- Core capabilities, expressed as outcomes for users or consumers. Give these a clear section so readers can understand the workspace without opening its source.
- Non-obvious ownership boundaries and constraints, plus technology choices specific to this component when they help explain its capabilities. Omit stack-wide dependency lists.
- Links to relevant context, ADRs, or the shared setup guide when they help the reader's next step.

Omit directory trees, API inventories, version and port numbers, configuration tables, copied commands, and descriptions of internal classes. Link to the authoritative source or shared guide instead of reproducing it.

Keep enough detail for a reader to understand the workspace's purpose, supported tasks, and important limits. Purpose and capability summaries belong in a README even when those capabilities can also be discovered in code. Keep implementation details in the source and operational procedures in their shared guides.
