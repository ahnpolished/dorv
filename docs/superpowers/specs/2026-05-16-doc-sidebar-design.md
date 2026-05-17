# Design Spec: DocSidebar — Chrome Side Panel for Google Docs (HUM-1201)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1201](https://linear.app/humphreyahn/issue/HUM-1201/docsidebar-chrome-side-panel-for-google-docs)

## 1. Goal
Provide a unified interface for reviewers inside Google Docs to see GitHub PR metadata and a grouped list of synchronized comments.

## 2. Architecture

### 2.1 UI Component (`DocSidebar`)
- **Location:** `apps/extension/src/sidepanel.tsx`
- **Tabs:**
    1. **Comments:** A list of comments synced from GitHub, grouped by file path. Sections are collapsible.
    2. **PR Info:** Displays `repo`, `prNumber`, `branch`, and `lastSyncedAt`.
- **State Management:** 
    - Use `chrome.tabs.query` to get the current tab URL.
    - Parse `docId` from the URL.
    - Fetch mapping from `DocStore` (via message bus or direct storage access if in side panel).
    - If mapped, fetch comments and mappings via `adapter`.

### 2.2 Adapter Enhancements (`DirectAdapter`)
- **`getGHComments(ref)`**: Fetch all review comments for the PR using the GitHub token.
- **`getCommentMappings(ref)`**: Retrieve all existing sync mappings for the PR.
- **`getDoc(ref)`**: (Existing) Retrieve the GDoc metadata.

## 3. Detailed Components

### 3.1 Sidebar Logic
1. **Detection:** On mount/tab-update, extract `docId` from `https://docs.google.com/document/d/{docId}/...`.
2. **Lookup:** Search `DocStore` for any entry where `mapping.docId === docId`.
3. **Display:** If not found, show "This document is not linked to a GitHub PR." If found, load data.

### 3.2 UI Design
- **Header:** "dorv" eyebrow + "Review Sync" title.
- **Comment Card:**
    - Avatar (placeholder or text initials).
    - Author name.
    - Path and line number (e.g., `README.md:12`).
    - Body text.
    - "View on GitHub" link.

### 3.3 Messaging
The Side Panel runs in the extension process (like Options), so it can call `chrome.storage` and `lib/` modules directly. No need for message bus overhead unless background-only logic is required.

## 4. Error Handling
- **No Auth:** Redirect or show a message to configure PAT in Options.
- **No Mapping:** Clear instructions on how to link a PR from the GitHub side.

## 5. Testing Plan
- **URL Parsing:** Unit tests for extracting `docId` from various Google Doc URL formats.
- **Grouping Logic:** Test helper function that groups flat comment lists by file path.
- **UI Mocking:** Test the `DocSidebar` component with mock mappings and comments.
