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
5. When an agent reports done: verify independently (re-read the diff / re-run the flow) before marking the Linear issue done. A subagent's self-report of success is not verification. **"Tests pass, no error shown" is not the same claim as "the real-world side effect happened"** — e.g. a Create Doc button that throws no error is not the same as a Google Doc actually appearing in Drive. Require evidence tied to the actual side effect (a URL, a screenshot, an artifact), not just an agent's narrated confidence.
6. Untracked findings don't count as fixed. If a bug was found and "fixed" only in a chat transcript with no Linear issue, it isn't closed — it's invisible, and it will resurface. File it in Linear before treating it as resolved either way.
6a. **PM closes CI-gated issues, not the implementing agent.** Observed twice on this repo (HUM-1410, then HUM-1413 by the same agent) — an agent marks an issue Done the instant it opens a PR, before CI has even reported. Repeating the reminder didn't stop the second occurrence. Structural fix: when an issue's AC requires a green CI run, the agent reports "PR opened, awaiting CI" and stops there; the PM independently checks `gh pr view --json statusCheckRollup` and only then moves the issue to Done. Don't rely on the agent's self-restraint for this category — verify and close it yourself.
6b. **Under a standing "don't update status until I do" instruction, "PM verified" still isn't "Done."** When the user has explicitly reserved final sign-off (e.g. `/goal ... do not update its status ... until I do`), the PM's job on a well-evidenced issue is to post the evidence as a comment and leave the Linear status untouched — not to flip it to Done on the user's behalf just because the evidence looks solid. "I collected convincing evidence" and "I am authorized to close this" are different claims; conflating them defeats the reason the user reserved sign-off in the first place. The platform's own permission layer may block this as a safety net, but don't rely on it catching every case — check the standing instruction before any status-changing write.
7. Update `.agents/claims.yaml` and `.agents/pm-status.md` when swarm state changes materially (new dispatch, dead session, blocker found) — not on every message.

## Handoff on Claude usage block

If a Claude-based agent (herdr pane running `claude`) reports being blocked by usage limits — **including the PM's own session (this pane, `w1:p7`)** — this is a standing instruction, apply it without asking:
1. Write a handoff note to `.agents/handoffs/<pane-id>-<issue-or-role>.md` — current state, what's been tried, remaining acceptance criteria, any uncommitted work location. If it's the PM handing off, the note must cover: the full open-issue table, the sequencing plan, the standing user instruction (don't update v0.3.0 status / don't merge PR #78 until the user does), the peer roster, and a pointer to `.agents/comms.log` and `retros.md`'s latest entry.
2. Close that Claude instance (`herdr pane run <pane> "/exit"` or equivalent, then confirm the pane is free).
3. Boot a `pi` agent in the same pane and hand it the note's content plus the relevant Linear issue link(s), so it can resume.
4. **Re-establish the goal on the replacement agent** — don't let the mandate lapse just because the process restarted. For a PM handoff specifically, the incoming `pi` agent needs the equivalent of `/goal repeat this cycle until v0.3.0 reaches 100% completeness... do not update its status or merge the PR until the user does` re-issued explicitly, not assumed from the handoff note alone. For a worker-agent handoff, re-issue its specific task + acceptance criteria the same way the original dispatch did.

Don't let a usage-blocked pane sit idle mid-task, and don't let a replacement agent operate without the same standing constraints the original had.

## Standing rules

- Don't route new work to a dead agent session. Verify liveness first (a message with no reply after a reasonable wait means dead, per the gatekeeper's method of testing p2).
- Don't commandeer an agent that's running its own independent `/goal` loop for a different mandate — note it as out-of-scope for this PM, don't send it tasks.
- Fresh work items get a fresh worktree per `docs/AGENT_COLLABORATION.md` — never route new scope onto a shared/already-loaded worktree an agent is mid-session in.
- Surface genuine forks in direction to the user rather than silently picking one — e.g. "finish this one open issue" vs "shepherd the PR" vs "start next milestone" are different calls only the user should make.
- Agents talk to each other directly, not just through the PM — see `.agents/COMMS.md`. When two agents' work touches adjacent files/modules, tell both and let them sequence it; don't insist on relaying every message yourself.
- Some agents (observed: p4, an opencode-go `pi` in a watcher/gatekeeper role) default to a blocking `herdr wait agent-status ... --timeout ...` loop whenever they don't have a concrete assigned task, rather than finding their own next useful action. Don't leave that kind of agent without a queued next task — when reassigning it off something or it finishes a task, give it the next concrete task in the same message, every time. Repeating "stop watching" doesn't fix this; only always having a task queued does.

## Idle-cycle retro (LLL) — required

Every time the PM goes idle (between dispatch/check-in cycles, or before scheduling the next wakeup), do a short self-reflection and append it to `.agents/retros.md`:

- **Liked** — what worked this cycle, worth repeating.
- **Learned** — what surprised you or corrected a wrong assumption (about the swarm, the tools, the codebase, or your own process).
- **Lacked** — what was missing that should have been in place already.
- **Action items** — concrete, specific changes to carry into the next cycle. Not aspirational ("be more careful") — actionable ("ping X before assuming Y").

At the start of the next cycle, read the previous entry's action items first and actually apply them before doing anything else. This is how the process in this file is supposed to evolve — through observed friction, not by guessing upfront what will go wrong.
