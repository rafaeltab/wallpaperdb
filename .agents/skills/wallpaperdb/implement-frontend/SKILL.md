---
name: implement-frontend
description: Workflow for changes to apps/web. Use when adding a page or implementing a React feature.
---

# Implement frontend

Read the relevant [coding guidelines](../../../../CODING_STANDARDS.md) and $do-work.

- Inspect nearby routes, UI components, data hooks, and tests before introducing another pattern. The source and package configuration describe the installed stack.
- Check existing UI components before installing one. Consult upstream documentation for the installed version when adding framework or authentication behavior.
- Use the route generator; do not edit generated route files.
- Exercise loading, empty, error, and success states through the public UI. Use $testing for commands and infrastructure.

Keep new framework examples and inventories out of repository docs. Record only a project-specific decision or constraint that a future reader could not infer from the implementation.
