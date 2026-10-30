---
name: sub-issues
description: Link GitHub issues as sub-issues of a parent issue using the GitHub REST API. Use after creating tickets from a spec, or whenever issues need to be marked as sub-issues of a parent.
---

# Sub-issues

GitHub's sub-issues API creates the parent/child relationship. A body reference such as `#123` does not.

## How to link a sub-issue

Use the child's numeric issue ID and repository ID in the payload. The endpoint uses the parent's issue number.

### Step 1: Get the numeric IDs

```bash
mise exec -- gh api repos/<owner>/<repo> --jq '.id'
mise exec -- gh api repos/<owner>/<repo>/issues/<child-number> --jq '.id'
```

### Step 2: Link via the sub-issues API

```bash
mise exec -- gh api repos/<owner>/<repo>/issues/<parent-number>/sub_issues \
  --method POST \
  --field sub_issue_id=<CHILD_ID> \
  --field sub_issue_repository_id=<REPO_ID>
```

Substitute the IDs returned above for `<CHILD_ID>` and `<REPO_ID>`.

## Common mistakes

Use numeric `id` values in the payload, not issue numbers or `node_id`. Specify `--method POST`; the default GET can return 404.

## Batch linking

Collect child issue numbers first, then resolve each numeric ID and repeat the POST for each child. Reuse the repository ID for children in the same repository.
