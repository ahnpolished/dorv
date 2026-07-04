# PM playbook — dorv agent swarm

How the PM role operates when directing multiple agents on this repo. Evolve this file when process actually changes; don't let it drift into aspiration.

## Source of truth

- **Task state**: Linear project `dorv`. Every dispatched task needs a Linear issue with a clear acceptance criteria before an agent starts. Don't dispatch off a verbal task alone.
- **Claim state**: `.agents/claims.yaml` (protocol in `docs/AGENT_COLLABORATION.md`). One issue = one worktree = one branch = one PR.
- **Live swarm state**: `herdr pane list --workspace <id>` + `herdr pane read <pane> --source recent`. Check `agent_status` (`idle`/`working`/`blocked`/`done`) before assuming a pane is available — `done` can mean either "finished a goal loop, still alive" or "process actually dead" (test with `pane run` + a short wait; if no response, treat as dead).

## Dispatch loop

1. Read the target Linear issue (or create one with a clear acceptance criteria if none exists).
2. Check `.agents/claims.yaml` and Linear comments on **blocking** issues — never assign onto an in-progress dependency.
3. Message the agent with the task **and ask for explicit ack before it starts** (per user directive: always get agent approval). Don't fire-and-forget.
4. Expect back-and-forth, not a one-shot instruction. If an agent reports ambiguity or a blocker, resolve it before it proceeds — don't let it guess silently.
5. When an agent reports done: verify independently (re-read the diff / re-run the flow) before marking the Linear issue done. A subagent's self-report of success is not verification.
6. Update `.agents/claims.yaml` and `.agents/pm-status.md` when swarm state changes materially (new dispatch, dead session, blocker found) — not on every message.

## Standing rules

- Don't route new work to a dead agent session. Verify liveness first (a message with no reply after a reasonable wait means dead, per the gatekeeper's method of testing p2).
- Don't commandeer an agent that's running its own independent `/goal` loop for a different mandate — note it as out-of-scope for this PM, don't send it tasks.
- Fresh work items get a fresh worktree per `docs/AGENT_COLLABORATION.md` — never route new scope onto a shared/already-loaded worktree an agent is mid-session in.
- Surface genuine forks in direction to the user rather than silently picking one — e.g. "finish this one open issue" vs "shepherd the PR" vs "start next milestone" are different calls only the user should make.
