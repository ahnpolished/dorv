# Changelog

All notable changes to dorv are documented here.

## [0.3.1] — 2026-07-14

Release pipeline fixes: Chrome Web Store publishing and Google sign-in were both broken after the Google Cloud OAuth client was migrated from "Chrome Extension" to "Web application" type.

### Fixed

- **Google sign-in "bad client id"** — `chrome.identity.getAuthToken` only accepts a "Chrome App"-type OAuth client; switched entirely to `chrome.identity.launchWebAuthFlow`, which works with the current "Web application" client type in both real Chrome and Chromium forks (Arc, Brave, Edge)
- **Chrome Web Store upload rejected (`PKG_MANIFEST_KEY_NOT_MATCH`)** — CI builds no longer bake a `key` into `manifest.json`; Chrome Web Store keeps its own registered key for the published item, so shipping our dev key clobbered it on every upload
- **Release workflow error visibility** — upload/publish steps to the Chrome Web Store API now print the response body on failure instead of swallowing it behind `curl -fsS`, so future rejections are diagnosable straight from the Actions log

## [0.3.0] — 2026-07-12

DirectAdapter-only architecture: no side panel (native-UI buttons instead), no background alarm (user-triggered sync), multi-doc PRs, exact-once sync.

### Added

- **Per-file button injection** — `FileButton` component replaces the side panel; buttons anchor to each PR file's `.file-header` via cascade selectors, injected through a `MutationObserver` (HUM-1416, HUM-1415, HUM-1412)
- **Icon-based push button** — Primer-style dorv-branded button with shared outline + logo, retry affordance, and stale badge in the GDoc comment header (HUM-1416)
- **Google auth profile display** — name/email/avatar shown on the options page; adds `identity.email` + `profile`/`email` OAuth scopes
- **Per-file Google Doc revision history** — `listGoogleDocRevisions` read API surfaces version history per file (HUM-1417)
- **Edit-in-place bot comment** — bot comment updates in place instead of re-posting on each doc creation (HUM-1417-pi)
- **Multi-doc PRs** — `docStore.upsert` merges into `docs[]` instead of overwriting, supporting multiple synced docs per PR (HUM-1412)
- **Background-routed GitHub calls** — content scripts route GitHub API calls through the background service worker instead of calling directly (HUM-1413, HUM-1411)
- **dev:loop** — one-command rebuild → reload → verify script for local iteration (HUM-1414)
- **Agent orchestration tooling** — `dorv-worker`/`dorv-reviewer`/`dorv-gatekeeper`/`dorv-conflict-resolver`/`dorv-e2e-fixer` subagent roles and `/dorv-dispatch` command for claim-based multi-agent development

### Fixed

- **P0: Create Doc broken** — wrong ref shape passed to `fetchPrInfoViaBackground` (HUM-1409)
- **Nested GDoc comment reply push** — replies to replies failed to push to GitHub (HUM-1415)
- **Button silent failure** — errors now propagate and display visibly instead of failing silently
- **OAuth setup warning** — cleared once `GOOGLE_CLIENT_ID` is a real, non-placeholder value (HUM-1410)
- **Google auth token not saving** — token persistence fixed after the auth-profile rework
- **Zero-width space in filenames** — `‎` stripped from both ends of injected filenames
- **React 19 `createRoot`** — no longer clears the `span.id` attribute on mount

## [0.2.0] — 2026-05-30

Stable bidirectional sync with thread lifecycle, Activities feed, real-credential E2E coverage, Sentry error tracking, and storage efficiency.

### Added

- **Thread-first sync** — review threads with root comments + replies sync bidirectionally between GitHub and Google Docs via GraphQL `reviewThreads` (HUM-1276, HUM-1277, HUM-1278)
- **Thread lifecycle** — resolution sync (GH→GDoc and GDoc→GH via Drive reply action), destructive whole-thread updates on edit (HUM-1278)
- **Activities feed** — replaces PR Info tab with real-time event feed of synced comments (GH→GDoc, GDoc→GH, push/fail events) (HUM-1279, HUM-1280)
- **Real-credential E2E tests** — 30+ Playwright tests running against live GitHub PRs and Google Docs, including multi-PR tests across 7 repos (HUM-1281, HUM-1287, HUM-1288, HUM-1289, HUM-1290, HUM-1291, HUM-1300)
- **Stale-PR detection** — amber warning banner when new commits land after doc creation; sidepanel shows old→new SHA (HUM-1290)
- **Sidepanel caching** — TanStack Query with persisted cache snapshot for fast tab switching (HUM-1257)
- **Existing GDoc pickup** — `createDoc` checks PR issue comments for existing GDoc link before creating a new one; supports new `<!-- dorv-doc-id=... -->` marker and legacy `**dorv**` format (HUM-1310)
- **Auto-pickup on sidepanel load** — sidepanel pre-scans issue comments for linked GDocs even when no local mapping exists (HUM-1331)
- **Sentry error collection** — throttled error reporting with surface-level tagging per extension surface (HUM-1265)
- **Mermaid diagram support** — fenced ```````mermaid` blocks rendered as `mermaid.ink` images in generated Google Docs (HUM-1267)
- **Sidepanel keyboard shortcut** — Alt+Shift+D toggles sidepanel open/close (HUM-1266)
- **Compatibility layer** — auto-open fallback for Arc/Edge without native `sidePanel` support; browser detection with warning banner (HUM-1251, HUM-1275, HUM-1259)
- **Comment anchors** — icon buttons in sidepanel link directly to original GH/GDoc comment locations (HUM-1273, HUM-1254)
- **Design tokens & typography** — CSS custom property system, DM Sans + Geist Mono fonts, animation keyframes for sync spinner and slide-in UX (HUM-1225, HUM-1226, HUM-1227, HUM-1228, HUM-1229, HUM-1230)

### Fixed

- **GH→GDoc thread sync** — GH review comments now correctly appear as anchored GDoc comments (HUM-1274)
- **Duplicate sync** — PR-level locking prevents concurrent syncs; mapping re-read guard in `pushGHThreadToDoc` prevents duplicate GDoc comments (HUM-1305, HUM-1309)
- **Message channel closed** — `sendResponse` wrapped in try-catch to prevent "A listener indicated an asynchronous response..." Sentry errors (HUM-1283)
- **GDoc→GH infinite loop** — GH threads whose root comment starts with `> From Google Docs --` are skipped in sync; sidepanel filter excludes round-tripped comments (HUM-1325)
- **Sidepanel display mismatch** — GH tab uses `fetchReviewThreads` GraphQL instead of REST for consistency with GH UI (HUM-1332)
- **Storage quota exceeded** — sidepanel cache snapshot truncated to 100 comments with 200-char body limit + 30-min TTL; background poll reduced from 1m to 2m; sidepanel auto-refresh reduced from 30s to 2m (HUM-1333)
- **Google OAuth ID token expiration** — handle token refresh errors gracefully with clear re-auth prompt (HUM-1260)
- **Sidepanel error on non-GH pages** — shows past docs list instead of error when URL is not a GH PR or GDoc (HUM-1231)
- **Release automation** — GitHub Actions workflow for Chrome Web Store + GitHub Release (HUM-1233)
- **README & docs** — comprehensive update for v0.2.0 features, flows, and milestone info (HUM-1262)

## [0.1.0] — 2026-05-16

First working release. DirectAdapter only — no backend required.

### Added

- **WXT scaffolding** — Chrome MV3 extension with React, WXT, pnpm monorepo, CI (HUM-1194, HUM-1205)
- **SyncAdapter interface + typed storage** — `DocMapping`, `CommentMapping`, `ReplyMapping`, `SyncStatus`; `chrome.storage.local` backed stores (HUM-1193)
- **Auth** — GitHub PAT via `chrome.storage.local`; Google OAuth via `chrome.identity`; options page with validate-and-save (HUM-1204)
- **PR markdown file detection** — filters `.md`/`.mdx`/`.markdown` files from the GitHub PR files API; hides sidebar on non-markdown PRs (HUM-1195)
- **PRSidebar** — GitHub content script injected into the PR sidebar via shadow DOM; states: loading, no-md-files, no-doc, linked, stale, error (HUM-1200)
- **GH → GDoc: doc creation** — fetches raw markdown, converts with `marked`, uploads as a Google Doc via Drive multipart upload; seeds PR metadata header; posts bot comment on PR with doc link (HUM-1196)
- **Background service worker** — `chrome.alarms` polling every 2 minutes; message bus for `CREATE_DOC`, `SYNC_NOW`, `GET_SYNC_STATUS`; stale detection on new pushes; per-PR error isolation (HUM-1202)
- **GH → GDoc: comment sync** — polls GitHub review comments, pushes unseen comments to Drive as doc comments, guards with `hasByGH` to prevent double-sync (HUM-1197)
- **DocSidebar** — Chrome side panel on `docs.google.com`; Comments tab grouped by file with push-to-GitHub button; PR Info tab (HUM-1201)
- **Enterprise packaging** — `chrome.storage.managed` fallback for `backend_url`; options page **Set by IT** badge; `.env.example`; distributable zip via `wxt zip`; load-unpacked + admin push guide in README (HUM-1203)

### Fixed

- `fetch` illegal invocation in GitHub sidebar content script (`window.fetch` binding) (HUM-1206)
