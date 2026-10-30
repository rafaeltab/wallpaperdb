---
name: pr
description: "Use when writing a PR body."
metadata:
  credits:
    skill: show-me
    author: Dex Horthy
    organisation: Humanlayer
    url: "https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md"
---

Use this PR body template:

```markdown
## Summary

<diagram, diff sketch, or tree>

## Evidence

- **Before:** <screenshot/output/failing test run>
  **After:** <screenshot/output/passing test run>

## Merge Danger

**Door:** <one-way or two-way>

<optional explanation>

**Blast Radius:** <one-word description>

<optional ramifications>
```

## Closing issues

Put a separate `Closes #123` line in Summary for each fully resolved issue. For another repository, use `Closes owner/repository#123`. Repeat the keyword for every issue, as ordinary body text outside code fences. Use `Refs #123` for partial or related work that should remain open.

Check the PR's base against the default branch. Closing keywords apply only to PRs targeting that branch. For stacks or other bases, carry the closing references into the PR delivering the completed work to the default branch. Keep the intended base and report that intermediate merges leave issues open.

After publishing or editing, verify that GitHub's `closingIssuesReferences` exactly matches the intended repository identities and issue numbers for a default-branch PR. Correct mismatches and verify again before claiming completion; report any unresolved mismatch.

See [GitHub's issue-linking rules](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

## Sections

Keep prose brief, omit preambles, and use `GLOSSARY.md` vocabulary.

### Summary

Choose the smallest visual that explains the change:

- Pseudocode for logic or an algorithm.
- A call tree for runtime control flow.
- A component tree for UI structure and relevant state or module ownership.
- A shallow file tree for responsibilities or layout changes.
- Mermaid for interactions, control flow, or data flow.
- A diff when the surrounding structure already exists.

For example:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write content
+  invalidate cache
```

Show a whole block when most is new, omitted context would hide ownership or order, or the reader needs a copyable target.

#### Guidance

Place each visual beside the text it supports. Include only relevant calls, files, props, states, and relationships. Use multiple visuals only when each adds useful information.

### Evidence

Show concrete before/after evidence. Prefer screenshots for visual changes when the environment supports them. Otherwise use test results or console output, showing the exact test's failure and success in pseudocode.

### Merge Danger

A two-way door is cheap to roll back. A one-way door involves destructive actions or hard-to-reverse decisions. State which applies and describe the affected scope, such as consumers or mobile layouts.
