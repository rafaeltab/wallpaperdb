# TASK

Review the code changes on branch {{BRANCH}} for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are an expert code reviewer focused on enhancing code clarity, consistency, and maintainability while preserving exact functionality.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

<issue>

!`gh issue view {{ISSUE_NUMBER}}`

</issue>

<diff-to-base>

!`git diff {{BASE_BRANCH}}..HEAD`

</diff-to-base>

# REVIEW PROCESS

1. **Understand the change**:

2. **Analyze for improvements**: Look for opportunities to:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve readability through clear variable and function names
   - Consolidate related logic
   - Remove unnecessary comments that describe obvious code
   - Avoid nested ternary operators - prefer switch statements or if/else chains
   - Choose clarity over brevity - explicit code is often better than overly compact code

3. **Maintain balance**: Avoid over-simplification that could:
   - Reduce code clarity or maintainability
   - Create overly clever solutions that are hard to understand
   - Combine too many concerns into single functions or components
   - Remove helpful abstractions that improve code organization
   - Make the code harder to debug or extend

4. **Apply project standards**: Follow the established coding standards in the project at @.sandcastle/CODING_STANDARDS.md.

5. **Preserve functionality**: Never change what the code does - only how it does it. All original features, outputs, and behaviors must remain intact.

# EXECUTION

If you find improvements to make:

1. Make the changes directly on this branch
2. Run `make ci` to ensure nothing is broken
3. Commit the refinements using Conventional Commits. Use a specific, imperative subject of 72 characters or fewer and end the message with a `Refs #{{ISSUE_NUMBER}}` footer.

If the code is already clean and well-structured, do nothing.

# COMPLETION

Do not close the issue. The pull request will close it when merged.

Summarize the complete branch for its pull request, including the implementation and any review refinements. Produce:

- A Conventional Commit-style title of 72 characters or fewer that names the delivered outcome
- One to three summary items explaining the important behavior and design choices
- The exact validation commands that passed

Output the result as valid JSON inside `<pull-request>` tags using this exact shape:

<pull-request>
{"title":"feat(scope): describe the delivered outcome","summary":["Describe an important outcome."],"testing":["make ci"]}
</pull-request>

Then output <promise>COMPLETE</promise>.
