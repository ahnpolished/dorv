# GitHub authentication

dorv v0.1 uses DirectAdapter: each user provides a GitHub personal access token (PAT), and the extension stores it in `chrome.storage.local`. Google auth is separate and uses `chrome.identity`.

The PAT must be able to read PR markdown files, read PR review comments, create PR review comments, and post the Google Doc link back to the PR timeline.

## Recommended token

Use a fine-grained PAT when the repository owner and GitHub Organization policy support it.

For an organization-owned repository:

1. Create the fine-grained PAT from the GitHub account that will use dorv.
2. Set **Resource owner** to the organization that owns the repository, not the user's personal account.
3. Under **Repository access**, select the target repository, or all repositories if that is acceptable for the org.
4. Grant these repository permissions:

| Permission | Access | Why dorv needs it |
| --- | --- | --- |
| Metadata | Read-only | Required by GitHub for repository lookup. |
| Contents | Read-only | Read markdown files from the PR. |
| Pull requests | Read and write | Read review comments and create PR review comments from Google Doc comments. |
| Issues | Read and write | Post the Google Doc link as a PR timeline comment. Pull requests are issues in this REST API path. |

`Actions`, `Workflows`, `Administration`, and `Contents: Read and write` are not required for normal dorv v0.1 usage.

If the repository is owned by the user's personal account, set **Resource owner** to that user and select the repository.

## Organization approval

GitHub Organizations can require owner approval before a fine-grained PAT can access organization resources. In that policy, a pending token may still read public organization resources, but write APIs can fail until an owner approves the request.

Before treating a dorv error as a product bug, confirm:

- the token's resource owner is the repository owner organization
- the repository is included in the token's repository access
- the token has the permissions listed above
- the organization has approved the token if approval is required
- the user's GitHub account has write access to the repository

## 403: Resource not accessible by personal access token

This GitHub response usually means the token exists but is not allowed to write to the target repository:

```json
{
  "message": "Resource not accessible by personal access token",
  "documentation_url": "https://docs.github.com/rest/issues/comments#create-an-issue-comment",
  "status": "403"
}
```

For dorv, this commonly appears after Google Doc creation succeeds and the extension tries to post the doc link to:

```text
POST /repos/{owner}/{repo}/issues/{issue_number}/comments
```

That endpoint supports fine-grained PATs, but the token needs either `Issues: Read and write` or `Pull requests: Read and write` on the target repository. If those permissions are present, check the organization-specific causes first: wrong resource owner, repository not selected, pending org approval, or org policy blocking PAT access.

Quick manual check:

```bash
curl -i -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  https://api.github.com/repos/OWNER/REPO/issues/PR_NUMBER/comments \
  -d '{"body":"dorv PAT permission test"}'
```

Use a disposable test PR or delete the test comment after verification.

## When fine-grained PATs are not enough

Fine-grained PATs currently have important limits for org workflows:

- They cannot access multiple organizations with one token.
- Outside collaborators can only use classic PATs for organization repositories where they are collaborators.
- Organization owners can restrict or require approval for PAT access.

Fallback for v0.1: use a classic PAT with `repo` scope, if the organization allows classic PAT access. This is broader than a fine-grained PAT, so prefer a short expiration and only use it when the fine-grained flow is blocked.

Long-term: GitHub App auth is the better organization model. It gives org owners explicit installation control and avoids asking each user to create broad personal tokens. That belongs to the later BackendAdapter flow, not v0.1 DirectAdapter.

## References

- GitHub REST docs: [Create an issue comment](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)
- GitHub docs: [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- GitHub Enterprise Cloud docs: [Setting a personal access token policy for your organization](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
