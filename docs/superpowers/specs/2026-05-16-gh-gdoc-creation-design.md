# Design Spec: GH -> GDoc Creation (HUM-1196)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1196](https://linear.app/humphreyahn/issue/HUM-1196/gh-gdoc-markdown-to-google-doc-creation)

## 1. Goal
Automatically create a Google Doc from markdown files in a GitHub PR and link them via a PR comment.

## 2. Architecture

### 2.1 Component Flow
1. **Source:** `DirectAdapter.createDoc(input)` triggered from `PRSidebar`.
2. **Transform:**
   - Fetch raw markdown from GitHub.
   - Use `marked` to convert MD -> HTML.
   - Prepend PR metadata (Title, Author, Branch, SHA, Link).
3. **Upload:**
   - Auth via `AuthStore.getGoogleToken(false)`.
   - Multipart POST to `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`.
   - Metadata: `{ name: "PR #[num] - [title]", mimeType: "application/vnd.google-apps.document" }`.
4. **Notify:** POST to `/repos/{owner}/{repo}/issues/{num}/comments` with the Doc URL.
5. **Persist:** Save `DocMapping` to `DocStore`.

## 3. Implementation Details

### 3.1 Dependencies
- `marked`: Standard markdown parser.

### 3.2 Document Template
The generated HTML will include:
- A header table with PR metadata.
- An `<hr/>` separator.
- Each file's content preceded by an `<h1>` with the filename.

### 3.3 Multi-part Upload Structure
```
--boundary
Content-Type: application/json; charset=UTF-8

{
  "name": "...",
  "mimeType": "application/vnd.google-apps.document"
}

--boundary
Content-Type: text/html

<html>...</html>
--boundary--
```

## 4. Error Handling
- **Partial Failures:** If one file fails to fetch, abort the entire process to prevent incomplete docs.
- **Drive API Errors:** Capture and surface 4xx/5xx errors to the `PRSidebar`.

## 5. Testing Plan
- **Template Unit Tests:** Verify HTML generation with various PR metadata.
- **Marked Integration:** Test rendering of standard markdown features (tables, code blocks).
- **Mocked Uploads:** Use `vi.stubGlobal('fetch', ...)` to simulate Drive API multipart responses.
