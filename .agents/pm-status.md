# PM status — v0.3.0 swarm

Snapshot taken 2026-07-04, by PM session (herdr pane `w1:p7`). Source of truth for task state is Linear (project `dorv`); this file is a coordination log, not a duplicate tracker.

## Swarm roster (herdr workspace `w1`)

| Pane | Agent | Role (self-declared) | Status |
| --- | --- | --- | --- |
| `w1:p2` | pi | main-worker | **Dead** — session ended after pushing `cedc6f7`. Confirmed unresponsive (tested by p4). Do not route tasks here; a fresh agent is needed for further work. |
| `w1:p3` | claude | QA | Alive, idle. Found the P0 Create Doc bug live (`fetchPrInfoViaBackground` given wrong ref shape) and the broken `dev:loop` `--filter` flag. Asked (2026-07-04) to re-verify both fixes end-to-end post-`cedc6f7`. |
| `w1:p4` | pi (opencode-go) | gatekeeper | Declared `goal_complete` — reviewed the full v0.3.0 cycle (architecture, 6+ issues flagged, 174/174 tests, 65-case QA plan). Its own goal loop has ended; treat as finished, don't re-task without a fresh `/goal`. |
| `w1:p5` | claude | watcher | **Alive, running its own active `/goal` (11h)** watching main-worker. Not under this PM's direction — do not commandeer; it has its own mandate. |
| `w1:p7` | claude (this session) | PM | Active. |

## State of the work

- PR [#78](https://github.com/ahnpolished/dorv/pull/78) — CI green (`checks` passed), `e2e` in progress as of this snapshot. Mergeable.
- Local worktree HEAD: `cedc6f7` (P0 Create Doc fix + dev-loop `--filter` fix), on top of `8712b6c` (dev:loop script) and the rest of the v0.3.0 commit chain.
- One uncommitted local diff in `apps/extension/scripts/dev-loop.mjs` (removes unused Chrome log file handle, `.unref()`s the spawned process) — left as-is, unclear which agent is mid-edit; not touched by PM.
- Linear: of 77 issues under project `dorv`, 76 are Done. The one exception is **HUM-1264 "Control PR review"** (Backlog, v0.3.0 milestone, unassigned to any agent) — batch-push review comments + one-click re-request-review/approve. This is the only genuinely open v0.3.0 scope item.

## Open decision (asked user 2026-07-04)

With v0.3.0 otherwise complete, "work on v0.3.0" forks three ways:
1. Drive HUM-1264 to done (dispatch a fresh agent, new worktree `feature/hum-1264`).
2. Shepherd PR #78 to merge (watch CI, handle review, merge).
3. Treat v0.3.0 as wrapped and seed v0.3.1 (GDoc→GH resolution sync, Mermaid in comments, refresh doc content workflow per `AGENTS.md`).

These aren't mutually exclusive but change what gets dispatched first. See `.agents/pm-playbook.md` for the standing process this PM role follows.
