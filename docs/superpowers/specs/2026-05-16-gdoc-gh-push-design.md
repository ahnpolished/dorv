# Design Spec: GDoc -> GH Comment Push (HUM-1198)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1198](https://linear.app/humphreyahn/issue/HUM-1198/gdoc-gh-comment-push-with-line-matching)

## 1. Goal
Allow reviewers to push comments made in a Google Doc back to the original GitHub PR, using text-matching to identify the correct file and line number.

## 2. Architecture

### 2.1 Component Flow
1. **Fetch:** `DirectAdapter.getDocComments(ref)` fetches all comments from the Google Doc.
2. **Match:** A line-matching engine compares `quotedFileContent` (from Google) against the raw PR file content (from GitHub).
3. **UI:** `DocSidebar` displays GDoc comments. If a match is found, it shows the predicted line number.
4. **Push:** `DirectAdapter.pushDocCommentToGH(comment, mapping)` posts a review comment to GitHub.
5. **Persist:** Save mapping to `MappingStore` to prevent duplicate pushes.

### 2.2 Line Matching Engine (`lib/gdoc/matching.ts`)
- **Inputs:** `quotedText` (string), `files` (array of `{ filename, content }`).
- **Logic:**
    - Perform a case-sensitive exact match search across all files.
    - Track the line number (1-indexed) where the match occurs.
    - If multiple matches exist, return all candidates (prioritize the first 3).

## 3. Implementation Details

### 3.1 Google Doc Comment Fetcher (`lib/gdoc/fetch.ts`)
- Calls `GET /drive/v3/files/{docId}/comments?fields=comments(id,content,quotedFileContent,author,createdTime)`.

### 3.2 GitHub Review Comment Push (`lib/github/comments.ts`)
- Enhances existing helper to support `POST /repos/{owner}/{repo}/pulls/{num}/comments`.
- **Required Payload:** `body`, `commit_id` (PR head SHA), `path`, `line`, `side: "RIGHT"`.

### 3.3 Body Formatting
Format the GitHub comment to attribute the source:
`> From Google Docs -- @{gdoc_author} -- {gdoc_content}`

## 4. Error Handling
- **Ambiguous Match:** UI shows a warning: "Multiple matches found. Defaulting to first match."
- **No Match:** UI allows the user to still push the comment as a "general PR comment" (if `path/line` are omitted, though GitHub Review API usually requires them). *Decision: If no match, require manual path/line entry or disable push.*

## 5. Testing Plan
- **Matching Unit Tests:** Test the engine with various strings, including multi-line quotes and special characters.
- **Mocked GDoc Fetch:** Verify parsing of the Drive API comment structure.
- **Push Integration:** Verify the formatted body and required metadata are sent correctly to GitHub.
