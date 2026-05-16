# Design: Fix fetch Illegal invocation in GitHub sidebar

## Problem
The Chrome extension crashes with `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` when rendering the GitHub sidebar. This happens because `window.fetch` is passed to `fetchPullRequestFiles` as a property of an object and then called without being bound to `window`.

## Root Cause
`window.fetch` requires the `this` context to be `window`. When passed as `{ fetch }` and called as `options.fetch()`, `this` is `options`, not `window`.

## Proposed Solution
Bind `fetch` to `window` when passing it from the content script.

### Changes
1.  In `apps/extension/entrypoints/github-sidebar.content.tsx`:
    Change `fetchPullRequestFiles(ref, { fetch })` to `fetchPullRequestFiles(ref, { fetch: fetch.bind(window) })`.

2.  (Optional but recommended) In `apps/extension/lib/github/pr-files.ts`:
    Add a comment to `GitHubFileClientOptions` documenting that `fetch` should be bound if using `window.fetch`.

## Verification Plan
1.  **Manual Verification:** Build the extension and verify that the GitHub sidebar renders without the console error.
2.  **Automated Verification:** Add a test case to `tests/pr-sidebar.test.ts` (or similar) that mocks `fetch` and ensures it's called correctly. Note that in Vitest/Node, `fetch` might not have the same `this` requirement, so we might need to simulate it.
