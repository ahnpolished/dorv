# Agent collaboration

Multiple coding agents (Cursor, Codex, Claude Code, …) work on **dorv** in parallel. Use a shared claim protocol so nobody implements the same issue or starts blocked work.

**Canonical issue tracker:** [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).  
**Dependency order:** [PRIORITIES.md](PRIORITIES.md).  
**Machine-readable claims:** [`.agents/claims.yaml`](../.agents/claims.yaml).

## Before you write code

1. **Pick one issue** (or accept the one the user assigned).
2. **Resolve blockers** (in order):
   - Linear **`blockedBy`** on the issue (`get_issue` with `includeRelations: true`)
   - Description **`## Depends on`** section (`HUM-####` ids only)
   - [PRIORITIES.md](PRIORITIES.md) table — must match Linear; see [LINEAR_DEPENDENCIES.md](LINEAR_DEPENDENCIES.md)
3. **Check blockers are free:**
   - Read [`.agents/claims.yaml`](../.agents/claims.yaml) — any blocker with `status: in_progress` means **wait**.
   - Open each blocker in Linear and scan recent comments for an active `🤖 Agent claim` with `status: in_progress`.
4. If blocked → **do not implement** yet. Either exit and tell the user, or start a **background wait** (below, up to **6 hours**).
5. If clear → **claim** (below), **create a git worktree**, then implement in that worktree only.
6. When done → **open a PR** (below), then mark the claim `done`.

**Never implement on `main` in the primary checkout** while another agent may be working. One issue = one branch = one worktree.

## Git worktree (required)

Each agent works in an **isolated worktree** so parallel agents do not stomp the same working directory.

### Location and naming

| Item | Convention |
| --- | --- |
| Directory | `.worktrees/` at repo root (gitignored) |
| Branch | `feature/hum-####` (from Linear `gitBranchName`, e.g. `feature/hum-1193`) |
| Worktree path | `.worktrees/feature-hum-####` (replace `/` in branch with `-`) |

### Create worktree (after claim, before code)

From the **main repo root** (not inside another worktree):

```bash
# Example for HUM-1193
BRANCH=feature/hum-1193
WORKTREE=.worktrees/feature-hum-1193

# Ensure .worktrees/ is ignored (should already be in .gitignore)
git check-ignore -q .worktrees || { echo ".worktrees not ignored"; exit 1; }

# Create branch + worktree (use existing branch if resuming)
git worktree add "$WORKTREE" -b "$BRANCH" 2>/dev/null || git worktree add "$WORKTREE" "$BRANCH"

cd "$WORKTREE"
# Run install when package.json exists, e.g. npm install
```

- **All edits, commits, and tests** for that issue happen only under `$WORKTREE`.
- Do not switch the user's primary workspace branch for your feature work.
- One active worktree per agent per issue.

### Base branch

Target **`main`** for PRs. If the repo has no commits yet, coordinate with the user to establish `main` before the first worktree.

### Cleanup (after PR merged)

```bash
git worktree remove .worktrees/feature-hum-1193
git branch -d feature/hum-1193   # if merged
```

## Claiming an issue

Do **both** steps every time you start work.

### 1. Linear comment (required)

Post a comment on the issue (e.g. `HUM-1193`). Use this template — fill every field:

```markdown
🤖 Agent claim

| Field | Value |
| --- | --- |
| **Agent** | cursor \| codex \| claude-code \| other:<name> |
| **Status** | in_progress |
| **Depends on** | HUM-1194 (or none) |
| **Branch** | feature/hum-1193 |
| **Worktree** | .worktrees/feature-hum-1193 |
| **Session** | Optional one-line goal for this run |

Starting work in worktree. Other agents: do not pick this issue until status is `done` or `released`.
```

**Agents with Linear access:** use the issue comment API / MCP `save_comment` with `issueId: "HUM-1193"`.

### 2. Update `.agents/claims.yaml` (required)

Add or update your issue entry in the same commit series as your work (or immediately before coding if the user has not asked for a commit yet — still update the file locally so other agents reading the repo see it).

```yaml
HUM-1193:
  agent: cursor
  status: in_progress
  claimed_at: "2026-05-16T15:00:00Z"  # ISO-8601 UTC
  depends_on: [HUM-1194]
  branch: feature/hum-1193
  worktree: .worktrees/feature-hum-1193
```

Use lowercase agent ids: `cursor`, `codex`, `claude-code`, `other`.

## While working

- **One issue per agent session** when possible.
- Do not claim a second issue until the first is `done` or `released`.
- If you are blocked mid-session, set your claim to `blocked` in Linear + yaml and say what you need.
- Commit in the **worktree** on the feature branch; keep commits focused on the Linear issue.

## Finishing: open a PR (required)

When implementation is complete and tests/lint pass **in the worktree**:

1. **Push** the feature branch.
2. **Open a PR** to `main` (use `gh` if available).
3. **Update the Linear claim** with the PR URL.
4. **Update `.agents/claims.yaml`** (`pr:` field, then `done` when ready for review).

```bash
cd .worktrees/feature-hum-1193
git push -u origin HEAD

gh pr create --base main --title "HUM-1193: SyncAdapter interface + typed storage" --body "$(cat <<'EOF'
## Summary
- …

## Linear
Closes HUM-1193

## Test plan
- [ ] `npm test`
- [ ] `npm run lint`

EOF
)"
```

PR title format: `HUM-####: Short description`. Link the Linear issue in the body.

**Do not** mark the claim `done` until a PR exists (or the user explicitly says to skip PR). Review happens on the PR; merge is human or CI.

### Done (PR open + ready for review)

Linear comment:

```markdown
🤖 Agent claim

| Field | Value |
| --- | --- |
| **Agent** | cursor |
| **Status** | done |
| **PR** | https://github.com/.../pull/N |
| **Outcome** | Tests/lint pass; ready for review |
```

In `.agents/claims.yaml`:

```yaml
HUM-1193:
  status: done
  pr: https://github.com/.../pull/N
  completed_at: "2026-05-16T18:00:00Z"
```

Remove the entry after the PR is merged, or leave `done` until merge — be consistent across agents.

### Released (won't finish — another agent may take it)

```markdown
🤖 Agent claim

| Field | Value |
| --- | --- |
| **Agent** | cursor |
| **Status** | released |
| **Reason** | Why you're stepping off |
```

Remove the entry from `.agents/claims.yaml` or set `status: released`.

## Waiting on dependencies

| Blocker state | Your action |
| --- | --- |
| Blocker `in_progress` in yaml or Linear | **Wait** — hand off to user, or **background poll** (≤ 6 h) then auto-start |
| All blockers `done` (or no longer blocking) | **Proceed:** claim → worktree → implement → PR |
| Blocker `released` and issue still open | Treat as unclaimed; claim blocker yourself or keep polling |
| Two agents claimed same issue | Stop. Comment on Linear; user resolves. Newer claim yields. |
| Poll exceeded 6 h | Mark wait `expired`; notify user; do not auto-claim without confirmation |

### Background wait + poll (optional, max 6 hours)

When you are blocked but the user wants the issue handled **without babysitting**, spawn a **background agent** that polls until upstream work finishes, then continues the normal flow (claim → worktree → code → PR).

**Limits**

| Rule | Value |
| --- | --- |
| Max wall time | **6 hours** from `poll_started_at` |
| Default poll interval | **5 minutes** (adjust 3–15 min if needed; stay consistent) |
| Max polls | ~72 at 5 min intervals |
| Scope | Poll + unblock only — background agent must not implement the blocked issue until all `depends_on` are clear |

**When to use**

- User assigned issue **HUM-1196** but **HUM-1193** / **HUM-1204** / **HUM-1195** are still `in_progress`.
- User explicitly asks to wait and auto-continue, or agrees when you propose background wait.

**Do not use** if blockers are unknown, the user said “stop”, or an unblocked issue is available now (take that instead).

#### 1. Register the wait in `.agents/claims.yaml`

Add a `wait_queue` entry **before** spawning the background agent:

```yaml
wait_queue:
  HUM-1196:
    agent: codex
    status: waiting          # waiting | ready | expired | cancelled
    depends_on: [HUM-1193, HUM-1204, HUM-1195]
    poll_started_at: "2026-05-16T16:00:00Z"
    poll_until: "2026-05-16T22:00:00Z"   # poll_started_at + 6 hours
    poll_interval_minutes: 5
```

Post a Linear comment on **your** issue (the one you will implement):

```markdown
🤖 Agent wait

| Field | Value |
| --- | --- |
| **Agent** | codex |
| **Status** | waiting |
| **Blocked by** | HUM-1193, HUM-1204, HUM-1195 |
| **Poll until** | 2026-05-16T22:00:00Z (6h max) |
| **Interval** | 5 min |

Background poll started. Will claim + worktree + PR when all blockers are `done`.
```

#### 2. What “unblocked” means

Every id in `depends_on` must satisfy **at least one**:

- Absent from `claims` (never claimed), **or**
- `status: done` in `claims` (PR opened per protocol), **or**
- `status: released` **and** you confirm in Linear the issue is still open and safe to treat as unclaimed

Still blocked if **any** dependency has `status: in_progress` or `blocked`.

Optional: skim Linear for blocker `🤖 Agent claim` with `done` + PR link when yaml is stale.

#### 3. Background agent loop (pseudocode)

```
deadline = poll_until
while now < deadline:
  read .agents/claims.yaml
  if all depends_on are unblocked:
    set wait_queue[HUM-xxxx].status = ready
    post Linear "🤖 Agent wait" status=ready
    run normal flow: claim → worktree → implement → PR
    remove wait_queue entry
    return SUCCESS
  sleep poll_interval_minutes
set wait_queue status = expired
post Linear + notify user: blockers not done within 6h
return EXPIRED
```

The background agent **must not** create a worktree or write feature code until unblocked.

#### 4. Cursor: spawning the poller

Use the **Task** tool (`subagent_type: generalPurpose`) with a prompt that includes:

- Target issue id (e.g. `HUM-1196`)
- Full `depends_on` list
- Paths: `.agents/claims.yaml`, `docs/AGENT_COLLABORATION.md`
- `poll_until` ISO timestamp
- Instruction to sleep between polls (shell `sleep 300` or repeated scheduled checks)
- On success: execute claim + worktree + full implementation + PR in that subagent **or** return `READY` to the parent session to continue

Example prompt excerpt:

> Poll `/path/to/dorv/.agents/claims.yaml` every 5 minutes until `2026-05-16T22:00:00Z`. Blocked issue HUM-1196 depends on HUM-1193, HUM-1204, HUM-1195. When all are `done` or unclaimed, set `wait_queue.HUM-1196.status` to `ready`, post Linear wait comment, then run the full dorv agent flow (claim, worktree at `.worktrees/feature-hum-1196`, TDD, PR to main). If deadline passes, set `expired` and stop.

Tell the user you started a background wait and the expiry time.

#### 5. Codex / other agents

If no Task/background API exists:

- Document the wait in yaml + Linear (steps above).
- Poll in the **same session** only if the runtime supports long-running sleep without timeout.
- Otherwise: notify the user with `poll_until` and ask them to re-invoke the agent after blockers merge.

#### 6. After unblock

Same as a normal start:

1. `🤖 Agent claim` → `in_progress` on **HUM-xxxx**
2. Move entry from `wait_queue` into `claims` (remove from `wait_queue`)
3. `git worktree add` → implement → PR → `done`

#### 7. Cancellation

User says stop → set `wait_queue.*.status: cancelled`, Linear comment, end background task if possible.

**Dependency graph:** canonical table, mermaid diagram, and Linear setup checklist in [LINEAR_DEPENDENCIES.md](LINEAR_DEPENDENCIES.md). Summary also in [PRIORITIES.md](PRIORITIES.md).

If Linear `blockedBy` is empty but docs list dependencies, **stop** and fix Linear (or ask the user) before waiting or implementing.

## End-to-end flow (one agent, one issue)

```
blocked? → wait_queue + background poll (≤6h) → all depends_on done
         ↘ (or pick another issue / exit)
claim (Linear + yaml) → git worktree add → implement in worktree → test/lint
  → commit → push → gh pr create → claim done (PR URL in Linear + yaml)
```

## Example: blocked agent with background wait

1. User asks Codex to implement **HUM-1196** (depends on HUM-1193, HUM-1204, HUM-1195).
2. Codex reads yaml → HUM-1193 `in_progress` (cursor), others may also be active.
3. Codex adds `wait_queue.HUM-1196`, posts `🤖 Agent wait` on Linear, spawns background poller (6 h, 5 min interval).
4. Parent tells user: *Waiting on 1193/1204/1195; background poll until 22:00 UTC.*
5. At 17:40, all three blockers show `done` with PRs in yaml.
6. Background agent sets `ready`, claims HUM-1196, creates `.worktrees/feature-hum-1196`, implements, opens PR.
7. If 22:00 passes with HUM-1193 still `in_progress` → `expired`, user notified, no auto code.

## Example: immediate wait (no background)

1. User asks Codex to implement **HUM-1196** but does not want a long poll.
2. Codex replies: *Blocked on HUM-1193 (cursor, in progress). Re-invoke when 1193's PR is up, or assign HUM-1195 if unblocked.*
3. No `wait_queue` entry.

## Humans

Humans override agents. If a human assigns work out of order, follow the user but still post a claim comment so other agents see it.
