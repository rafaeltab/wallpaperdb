# Learning Record Format

Store records in `learning-records/0001-slug.md`, incrementing the highest existing number. Create the directory with the first record. Records guide future lessons and the user's zone of proximal development.

## Template

```md
# {Short title}

{1–3 sentences describing what was learned or established and why it matters for future sessions.}
```

## Optional sections

Include only when useful:

- Status frontmatter (`active | superseded by LR-NNNN`) for replaced understanding.
- Evidence of understanding, such as an exercise or stated experience.
- Implications for future sessions that are not obvious.

## Numbering

Scan `learning-records/` and increment its highest number.

## When to write a learning record

Write a record when the user:

1. Demonstrates understanding of a non-trivial concept.
2. States prior knowledge, including its claimed depth.
3. Corrects a misconception.
4. Changes their mission through learning. Cross-link `MISSION.md` and update it after confirmation as required by [the skill](SKILL.md#the-mission).

### What does _not_ qualify

Do not record material merely covered, definitions already captured in `GLOSSARY.md`, or session activity logs.

## Supersession

When a later record contradicts an earlier one, mark the old record `Status: superseded by LR-NNNN` rather than deleting it. Preserve the history of understanding.
