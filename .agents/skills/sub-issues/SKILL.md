---
name: sub-issues
description: Link GitHub issues as sub-issues of a parent issue using the GitHub REST API. Use after creating child issues from a PRD, or whenever issues need to be marked as sub-issues of a parent.
---

# Sub-Issues

GitHub sub-issues create a visible parent/child relationship on the issue page. They are NOT the same as mentioning `#123` in the body.

## How to link a sub-issue

You need three things: the parent issue ID, the child issue ID, and the repository ID. All must be **numeric IDs**, not issue numbers.

### Step 1: Get the numeric IDs

```bash
# Get repo ID
REPO_ID=$(gh api repos/<owner>/<repo> --jq '.id')

# Get numeric ID for each issue (number ≠ id)
PARENT_ID=$(gh api repos/<owner>/<repo>/issues/<parent-number> --jq '.id')
CHILD_ID=$(gh api repos/<owner>/<repo>/issues/<child-number> --jq '.id')
```

### Step 2: Link via the sub-issues API

```bash
gh api repos/<owner>/<repo>/issues/<parent-number>/sub_issues \
  --method POST \
  --field sub_issue_id=<CHILD_ID> \
  --field sub_issue_repository_id=<REPO_ID>
```

Replace `<parent-number>` with the parent issue number (e.g. `100`), `<CHILD_ID>` with the child's numeric ID from step 1, and `<REPO_ID>` with the repo's numeric ID.

## Common mistakes

- **Using issue numbers instead of IDs.** `gh issue view 100` shows number `100` but the API needs the numeric `id` field. These are different values.
- **Forgetting `--method POST`.** The default is GET which returns a 404.
- **Using node_id instead of id.** The sub-issues API requires the numeric `id`, not the base64 `node_id`.

## Batch linking

When creating multiple sub-issues from a PRD breakdown, collect all child issue numbers first, then link them all:

```bash
REPO_ID=$(gh api repos/<owner>/<repo> --jq '.id')

for CHILD_NUM in 102 103 104; do
  CHILD_ID=$(gh api repos/<owner>/<repo>/issues/$CHILD_NUM --jq '.id')
  gh api repos/<owner>/<repo>/issues/<parent-number>/sub_issues \
    --method POST \
    --field sub_issue_id=$CHILD_ID \
    --field sub_issue_repository_id=$REPO_ID
done
```
