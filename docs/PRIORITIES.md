# Priorities & backlog

Source of truth for issue status: [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).

**Dependencies:** Every issue must have Linear **Blocked by** relations and a `## Depends on` section in the description. See [LINEAR_DEPENDENCIES.md](LINEAR_DEPENDENCIES.md) for the canonical graph and checklist.

## Shipped

### v0.3.0 — rewrite (this branch)

v0.2.0 users churned over two P0s: a flickering/non-opening GitHub sidebar, and an incident where one PR synced 1000+ duplicate comments to GitHub. v0.3.0 is a from-scratch rewrite of the UI and sync orchestration (low-level GitHub/GDoc API integration code was salvaged):

- Removed the side panel entirely. Replaced with buttons injected directly into native GitHub PR UI (`github-buttons.content`) and native Google Docs comment cards (`gdoc-buttons.content`).
- Removed the 1-minute background alarm. Sync is now exclusively user-triggered (button click → `SYNC_PR`/`CREATE_DOC`/`PUSH_DOC_COMMENT_TO_GH` messages).
- Fixed the double-sync P0: dedup now anchors on remote Drive/GitHub content (list-before-push), not on a local storage write succeeding — the actual root cause of the 1000-duplicate incident (`chrome.storage.local` quota-exceeded silently broke the old local-only guard).
- `DocMapping` changed from a single doc per PR to a set of docs (`docs: DocFileMapping[]`, one per markdown file) — the Google Docs API cannot create tabs programmatically, ruling out the originally-considered "one doc, tabs per file" design.
- Deferred out of this rewrite (see below): bi-directional resolution sync, Mermaid support, refresh-doc-content workflow.

### v0.2.0 — 2026-05-30

Stable bidirectional sync. All v0.1.0 issues + thread-first sync, Activities feed, real-credential E2E tests, Sentry error tracking, storage efficiency.

### v0.1.0 — 2026-05-16

First working release: DirectAdapter (PAT + `chrome.identity`), alarm polling, `chrome.storage.local`. No backend.

## v0.3.1 — Up next

Deferred from v0.3.0 to keep that rewrite scoped to stability + the new UI model:

| Issue | Title | Priority | Why deferred |
| --- | --- | --- | --- |
| [HUM-1304](https://linear.app/humphreyahn/issue/HUM-1304) | Bi-directional resolution sync (GH ↔ GDoc) | P0 | The old GH→GDoc resolve logic (`syncGHThreadLifecycle`) was embedded in the alarm-driven orchestration that v0.3.0 dismantled; doc-side resolve detection has no existing implementation to salvage and needs its own dedup-safe design under the new user-triggered model — not a small addition on top of the P0 sync-storm fix. |
| [HUM-1306](https://linear.app/humphreyahn/issue/HUM-1306) | Mermaid support in comments | P1 | Out of scope for a stability-focused rewrite; markdown→doc rendering already handles Mermaid in doc *bodies* (`gdoc/markdown.ts`), this issue is specifically about Mermaid inside synced *comments*. |
| [HUM-1307](https://linear.app/humphreyahn/issue/HUM-1307) | Refresh doc content workflow for stale PRs | P1 | Independent of the sync/UI rewrite; still gated on the same "no automatic doc rewrite, would orphan Drive anchors" constraint as before. |

## Rollout phases (summary)

| Phase | When | Audience | Install |
| --- | --- | --- | --- |
| 0 | Week 1–2 | Builders (2–3) | Load unpacked |
| 1 | Week 3–4 | Team (5–10) | Chrome Web Store unlisted + PAT |
| 2 | Week 5–6 | Enterprise IT | Force-install + managed `backend_url` |
| 3 | TBD | — | GitHub App + webhooks (post security approval) |

Full detail: [Rollout plan (Linear)](https://linear.app/humphreyahn/document/rollout-plan-bb3a252aa510).

## Dogfood success metrics

- ≥ 3 real markdown PRs reviewed with dorv
- Zero double-sync bugs
- Sync latency &lt; 2 min for 95% of comments
- No auth failures after initial setup
