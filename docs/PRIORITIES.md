# Priorities & backlog

Source of truth for issue status: [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).

**Dependencies:** Every issue must have Linear **Blocked by** relations and a `## Depends on` section in the description. See [LINEAR_DEPENDENCIES.md](LINEAR_DEPENDENCIES.md) for the canonical graph and checklist.

## Shipped

### v0.2.0 — 2026-05-30

Stable bidirectional sync. All v0.1.0 issues + thread-first sync, Activities feed, real-credential E2E tests, Sentry error tracking, storage efficiency.

### v0.1.0 — 2026-05-16

First working release: DirectAdapter (PAT + `chrome.identity`), alarm polling, `chrome.storage.local`. No backend.

## v0.3.0 — Up next

| Issue | Title | Priority |
| --- | --- | --- |
| [HUM-1304](https://linear.app/humphreyahn/issue/HUM-1304) | Bi-directional resolution sync (GH ↔ GDoc) | P0 |
| [HUM-1306](https://linear.app/humphreyahn/issue/HUM-1306) | Mermaid support in comments | P1 |
| [HUM-1307](https://linear.app/humphreyahn/issue/HUM-1307) | Refresh doc content workflow for stale PRs | P1 |

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
