# Writing agent briefs

An agent brief is the authoritative specification posted as a comment when an issue or PR moves to `ready-for-agent`. The body and discussion provide context. For a PR, specify what remains to finish or fix in the existing diff.

## Principles

### Durability over precision

Describe interfaces, types, function signatures, config shapes, and behavioral contracts. Avoid file paths, line numbers, and assumptions about implementation structure, which may change before the agent starts.

### Behavioral, not procedural

Describe the required behavior and leave implementation choices to the agent. For example, require an optional `schedule: CronExpression` on `SkillConfig` rather than prescribing edits to a particular file.

### Complete acceptance criteria

Every brief must include concrete, independently verifiable acceptance criteria.

### Explicit scope boundaries

State what is out of scope, including adjacent features the agent might otherwise assume are included.

## Template

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description of what needs to happen

**Current behavior:**
Describe what happens now. For bugs, this is the broken behavior.
For enhancements, this is the status quo the feature builds on.

**Desired behavior:**
Describe what should happen after the agent's work is complete.
Be specific about edge cases and error conditions.

**Key interfaces:**
- `TypeName`: what needs to change and why
- `functionName()` return type: what it currently returns vs what it should return
- Config shape: any new configuration options needed

**Acceptance criteria:**
- [ ] Specific, testable criterion 1
- [ ] Specific, testable criterion 2
- [ ] Specific, testable criterion 3

**Out of scope:**
- Thing that should NOT be changed or addressed in this issue
- Adjacent feature that might seem related but is separate
```

## Examples

### Good agent brief (bug)

```markdown
## Agent Brief

**Category:** bug
**Summary:** Skill description truncation drops mid-word, producing broken output

**Current behavior:**
When a skill description exceeds 1024 characters, it is truncated at exactly
1024 characters regardless of word boundaries. This produces descriptions
that end mid-word (e.g. "Use when the user wants to confi").

**Desired behavior:**
Truncation should break at the last word boundary before 1024 characters
and append "..." to indicate truncation.

**Key interfaces:**
- The `SkillMetadata` type's `description` field: no type change needed,
  but the validation/processing logic that populates it needs to respect
  word boundaries
- Any function that reads SKILL.md frontmatter and extracts the description

**Acceptance criteria:**
- [ ] Descriptions under 1024 chars are unchanged
- [ ] Descriptions over 1024 chars are truncated at the last word boundary
      before 1024 chars
- [ ] Truncated descriptions end with "..."
- [ ] The total length including "..." does not exceed 1024 chars

**Out of scope:**
- Changing the 1024 char limit itself
- Multi-line description support
```

### Good agent brief (enhancement)

Use the same template for enhancements. Describe the status quo, desired behavior, affected interfaces, acceptance criteria, and exclusions.

### Good agent brief (PR)

For a PR adding `--json`, describe which paths already work and which remain incomplete. Criteria might require JSON errors, unchanged exit codes, success and error tests, and unchanged default output. Exclude adding the flag to other commands or changing the existing success payload.

### Bad agent brief

"Fix the triage bug near line 150" omits the category, current and desired behavior, acceptance criteria, and scope. It also relies on a location that can change.
