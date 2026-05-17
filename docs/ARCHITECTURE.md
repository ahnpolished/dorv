# Architecture (condensed)

Canonical version: [Architecture overview (Linear)](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f).

## What dorv is

Chrome extension: on PRs with markdown files, create a Google Doc from PR content and keep **GitHub PR review comments** and **Google Drive comments** in sync bidirectionally.

## Entrypoints

| Entrypoint | Match | Role |
| --- | --- | --- |
| `github-sidebar.content` | `github.com/*/pull/*` | PR sidebar — MD detection, doc lifecycle, sync status |
| Side panel | `docs.google.com` | Comments list, push-to-GH, replies |
| `background.ts` | — | Alarms (2 min), message bus, enable side panel on Docs tabs |
| Options | — | PAT, Google OAuth, optional `backend_url` |

## Adapter layer (upgrade seam)

| | DirectAdapter (v0.1.0) | BackendAdapter (later) |
| --- | --- | --- |
| Auth | GitHub PAT + `chrome.identity` | GitHub App installation token |
| Sync | Alarm every 2 min | Webhooks |
| Storage | `chrome.storage.local` | Postgres (backend) |
| Switch | `backend_url` empty | `backend_url` set in options |

No reinstall to move from phase 1 → 2. DirectAdapter works for GitHub Organization repositories only when the user's PAT is allowed to access that org and repository; see [GitHub authentication](GITHUB_AUTH.md).

## Data model

- **DocMapping:** `repo`, `prNumber`, `docId`, `docUrl`, `createdAt`, `lastSyncedAt`, `headSha` (anchor), `latestSha`, `isStale`
- **CommentMapping:** `ghCommentId` ↔ `docCommentId`, `source` (`github` \| `gdoc`) — loop guard
- **ReplyMapping:** reply IDs + parent comment IDs + `source`

## Sync directions

**GitHub → Google Doc**

1. PR with `.md` → user creates doc (raw MD → `marked` → HTML → Drive multipart).
2. Doc seeded with PR metadata; `headSha` stored.
3. Bot comment on PR with doc link.
4. Poll: new GH review comments → Drive comments; replies via `inReplyToId`.

**Google Doc → GitHub**

1. Side panel on Docs tab.
2. Drive comment → line match via `quotedFileContent` → push GH review comment.
3. Drive replies on mapped threads → GH replies.

## Stale commits

Each poll: compare `pr.head.sha` to stored `headSha`. If different → `isStale = true` (amber UI). **No automatic doc rewrite** (would orphan Drive anchors).

## Enterprise

1. `npm run zip` → Chrome Web Store (or private)
2. Google Admin force-install by extension ID
3. Managed storage: pre-set `backend_url`
4. Options shows “Set by IT” for managed values
