# Distributed PR Review Sync — Architecture Design Doc

## Status: Draft

**Authors:** @ahnopologetic
**Reviewers:** TBD
**Last updated:** 2026-05-25

---

## 1. Overview

This document describes the architecture for syncing GitHub pull request review comments
with Google Docs in near-real-time. The system is designed as a Chrome extension that
requires no backend, storing all state in `chrome.storage.local`.

The primary use case is large markdown PRs where reviewers prefer to comment directly
in a rendered document view rather than the raw diff on GitHub.

### Goals

- Sync PR review comments to Google Doc annotations within 2 minutes of creation
- Support threaded discussions (replies) as nested doc comments
- Preserve comment resolution state
- Handle PRs with 100+ review comments without UI degradation

### Non-goals (v0.1.0)

- Syncing back from GDoc to GitHub (read-only to GDoc)
- Webhook-based real-time sync (polling only)
- Support for non-markdown files
- Multi-account GitHub authentication

---

## 2. System Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                         │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Background  │    │  Side Panel  │    │  Content Script  │  │
│  │  Service     │───▶│  (React UI)  │    │  (GH injection)  │  │
│  │  Worker      │    │              │    │                  │  │
│  └──────┬───────┘    └──────────────┘    └──────────────────┘  │
│         │                                                       │
│  ┌──────▼───────────────────────────────────────────────────┐  │
│  │                    DirectAdapter                          │  │
│  │  - fetchReviewThreads() → GraphQL                         │  │
│  │  - fetchGDocComments() → Drive API v3                     │  │
│  │  - syncThreadsToDoc() → Reconciler                        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                         │
    GitHub GraphQL            Google Drive API v3
    (review threads)          (comments endpoint)
```

### 2.2 Data Flow

1. Alarm fires every 2 minutes
2. Background worker loads `active_prs` from `chrome.storage.local`
3. For each PR:
   a. Fetch review threads from GitHub GraphQL
   b. Fetch current GDoc comments from Drive API
   c. Reconcile: create/update/resolve GDoc comments to match GitHub state
4. Persist updated `CommentMapping` to storage

### 2.3 Sync Direction

Sync is unidirectional: **GitHub → Google Doc only**.

GDoc comment edits are ignored. The sync loop treats GitHub as the source of truth.

---

## 3. Data Models

### 3.1 GitHubReviewThread

```typescript
interface GitHubReviewThread {
  id: string;           // GraphQL node ID (opaque)
  path: string;         // File path in the PR
  line: number;         // Line number on the RIGHT side
  side: "RIGHT";        // Always RIGHT — left-side comments excluded
  isResolved: boolean;
  rootComment: GitHubReviewComment;
  replies: GitHubReviewComment[];
  diffHunk?: string;    // Raw diff hunk for context extraction
  quotedLine?: string;  // The specific line being commented on
}
```

### 3.2 GitHubReviewComment

```typescript
interface GitHubReviewComment {
  id: number;           // GitHub database ID
  body: string;
  path: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  diffHunk?: string;
  inReplyToId?: number; // Set for replies; absent on root comments
  createdAt: string;
  updatedAt: string;
  user: string;
  htmlUrl: string;
}
```

### 3.3 CommentMapping

```typescript
interface CommentMapping {
  ghThreadId: string;    // GitHub thread node ID
  gdocCommentId: string; // Google Drive comment ID
  source: "github";      // Always "github" — prevents re-sync loops
  resolvedAt?: string;   // ISO timestamp if resolved
}
```

---

## 4. API Design

### 4.1 SyncAdapter Interface

```typescript
interface SyncAdapter {
  fetchThreads(pr: PRRef): Promise<GitHubReviewThread[]>;
  fetchDocComments(docId: string): Promise<GoogleDocComment[]>;
  postDocComment(docId: string, body: string, quotedText?: string): Promise<string>;
  resolveDocComment(docId: string, commentId: string): Promise<void>;
  deleteDocComment(docId: string, commentId: string): Promise<void>;
}
```

### 4.2 Reconciler Logic

The reconciler runs a three-way diff:

1. **New GitHub threads** (no mapping) → create GDoc comment
2. **Resolved GitHub threads** with active GDoc comment → resolve GDoc comment
3. **Deleted GitHub threads** (mapping exists, thread gone) → delete GDoc comment
4. **Updated GitHub threads** → update GDoc comment body

### 4.3 Rate Limiting Strategy

- Drive API: 300 requests/minute per user (sufficient for most PRs)
- GitHub GraphQL: 5000 points/hour (each thread query ≈ 1 point)
- Backoff: exponential with jitter on 429/403 responses

---

## 5. Implementation Notes

### 5.1 Pagination

Both APIs paginate. The sync loop must handle:

- GitHub GraphQL: `pageInfo.hasNextPage` + `endCursor` cursor
- Drive API: `nextPageToken` in response body

Both are handled in `fetchReviewThreads` and `fetchGDocComments` respectively.

### 5.2 Idempotency

The sync loop may run multiple times for the same PR state. Idempotency is guaranteed by:

1. Checking `CommentMapping` before creating — if mapping exists, skip creation
2. Using `source: "github"` flag to ignore GDoc comments not created by dorv
3. PR-level locking via `chrome.storage.local` to prevent concurrent syncs

### 5.3 Error Isolation

One PR's sync failure must not abort other PRs. Each PR sync is wrapped in try/catch.
Errors are logged to Sentry with the PR number as context.

### 5.4 Token Storage

Tokens are stored in `chrome.storage.local` (not session storage), encrypted at rest
by Chrome's profile-level encryption. The extension never sends tokens to a backend.

---

## 6. Testing Plan

### 6.1 Unit Tests (Vitest)

| Test file | Coverage target |
|-----------|-----------------|
| `fetch.test.ts` | GitHub API normalization |
| `gdoc-fetch.test.ts` | Drive API pagination |
| `reconciler.test.ts` | Three-way diff logic |
| `storage.test.ts` | Mapping CRUD operations |

### 6.2 Integration Tests

Run against real APIs in CI using a test PAT and dedicated test GDoc.

```bash
GITHUB_TOKEN=<test-pat> GDOC_ID=<test-doc> pnpm test:integration
```

### 6.3 Load Tests

This PR is itself a load test fixture. The extension should handle:

- 100+ review threads without UI lag
- Pagination across multiple GraphQL pages
- Mixed resolved/unresolved state

---

## 7. Migration Guide

### From v0.0.x (no storage schema)

No migration needed — storage is empty on first install.

### Adding `source` field to existing mappings

A one-time migration runs on extension update if mappings lack the `source` field:

```typescript
if (!mapping.source) {
  mapping.source = "github";
  await storage.set(mapping);
}
```

---

## 8. Open Questions

1. Should resolved GDoc comments be deleted or left as-is?
2. How do we handle GDoc comments that are manually created by users (not dorv)?
3. What's the UX when a PR is closed mid-sync?
4. Should we diff comment body content and update GDoc if GitHub comment is edited?

---

## 9. Appendix

### A. GraphQL Query Reference

See `lib/github/fetch.ts` → `REVIEW_THREADS_QUERY`.

### B. Drive API Reference

See `lib/gdoc/fetch.ts` → `fetchGDocComments`.

### C. Relevant Linear Issues

- HUM-1193: DirectAdapter sync core
- HUM-1195: GDoc comment creation
- HUM-1196: Comment reconciler
- HUM-1305: PR-level locking

---

*End of document.*
