# Design Spec: GH -> GDoc Comment Sync (HUM-1197)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1197](https://linear.app/humphreyahn/issue/HUM-1197/gh-gdoc-comment-sync-poll-and-push)

## 1. Goal
Periodically sync new top-level review comments from a GitHub PR into the linked Google Doc.

## 2. Architecture

### 2.1 Sync Loop (DirectAdapter.syncAll)
Triggered by background alarm or manual button:
1. Fetch all active PRs from `DocStore`.
2. For each PR:
   - Fetch all review comments from GitHub.
   - Filter for top-level comments (`inReplyToId` is null).
   - Check if comment already exists in `MappingStore`.
   - If new: call `pushGHCommentToDoc`.
   - Update `StatusStore` and `DocMapping.lastSyncedAt`.

### 2.2 Comment Transformation (DirectAdapter.pushGHCommentToDoc)
1. **Format:** Prepend author and file location to the body.
   - Example: `**@octocat** on README.md:42 -- This looks great! -- [View](url)`
2. **Push:** Call Google Drive API `POST /drive/v3/files/{docId}/comments`.
3. **Persist:** Save the mapping of `ghCommentId` to `docCommentId` in `MappingStore`.

## 3. Implementation Details

### 3.1 GitHub Fetch Helper
New module `lib/github/fetch.ts` to call `GET /repos/{owner}/{repo}/pulls/{num}/comments`.

### 3.2 Google Docs Comment Helper
New module `lib/gdoc/comments.ts` to call the Drive Comments API.

### 3.3 Loop Guard
Strictly use `mappingStore.hasByGH(id)` to prevent duplicate comments.

## 4. Error Handling
- Per-comment errors should be caught and logged but not stop the rest of the sync batch.
- Overall PR sync failure should be recorded in `StatusStore`.

## 5. Testing Plan
- **Filter Logic:** Unit test for identifying "new top-level comments" from a mixed GH comment payload.
- **Formatting:** Verify the string formatting of the GDoc comment body.
- **Mocked Sync:** Integration test for the end-to-side-panel flow using mocked GH and Google APIs.
