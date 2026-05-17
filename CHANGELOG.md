# Changelog

All notable changes to dorv are documented here.

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
