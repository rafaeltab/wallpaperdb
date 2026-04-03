---
name: write-readme
description: Write or refresh a workspace README. Use when adding a new workspace (service or package) or when an existing README needs to be replaced with an accurate, stable executive summary.
---

# Write README

## When to Use

- You are adding a new workspace (`apps/<service>` or `packages/<package>`)
- You are refreshing an existing README that is stale, overly long, or contains volatile information

## Process

1. **Delete the existing README** (if one exists) — do not attempt to edit it; start fresh
2. **Read the entire workspace source** — read all source files to understand what the workspace actually does and why it exists
3. **Write a new executive summary README** following the format rules below

## README Format Rules

A README for a workspace must contain only:

- **What it is and why it exists** — one to two sentences; the purpose, not the implementation
- **Key capabilities** — what the workspace does, expressed as outcomes, not implementation details or internal mechanisms
- **Technology choices specific to this component** — only tools and libraries that are notable or non-obvious for this particular workspace; omit stack-wide choices that apply to every workspace

A README must **never** contain:

- File trees or directory listings
- Make commands, pnpm scripts, or shell invocations
- Configuration values, environment variables, or connection strings
- `localhost` URLs or port numbers
- References to specific file names or paths
- Step-by-step setup or usage instructions
- Any information that reflects the current state of the codebase rather than the stable purpose of the workspace

## Validation Checklist

Before finalising, apply this test to every sentence:

> Could this sentence become inaccurate without any change to the workspace's core purpose?

If yes, remove it. A README should remain accurate as long as the workspace exists and serves its stated purpose.

Examples of content that **fails** this test (remove it):
- "Currently supports JPEG, PNG, and WebP" — format support changes without changing purpose
- "Exposes a REST API on port 3001" — ports change; REST vs GraphQL could change
- "Uses Sharp v0.33" — version numbers change
- "See `src/services/upload.service.ts` for details" — file names change

Examples of content that **passes** this test (keep it):
- "Accepts wallpaper uploads, validates them, and publishes domain events for downstream processing"
- "Uses content-based MIME detection to reject files that misrepresent their format"
- "Implements a write-ahead state machine to guarantee upload durability across partial failures"
