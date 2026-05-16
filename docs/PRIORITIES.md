# Priorities & backlog

Source of truth for issue status: [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).

**Dependencies:** Every issue must have Linear **Blocked by** relations and a `## Depends on` section in the description. See [LINEAR_DEPENDENCIES.md](LINEAR_DEPENDENCIES.md) for the canonical graph and checklist.

All v0.1.0 issues are in milestone **v0.1.0** (DirectAdapter, no backend). Linear priority: **Urgent** = P0 path, **High** = P1 / supporting work.

## v0.1.0 acceptance criteria (from PRD)

| # | Criterion | PRD priority |
| --- | --- | --- |
| 1 | Extension installs; permissions OK without security review | P0 |
| 2 | Panel hidden on non-MD PRs; file list on MD PRs | P0 |
| 3 | Google Doc created with formatted markdown + PR metadata + `headSha` | P0 |
| 4 | Bot comment on PR with doc link | P0 |
| 5 | GH review comments in GDoc within 2 minutes | P0 |
| 6 | Doc comments pushed to GH on correct file + line | P0 |
| 7 | Reply sync bidirectional, no duplicates | P1 |
| 8 | Stale warning within 2 min of new push | P1 |
| 9 | Options: PAT, Google auth, backend URL toggle | P0 |
| 10 | Enterprise: force-install + managed storage | P1 |

## Linear issues by priority

### Urgent (build the core loop first)

| Issue | Title | Depends on |
| --- | --- | --- |
| [HUM-1194](https://linear.app/humphreyahn/issue/HUM-1194) | WXT scaffolding + manifest | — |
| [HUM-1193](https://linear.app/humphreyahn/issue/HUM-1193) | SyncAdapter interface + typed storage | HUM-1194 |
| [HUM-1196](https://linear.app/humphreyahn/issue/HUM-1196) | GH → GDoc: markdown → Google Doc creation | HUM-1193, HUM-1204, HUM-1195 |
| [HUM-1197](https://linear.app/humphreyahn/issue/HUM-1197) | GH → GDoc: comment sync (poll + push) | HUM-1196, HUM-1202 |

### High (UI, auth, reverse sync, ship)

| Issue | Title | Depends on |
| --- | --- | --- |
| [HUM-1195](https://linear.app/humphreyahn/issue/HUM-1195) | PR markdown file detection | HUM-1194 |
| [HUM-1204](https://linear.app/humphreyahn/issue/HUM-1204) | Auth: GitHub PAT + Google OAuth | HUM-1194 |
| [HUM-1200](https://linear.app/humphreyahn/issue/HUM-1200) | PRSidebar (GitHub content script) | HUM-1193, HUM-1195 |
| [HUM-1201](https://linear.app/humphreyahn/issue/HUM-1201) | DocSidebar (Chrome side panel) | HUM-1197 |
| [HUM-1202](https://linear.app/humphreyahn/issue/HUM-1202) | Background: alarms + message bus | HUM-1193, HUM-1196 |
| [HUM-1198](https://linear.app/humphreyahn/issue/HUM-1198) | GDoc → GH: comment push + line match | HUM-1193, HUM-1201 |
| [HUM-1199](https://linear.app/humphreyahn/issue/HUM-1199) | Reply sync bidirectional | HUM-1197, HUM-1198 |
| [HUM-1203](https://linear.app/humphreyahn/issue/HUM-1203) | Enterprise packaging + distribution | HUM-1194, HUM-1197 |

> **Duplicate:** [HUM-1192](https://linear.app/humphreyahn/issue/HUM-1192) duplicates HUM-1193 — **Canceled in Linear**.

## Suggested implementation order

Order respects dependencies; parallelize where noted.

```
1.  HUM-1194  WXT + manifest
2.  HUM-1193  SyncAdapter + storage (+ DirectAdapter stub)
3.  HUM-1204  Auth (PAT + chrome.identity)
4.  HUM-1195  MD file detection
5.  HUM-1200  PRSidebar (shell + states)
6.  HUM-1196  Create Google Doc from PR markdown
7.  HUM-1202  Background worker + message bus
8.  HUM-1197  GH → GDoc comment sync
9.  HUM-1201  DocSidebar
10. HUM-1198  GDoc → GH push
11. HUM-1199  Reply sync
12. HUM-1203  Enterprise + README/CHANGELOG/zip
```

**Critical path for first demo:** 1194 → 1193 → 1204 → 1195 → 1196 → 1202 → 1197.

**Critical path for reviewer push:** add 1201 + 1198 after doc exists.

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
