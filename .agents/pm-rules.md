# PM Rules — this session

Written 2026-07-05 after a repeated pattern of PM acting as worker.

## Role boundary

| PM does | PM does NOT |
|---------|-------------|
| Read code to understand issues | Edit code to fix them |
| Diagnose root cause from logs/output | Implement fixes |
| Dispatch workers with clear tasks | Debug line-by-line in terminal |
| Verify worker output (tests, CI) | Write production code |
| Coordinate agents via herdr | Do the agents' jobs |

## Dispatch checklist

When a bug is found:
1. Read enough code to understand the root cause (max 5 min)
2. Write a clear task description with: files to touch, expected behavior, acceptance criteria
3. Dispatch a `worker` subagent or ping a herdr agent pane
4. Verify the result (tests pass, CI green) — don't rewrite the worker's code

## Error visibility rule (product principle)

**If an action fails, the user must see the error and the PM must see the error.** No silent failures. Every catch block must:
- Display error to user (text, not just tooltip emoji)
- Console.error for DevTools
- Sentry capture for telemetry

## Current priorities (from staff engineer)

1. Button no-op → dispatch worker to fix error visibility + trace failure
2. PR #80 → has fake regression test (staff-eng flagged)
3. PR #83 → ready to merge (user's call)
4. pA already did button UI → p3 must not duplicate

## Herdr agents

- w1:p2 (claude) — main-worker
- w1:p3 (claude) — QA
- w1:p4 (pi) — gatekeeper
- w1:p5 (claude) — watcher (blocked on usage limit)
- w1:p7 (pi) — PM (this session)
- w1:pA (claude) — designer (implemented button UI)
- w1:pB (claude) — staff engineer
