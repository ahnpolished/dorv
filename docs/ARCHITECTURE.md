# Architecture (condensed)

Canonical version: [Architecture overview (Linear)](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f).

## What dorv is

Chrome extension: on PRs with markdown files, create Google Docs from PR content (one per markdown file) and keep **GitHub PR review comments** and **Google Drive comments** in sync bidirectionally — user-triggered, not automatic.

## v0.3.0 rewrite

v0.2.0 shipped two P0s that caused user churn: a flickering, sometimes-non-opening GitHub sidebar, and an incident where one PR received 1000+ duplicate synced comments. v0.3.0 replaced the side panel with buttons injected directly into native GitHub/GDoc UI, dropped the 1-minute background alarm in favor of explicit user-triggered sync, and anchored dedup on remote content instead of local storage so a failed local write can no longer cause a resync storm.

### Button injection (no side panel)

Instead of a dedicated extension side panel, dorv injects compact action buttons directly into the native UI of both platforms:

- **GitHub → GDoc** (`github-buttons.content.tsx`): Scans the "Files Changed" view for markdown file headers (`.md` extension) using cascaded CSS selectors (`file-header`, `DiffFileHeader`, etc.). Each detected `.md` file gets a per-file button set injected inline next to its filename — Create Doc, Open Doc, Sync, and a stale badge. Buttons share a branded dorv orange outline wrapper (`.dorv-file-btn-set`) that groups multiple buttons under one visual ring. Injection is idempotent per file header via stable DOM ids derived from the filename.
- **GDoc → GitHub** (`gdoc-buttons.content.tsx`): Scans the Google Docs comment sidebar DOM for unsynced native comment cards. On each card, injects a "Push to GitHub" button. Comment-id extraction and card detection rely on best-effort DOM heuristics (Google Docs' comment sidebar is unofficial/unversioned — see `docs/GDOC_COMMENT_DOM_NOTES.md`).

Both entrypoints communicate with the adapter layer through the background service worker (message bus only — no alarms, no persistent panels).

## Entrypoints

| Entrypoint | Match | Role |
| --- | --- | --- |
| `github-buttons.content` | `github.com/*/pull/*` | Idempotently-injected buttons: create linked doc(s), open doc(s), sync new comments to doc(s), stale badge |
| `gdoc-buttons.content` | `docs.google.com/*` | "Push to GitHub" button injected onto each unsynced native comment card |
| `background.ts` | — | Message bus only (`CREATE_DOC`, `SYNC_PR`, `SYNC_NOW`, `PUSH_DOC_COMMENT_TO_GH`, `GET_DOC_COMMENTS`, `GET_SYNC_STATUS`) — no alarms, no side panel |
| Options | — | PAT, Google OAuth, optional `backend_url`, Sentry DSN |

## Adapter layer (upgrade seam)

| | DirectAdapter (current) | BackendAdapter (later) |
| --- | --- | --- |
| Auth | GitHub PAT + `chrome.identity` | GitHub App installation token |
| Sync | User-triggered per-PR (`syncPR`) via button click; `syncAll()` remains as a manual "sync everything" sweep, no longer alarm-driven | Webhooks |
| Storage | `chrome.storage.local` | Postgres (backend) |
| Switch | `backend_url` empty | `backend_url` set in options |

No reinstall to move from phase 1 → 2. DirectAdapter works for GitHub Organization repositories only when the user's PAT is allowed to access that org and repository; see [GitHub authentication](GITHUB_AUTH.md).

## Data model

- **DocMapping:** `repo`, `prNumber`, `docs: DocFileMapping[]` (`{ filename, docId, docUrl }` — one Google Doc per markdown file; Google Docs' API cannot create tabs programmatically, so a PR maps to a *set* of docs rather than tabs within one doc), `createdAt`, `lastSyncedAt`, `headSha` (anchor), `latestSha`, `isStale`. Multiple `createDoc` calls for different files in the same PR merge into the existing `docs[]` (replace by filename match, append if new). The storage layer (`docStore.upsert`) handles the merge; `createDoc` at the business-logic layer further avoids unnecessary Drive API calls by only creating docs for files not yet mapped.
- **CommentMapping:** `ghCommentId` ↔ `docCommentId`, `docId` (which doc in the set), `source` (`github` \| `gdoc`) — loop guard. Indexed by both GH id and doc id for O(1) bidirectional lookup.
- **ReplyMapping:** `ghReplyId` ↔ `docReplyId`, `ghParentCommentId` ↔ `docParentCommentId`, `docId`, `source`. Indexed by both GH id and doc id.
  - **Nested reply fallback (HUM-1415):** `mappingStore.getByGH()` only indexes root `CommentMapping` records. When a reply's parent is itself a reply (not a root comment), the GH→Doc sync loop falls back to `replyMappingStore.getByGH(reply.inReplyToId)` to resolve the parent mapping. If found, a synthetic `CommentMapping` is built from the parent `ReplyMapping`'s `docParentCommentId` and `docId`, allowing the nested reply to be pushed to the correct GDoc comment thread. The REST-fallback thread normalizer (`normalizeRestThreads`) complements this with recursive `collectNestedReplies()` to ensure nested replies survive in the thread structure before reaching the sync loop.
- **SyncLock:** persisted per-PR lock (`chrome.storage.local`, TTL-based), replacing an in-memory `Map` that didn't survive service-worker restarts

## Sync directions

**GitHub → Google Doc**

1. PR with `.md` files → user clicks "Create linked doc(s)"; one Drive doc created per file (raw MD → `marked` → HTML → Drive multipart).
2. Each doc seeded with that file's content + PR metadata; `headSha` stored once on the `DocMapping`.
3. One bot comment on the PR links all docs (`<!-- dorv-docs={"file.md":"docId",...} -->` marker; the legacy single-doc `<!-- dorv-doc-id=... -->` marker from pre-v0.3.0 PRs is still parsed for backward compatibility).
4. User clicks "Sync new comments to doc" (or the manual sync-all action) → GraphQL `reviewThreads`: new GH review threads routed to the doc matching their file path, pushed as anchored Drive comments.
5. **Dedup anchors on remote content, not local storage**: before pushing a GH comment to a doc, existing Drive comments on that doc are listed and checked for an already-embedded GH comment id (recoverable from the `[View on GitHub](htmlUrl)` link already present in the mirrored body). Only push if no match is found. This is what makes "sync once at most" hold even if the local `chrome.storage.local` write throws (e.g. quota exceeded) — the root cause of the v0.2.0 1000-duplicate incident.
6. GDoc pickup: existing bot comments scanned on `createDoc` to reuse a previously-linked doc set.

All GH→GDoc comments carry a `[GitHub: @user]` prefix and a `[View on GitHub]` link. The local `mappingStore`/`replyMappingStore` remain a fast-path cache (checked first to avoid a remote list call when the mapping is already known); the remote dedup check is the correctness boundary.

**Google Doc → GitHub**

1. `gdoc-buttons.content` injects a "Push to GitHub" button directly onto each unsynced native comment card in the Google Docs comment sidebar (DOM-based; the editor body itself is canvas-rendered and not directly instrumentable — see `docs/GDOC_COMMENT_DOM_NOTES.md`).
2. Click → line match via `quotedFileContent` scoped to the one markdown file that doc corresponds to → push GH review comment, embedding an invisible `<!-- dorv-src=doc:{docCommentId} -->` marker.
3. Before pushing, existing GH comments are checked for that marker (same remote-dedup principle as the GH→GDoc direction) — pushing the same doc comment twice is a safe no-op.
4. Doc replies on mapped threads → GH replies, same dedup principle.

**GDoc pickup from bot comments**

If a Google Doc set already exists for a PR (created by the user or a collaborator), `createDoc` scans PR issue comments for a dorv bot comment (`<!-- dorv-docs=... -->` or the legacy `<!-- dorv-doc-id=... -->`/`**dorv**` markers). On match, it creates a local `DocMapping` and returns early — no new Drive files or bot comment are created.

## Activities feed

Every synced event (comment synced, reply synced, thread resolved) is recorded in a persisted `SyncedActivity` store (capped at 1000 events), currently consumed by telemetry/debugging rather than a dedicated UI surface (the Activities tab lived in the removed side panel).

## Storage efficiency

- Comment mappings: per-GH-ID and per-doc-ID entries for O(1) lookup per mapping; per-PR array for bulk listing.
- Auto-cleanup: stale snapshots removed on hydrate.
- No background polling: sync only runs when a user clicks a button, eliminating the periodic storage-write bursts that caused the v0.2.0 UI flicker.

## Stale commits

Each sync: compare `pr.head.sha` to stored `headSha`. If different → `isStale = true` (amber badge in the GitHub-side button UI). **No automatic doc rewrite** (would orphan Drive anchors). Refresh-doc-content workflow for stale PRs is deferred to v0.3.1.

## Migration (v0.2.0 → v0.3.0)

Clean-slate, not conversion: old-shape `DocMapping`/`CommentMapping`/`ReplyMapping` records are cleared on update via `chrome.runtime.onInstalled`. The legacy bot-comment marker on GitHub is durable independent of local storage, so `createDoc`'s existing-bot-comment scan re-links old single-doc PRs the next time a user clicks "Create linked doc(s)" — no doc-link data loss, but pre-upgrade comment-sync history is gone, so the first post-upgrade sync on an old PR relies on the remote-dedup check (not local history) to avoid re-mirroring every historical comment.

## Enterprise

1. `npm run zip` → Chrome Web Store (or private)
2. Google Admin force-install by extension ID
3. Managed storage: pre-set `backend_url`
4. Options shows "Set by IT" for managed values
