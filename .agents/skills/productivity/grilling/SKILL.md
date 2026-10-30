---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

For planning tied to an existing GitHub issue, follow [issue claiming](../../../../docs/agents/issue-tracker.md#claiming-an-issue) and the [project lifecycle](../../../../docs/agents/issue-tracker.md#project-lifecycle), including its reopening gate, to verify `OPEN` before setting `Planning` when the interview starts. After the user confirms the shared understanding and the agreed plan is recorded in the issue, verify `Planned`. An unfinished interview stays in `Planning`; a conversation without an issue has no status to update.

Interview the user until you share an understanding. Map a design tree of decisions and their dependencies.

Work in rounds. The frontier contains decisions whose prerequisites are settled. Ask the whole frontier, number the questions, recommend answers, and wait for the user before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

After each round, recompute the frontier. Defer questions that depend on unanswered questions.

Dispatch subagents to find facts available from the environment rather than asking the user. While they investigate, ask independent frontier questions; defer dependent questions. Put decisions to the user and wait.

Finish when every branch is visited and the frontier is empty. Before acting, obtain the user's confirmation of the shared understanding.
