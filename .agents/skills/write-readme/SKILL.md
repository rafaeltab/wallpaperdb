---
name: write-readme
description: Write a short workspace README when adding a workspace or replacing a stale summary.
---

# Write a workspace README

Read the workspace's public entry points, relevant behavior, and domain decisions before writing. Keep accurate existing content when it earns its place.

Include:

- What the workspace does and why it exists, in one or two sentences.
- Non-obvious ownership boundaries, constraints, or technology choices that explain its purpose.
- Links to relevant context, ADRs, or the shared setup guide when they help the reader's next step.

Omit directory trees, API inventories, version and port numbers, configuration tables, copied commands, and descriptions of internal classes. Link to the authoritative source or shared guide instead of reproducing it.

Every sentence should explain purpose, preserve intent that code cannot explain, or help a reader find the authoritative information. A README does not need a capabilities checklist or a section for every available template heading.
