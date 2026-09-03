# TASK

Fix issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view`, with comments. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits, run tests, and close the issue when done.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `make ci` to ensure the tests pass.

# COMMIT

Create one or more cohesive commits. Each commit message must:

1. Follow Conventional Commits: `type(optional-scope): concise imperative summary`
2. Describe the specific outcome of the change, not the automation or workflow that produced it
3. Keep the subject at 72 characters or fewer
4. Use a body only when it adds useful context about why the change was made or records an important tradeoff
5. End with a `Refs #{{ISSUE_NUMBER}}` footer

Do not use a generic prefix such as `RALPH:` or `Sandcastle:`. Do not inventory files, test commands, or iteration notes in the commit message.

# THE ISSUE

If the task is not complete, leave a comment on the GitHub issue with what was done.

Do not close the issue. The pull request will close it when merged.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
