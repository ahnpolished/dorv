---
description: Check the dorv Linear project and open PRs for outstanding/stalled work and dispatch each actionable item to the narrowest-fit subagent role in the background, following the claim protocol. Never implements anything itself.
argument-hint: optional filter, e.g. "HUM-1417" or "urgent only"
---

# dorv dispatch

You are orchestrating, not implementing. You never edit product code, run `git commit`, or open/merge/close PRs yourself in this command — every actionable item gets handed to a subagent via the `Agent` tool.

## Steps

1. Read `docs/AGENT_COLLABORATION.md` and `.agents/claims.yaml` fresh — don't rely on memory of earlier reads, they go stale fast.

2. Query Linear for the dorv project's outstanding issues (`mcp__claude_ai_Linear__list_issues`, project = dorv v0.3.0 milestone, exclude Done/Cancelled/Duplicate). Apply `$ARGUMENTS` as a filter if given.

3. Also check open PRs (`gh pr list`) for state that needs attention independent of a fresh Linear issue: `CONFLICTING`/`DIRTY` PRs, PRs with failing checks, PRs that look ready but haven't been code-reviewed, e2e specs failing in CI.

4. Route each actionable item to the narrowest-fit role — five exist, matching the actual division of labor this project uses:
   - **dorv-worker** — a new/unclaimed Linear issue, not blocked, needs end-to-end implementation (claim → worktree → PR).
   - **dorv-conflict-resolver** — an already-open PR shows `CONFLICTING`/`DIRTY`. Don't send this to dorv-worker; it's not a fresh claim, it's unblocking an existing branch.
   - **dorv-gatekeeper** — a PR is otherwise ready (mergeable, checks passing) but hasn't had a code-quality review yet. Reviews the diff, not the ticket.
   - **dorv-e2e-fixer** — a spec under `tests/e2e/**` is failing because of a stale selector/fixture from a product UI change, not a real product bug.
   - **dorv-reviewer** — `.agents/claims.yaml` says `done` but Linear's live state or the linked PR contradicts it, or an issue's acceptance criteria need verifying before it's trusted as complete. Checks the ticket, not the diff.
   - Blocked on another issue that isn't done → skip, note why.
   - When an item could fit two roles (e.g. a PR is both conflicting *and* unreviewed), dispatch only the blocking one first (conflict-resolver before gatekeeper — no point reviewing a diff that's about to change during a rebase).

5. Dispatch via the `Agent` tool with the matching `subagent_type`, `run_in_background: true`. Each prompt must be self-contained and include:
   - The issue/PR ID, title, link, and full acceptance criteria (don't make the subagent re-fetch what you already have).
   - An explicit instruction to read `AGENTS.md` + `docs/AGENT_COLLABORATION.md` first (the agent definitions already say this, but restate the specific files).
   - An explicit prohibition on merging PRs / closing issues / marking Linear Done without the user's specific authorization for that exact action.

6. **Concurrency cap:** dispatch at most 3 subagents at a time in this pass. All dorv work shares one underlying account usage quota — flooding it with many simultaneous subagents front-loads a shared limit rather than adding real throughput (this happened once already with parallel herdr panes). If more than 3 items are actionable, dispatch the top 3 (prioritize by Linear priority/urgency, and prefer unblocking conflicts before starting fresh work) and note the rest as queued for the next dispatch pass.

7. Report a short summary: what was dispatched (item → subagent type → one-line task), what was skipped and why, what's queued.

## Do not

- Do not implement any fix yourself, even a trivial one-liner — dispatch it.
- Do not mark anything Done or merge/close anything yourself.
- Do not treat `.agents/claims.yaml` as ground truth over live Linear/GitHub state.

## Recurring use

Run this on a cadence with the existing `/loop` skill, e.g.: `/loop 10m /dorv-dispatch`
