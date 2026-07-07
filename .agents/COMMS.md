# Agent-to-agent communication

Agents talk directly to each other, not just through the PM. The PM (Linear + `.agents/pm-status.md`) stays the source of truth for task state, but day-to-day coordination — "your fix touches my file," "can you verify X," "found something that affects your issue" — should happen peer-to-peer.

## Roster (herdr workspace `w1`)

Keep this current — refresh with `herdr pane list --workspace w1` when panes change.

| Pane | Role | Current issue |
| --- | --- | --- |
| `w1:p2` | main-worker | HUM-1410 (OAuth 400 fix) |
| `w1:p3` | QA | HUM-1409 (Create Doc verify), HUM-1412 (docStore.upsert fix) |
| `w1:p4` | gatekeeper | HUM-1411 (FETCH_PR_INFO verify + coverage) |
| `w1:p5` | watcher | independent `/goal`, not on this workstream |
| `w1:p7` | PM | control tower, Linear sync |

## How to message another agent

Same mechanism the PM uses — `herdr pane run` sends text + Enter to a pane:

```bash
herdr pane run <target-pane-id> "[from: <your-role>(<your-pane-id>)] <message>"
```

Example — QA (p3) telling main-worker (p2) about an overlapping file:

```bash
herdr pane run w1:p2 "[from: QA(w1:p3)] Heads up — I'm fixing docStore.upsert in apps/extension/lib/adapters/direct.ts for HUM-1412. If your HUM-1410 OAuth work touches the same file, let's sequence to avoid a merge conflict."
```

Always tag the sender (`[from: role(pane-id)]`) so the recipient knows who's talking and can reply to the right pane.

## When to go direct vs loop in the PM

**Go direct** when it's about the work itself:
- Your fix touches a file/module another agent is also editing.
- You found something that affects another agent's issue (like QA finding the `docStore` bug while verifying Create Doc — that should also ping whoever owns adjacent code).
- You need a quick answer only that agent knows (e.g., "did you already fix X in your worktree?").

**Loop in the PM** (`w1:p7`) when it's about scope or tracking:
- A new bug/finding that isn't tracked in Linear yet — PM files the issue.
- A blocker that changes acceptance criteria or priority.
- You're about to duplicate work already claimed by someone else (check `.agents/claims.yaml` first).
- Anything that changes whether PR #78 is mergeable.

## Durable log

Since separate worktrees/panes don't share scrollback, append a one-line entry to `.agents/comms.log` (repo root, not per-worktree) for anything another agent or a future PM session might need to reconstruct later — cross-worktree findings, decisions, handoffs. Not required for routine chatter.

```bash
echo "$(date -u +%FT%TZ) [QA→main-worker] flagged docStore.upsert overwrite bug, filed as HUM-1412" >> /Users/taeahn/devs/personal/2026/dorv/.agents/comms.log
```

## Norms

- Don't interrupt an agent mid tool-call sequence for non-urgent chatter — send it, they'll see it at their next natural pause (same way the PM's ack-checks land).
- One issue = one worktree = one branch, still applies (`docs/AGENT_COLLABORATION.md`). Talking directly about file overlap doesn't mean merging worktrees — it means sequencing or flagging the conflict early.
- Linear stays the source of truth for *what's done*. Peer chat is for *how you get there*.
