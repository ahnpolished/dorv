# Staff-eng direction — w1:pB (claude), 2026-07-05

I'm joining this workspace as staff engineer: architecture/sequencing calls and
code review, not another implementer. If you're about to start new work,
ping me first (`herdr pane run w1:pB "[from: <role>(<pane>)] <question>"`) —
cheaper to sync before you write code than to unwind after.

## What I found scanning the live panes just now

- **w1:p2** — mid-review-turned-fixer on PR #80 (HUM-1411) and PR #83
  (HUM-1412). Verdict already in: #83 approved (docStore.upsert fix correct,
  8/8 tests, minor `createdAt` nit). #80 blocked on two real defects — wrong
  base branch (forked from `feature/v0.3.0`, opened against `main`, sweeping
  in ~5 unrelated commits) and a regression test that mirrors
  `handleFetchPrInfo` instead of importing it, so it can't catch the
  regression it claims to guard. User just told it to rebase #80 onto
  `feature/v0.3.0` — let it finish, don't interrupt.
- **w1:p3** — was told "implement the 2.1 button fix" (Primer-style buttons +
  text labels for the Create/Open/Sync UX issue) and is likely starting now.
- **w1:pA** — **already implemented this.** Primer pill button styling,
  text labels (Create Doc/Open Doc/Sync), a new Retry button on error, the
  P1 skeleton dark-theme-on-light-shell fix, and the stale-PR badge — 32
  files/181 tests + typecheck green. This reads as a superset of what p3 was
  just asked to do.
- **w1:p5** — hit its session usage limit mid-watch (was flagging that
  main-worker on HUM-1413 iterates via push-and-wait-for-CI instead of local
  `pnpm` e2e reproduction — that critique is worth keeping even though the
  pane itself is stalled). Needs the user's own action to resume; not
  actionable by another agent.
- **w1:p7** — idle pi PM pane per the handoff doc
  (`.agents/handoffs/w1-p7-pm.md`), last seen debugging the HUM-1413 Chrome
  redirect fix directly.

## Direction

1. **Don't let p3 duplicate pA's work.** Before p3 writes any code, it
   should diff against pA's branch/worktree and either rebase onto it or
   stand down. I'm flagging this to both panes now.
2. **Sequencing stands as in the handoff**: HUM-1413 (CI unblock, critical
   path) → HUM-1411/#80 (now: fix base branch + replace the fake regression
   test with a real import of `handleFetchPrInfo`) → HUM-1412/#83 (ready to
   merge, user's call) → HUM-1409 regression test → HUM-1414 hardening →
   re-verify HUM-1410 sign-in gap.
3. **No agent closes a v0.3.0 Linear issue or merges PR #78** — that's
   reconfirmed from the handoff and still holds.
4. Bring implementation questions to me before starting a new thread of
   work; I'd rather spend two minutes now than untangle a duplicate PR later.
