# Architecture (condensed)

Canonical version: [Architecture overview (Linear)](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f).

## What dorv is

Chrome extension: on PRs with markdown files, create a Google Doc from PR content and keep **GitHub PR review comments** and **Google Drive comments** in sync bidirectionally.

## Entrypoints

| Entrypoint | Match | Role |
| --- | --- | --- |
| `github-sidebar.content` | `github.com/*/pull/*` | PR sidebar — MD detection, doc lifecycle, sync status |
| Side panel | `github.com/*/pull/*`, `docs.google.com` | Comments list, GH→GDoc/ GDOC→GH push, Activities feed, past-docs list |
| `background.ts` | — | Alarms (2 min), message bus, side panel lifecycle per tab URL, threading |
| Options | — | PAT, Google OAuth, optional `backend_url`, Sentry DSN |

## Adapter layer (upgrade seam)

| | DirectAdapter (v0.2.0) | BackendAdapter (later) |
| --- | --- | --- |
| Auth | GitHub PAT + `chrome.identity` | GitHub App installation token |
| Sync | Alarm every 2 min, GraphQL `reviewThreads` | Webhooks |
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
3. Bot comment on PR with doc link (`<!-- dorv-doc-id=... -->` marker).
4. Poll via GraphQL `reviewThreads`: new GH review threads → Drive comments as anchored comments.
5. Thread lifecycle: resolution sync, destructive whole-thread updates on edit.
6. GDoc pickup: existing bot comments scanned on `createDoc` to reuse linked docs.

All GH→GDoc comments carry a `[GitHub: @user]` prefix and a `[View on GitHub]` link. Mapping guards (`hasByGH` / `hasByDoc`) prevent double-sync.

**Google Doc → GitHub**

1. Side panel on Docs tab.
2. Drive comment → line match via `quotedFileContent` → push GH review comment.
3. Drive replies on mapped threads → GH replies.
4. Sidepanel filter excludes GH→GDoc mirror comments from pushable list.

**GDoc pickup from bot comments**

If the user (or a collaborator) already created a Google Doc for a PR, `createDoc` scans PR issue comments for a dorv bot comment containing `<!-- dorv-doc-id=... -->` or the legacy `**dorv**` text. On match, it creates a local `DocMapping` and returns early — no new Drive file or bot comment is created.

## Activities feed

Replaces the old PR Info tab. Every synced event (comment synced, reply synced, thread resolved) is recorded in a persisted `SyncedActivity` store (capped at 1000 events). The sidepanel's Activities tab shows them in reverse-chronological order.

## Storage efficiency

- Comment mappings: per-GH-ID and per-doc-ID entries for O(1) lookup per mapping; per-PR array for bulk listing.
- Persisted query cache (TanStack Query): limited to 100 GH comments, bodies truncated to 200 chars, 30-min TTL.
- Auto-cleanup: stale snapshots removed on hydrate.
- Sync intervals: background alarm 2 min, sidepanel auto-refresh 2 min.

## Stale commits

Each poll: compare `pr.head.sha` to stored `headSha`. If different → `isStale = true` (amber UI). **No automatic doc rewrite** (would orphan Drive anchors).

## Enterprise

1. `npm run zip` → Chrome Web Store (or private)
2. Google Admin force-install by extension ID
3. Managed storage: pre-set `backend_url`
4. Options shows “Set by IT” for managed values
