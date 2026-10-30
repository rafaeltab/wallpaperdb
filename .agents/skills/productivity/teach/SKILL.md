---
name: teach
description: Teach the user a new skill or concept, within this workspace.
disable-model-invocation: true
argument-hint: "What would you like to learn about?"
---

Treat teaching as learning across sessions. Use the current directory as the teaching workspace.

## Teaching Workspace

- `MISSION.md` records why the user is learning and guides every lesson. Use [MISSION-FORMAT.md](MISSION-FORMAT.md).
- `reference/*.html` holds concise, printable reference documents.
- `RESOURCES.md` lists trusted sources and communities. Use [RESOURCES-FORMAT.md](RESOURCES-FORMAT.md).
- `learning-records/0001-<dash-case-name>.md` records non-obvious insights and prior knowledge that guide future sessions. Increment the number for each record. Use [LEARNING-RECORD-FORMAT.md](LEARNING-RECORD-FORMAT.md).
- `lessons/0001-<dash-case-name>.html` holds lessons, numbered sequentially.
- `assets/` holds reusable lesson components. See [Assets](#assets).
- `NOTES.md` records teaching preferences and working notes.

## Philosophy

Gather knowledge from trusted resources, develop skills through interactive practice, and seek practical judgment through interaction with practitioners. Adjust the balance to the topic. Before `RESOURCES.md` is populated, find high-quality sources; do not rely on parametric knowledge.

### Fluency vs Storage Strength

Distinguish immediate recall from long-term retention. Design for retention through retrieval practice, spacing, and interleaving related skills. Immediate fluency can create a false sense of mastery.

## Lessons

Each lesson is a short, self-contained HTML file in `lessons/`, teaching one skill tied to the mission and within the user's zone of proximal development. Give it readable typography and layout suitable for later review.

- Link to related lessons and reference documents with HTML anchors.
- Recommend the best primary source found for the topic.
- Remind the user to ask the agent follow-up questions.
- Open the file with a CLI command if possible.

## Assets

Read `assets/` before authoring lessons and reuse its stylesheets, quizzes, simulators, and diagram helpers. Put new reusable components there rather than duplicating inline code. Start with a shared stylesheet linked by every lesson.

## The Mission

If `MISSION.md` is missing or unclear, first ask why the user wants to learn. Confirm with the user before changing the mission, then update it and record the change in a learning record.

## Zone Of Proximal Development

Challenge the user just beyond their current ability. When they have not requested a specific lesson, read their learning records and choose the next relevant skill from their mission.

## Knowledge

Teach only the knowledge needed for the lesson's skill, then practice through an interactive feedback loop. Gather it from trusted resources recorded in `RESOURCES.md` and cite sources for claims. Make explanations easy to understand so difficulty does not consume working memory needed for learning.

## Skills

Use effortful retrieval to build retention and flexible application. Provide quizzes, browser tasks, or guided real-world practice with immediate feedback, preferably automatic.

For quizzes, make answers the same word count and, if possible, character count. Formatting must not reveal the correct answer.

## Acquiring Wisdom

For questions requiring practical judgment, attempt an answer and recommend a reputable community where the user can practice with others. Consider forums, classes within budget, or local groups. Respect a preference against joining communities.

## Reference Documents

Create concise reference documents alongside lessons for facts used across sessions, such as syntax, algorithms, poses, routines, and terminology. Make them readable, printable, and easy to consult. Once a glossary exists, use its terminology in every lesson.

## `NOTES.md`

Record the user's teaching preferences here and consult them when designing lessons.
