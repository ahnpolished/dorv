# AGENTS.md — dorv

Instructions for coding agents (Cursor, Codex, Claude Code, and others). Human-oriented overview: [README.md](README.md).

## Project summary

**dorv** is a Chrome extension (WXT + React) that syncs GitHub PR review comments with Google Docs for markdown-heavy PRs.

- **v0.1.0 scope:** `DirectAdapter` only — GitHub PAT + `chrome.identity`, 2-minute alarm polling, `chrome.storage.local`. No backend.
- **Do not build** BackendAdapter, webhooks, or Postgres unless explicitly assigned and `backend_url` flow is in scope.

## Read before coding

| Doc | Use when |
| --- | --- |
| [docs/PRIORITIES.md](docs/PRIORITIES.md) | Picking the next issue, build order, P0/P1 acceptance criteria |
| [docs/LINEAR_DEPENDENCIES.md](docs/LINEAR_DEPENDENCIES.md) | How to set **Blocked by** / `## Depends on` in Linear for agent wait logic |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Adapters, entrypoints, data model, sync direction |
| [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues) | Canonical issue descriptions and status |

**Suggested first implementation chain:** HUM-1194 → HUM-1193 → HUM-1204 → HUM-1195 → HUM-1200 → HUM-1196 → HUM-1202 → HUM-1197 → HUM-1201 → HUM-1198 → HUM-1199 → HUM-1203.

Close duplicate **HUM-1192** (same as HUM-1193) in Linear; implement only HUM-1193.

## Multi-agent collaboration (required)

Several agents may work on this repo at once. **Claim → worktree → code → PR.**

| Step | Action |
| --- | --- |
| 1 | Read [docs/AGENT_COLLABORATION.md](docs/AGENT_COLLABORATION.md) |
| 2 | Check [`.agents/claims.yaml`](.agents/claims.yaml) and Linear comments on **dependency** issues ([PRIORITIES.md](docs/PRIORITIES.md)) |
| 3 | If a dependency is `in_progress` → **wait** (tell user) or register **`wait_queue`** + background poll up to **6 h** ([details](docs/AGENT_COLLABORATION.md#background-wait--poll-optional-max-6-hours)) |
| 4 | Post a **`🤖 Agent claim`** comment on your Linear issue (`status: in_progress`) |
| 5 | Update `.agents/claims.yaml` (include `branch`, `worktree`) |
| 6 | Create git worktree under **`.worktrees/`** — implement only there ([details](docs/AGENT_COLLABORATION.md#git-worktree-required)) |
| 7 | When tests/lint pass → **push and open a PR** to `main`; put PR URL in Linear + yaml |
| 8 | Mark claim `done` (or `released` if abandoning) |

**Agent ids:** `cursor`, `codex`, `claude-code`, or `other:<name>`.  
**Worktrees:** `.worktrees/feature-hum-####` on branch `feature/hum-####` (gitignored).

## Engineering principles

1. **Simplicity over architectural beauty.** Prefer the smallest change that meets the issue acceptance criteria.
2. **TDD.** Write or update tests before implementation. CI must gate merges; aim for ~100% coverage on touched code.
3. **Monorepo.** Keep related packages in this repo. Each app/package gets its own `README.md`; root [README.md](README.md) links to them.
4. **SOLID** and **[12-Factor](https://12factor.net/)** where they apply (extension: config via options/managed storage, not baked-in secrets).
5. **prek** for pre-commit hooks — configure per package when the tree exists; do not skip hooks unless the user asks.
6. **Ahnpolished org bar:** enough polish to be great, no meaningless ceremony. UI should feel slick and no-fuss (GitHub Primer on GH surfaces; Google Sans / `#1a73e8` on Docs side panel per Linear specs).

## Scope and safety (agents)

- **One Linear issue per session** when possible. Do not implement out-of-order dependencies from [docs/PRIORITIES.md](docs/PRIORITIES.md). See [multi-agent collaboration](#multi-agent-collaboration-required) — never skip claim/wait rules.
- **Do not** sync non-markdown files, edit GDoc back to GitHub file content, auto-update doc body on new commits, or add a GitHub App in v0.1.0 (see PRD non-goals in Linear).
- **Do not** commit secrets (PATs, `GOOGLE_CLIENT_ID`, `.env` with real values). Use `.env.example` placeholders only.
- **Do not** implement features on `main` in the primary checkout — use a [worktree](docs/AGENT_COLLABORATION.md#git-worktree-required) per issue.
- **Finish with a PR** for agent-driven work (unless the user says otherwise). Commits live on the feature branch in the worktree.
- Assigning a Linear issue to an agent implies permission to create focused commits, push the issue branch, and open the PR at the end of the session.
- **Loop guards:** respect `CommentMapping.source` and `hasByGH` / `hasByDoc` — double-sync is a P0 failure mode.
- **Errors:** one PR’s sync failure must not abort other PRs in `active_prs`.

## Repository layout (target)

Monorepo shape will emerge with HUM-1194. Expect roughly:

- Extension app under a package directory (WXT: content scripts, background, side panel, options)
- `lib/adapters/` — `SyncAdapter`, `DirectAdapter`, `BackendAdapter` factory
- Shared types and storage helpers

When layout exists, follow existing paths; do not invent a second structure.

## Commands

```bash
# Install
pnpm install

# Run all CI checks locally
pnpm run ci

# Test
pnpm test

# Lint
pnpm lint

# Typecheck
pnpm typecheck

# Format check
pnpm format:check

# Install pre-commit hooks
prek install
```

The extension dev/build/zip commands land with the WXT package in HUM-1194.

**Definition of done for a change:**

1. Matches the assigned Linear issue description and relevant P0/P1 rows in [docs/PRIORITIES.md](docs/PRIORITIES.md).
2. Work completed in the issue’s **git worktree** on `feature/hum-####`.
3. Tests added/updated; full test suite passes in that worktree.
4. Lint/format passes (prek hooks if configured).
5. **PR opened** to `main` with Linear id in title; claim updated with PR link.
6. No unrelated refactors or drive-by docs unless requested.
7. User-facing setup steps reflected in the package or root README when behavior changes.

## Pull requests (required for agent work)

- Open a PR when the issue is ready for review — do not leave work only on a local branch.
- Do this by default at the end of each completed Linear issue session unless the user explicitly says to stop before PR creation.
- Title: `HUM-####: Short description` (e.g. `HUM-1194: WXT scaffolding`).
- Body: summary, Linear link, test plan checklist.
- Use `gh pr create` when available; push with `git push -u origin HEAD` from the worktree first.
- Run the same test/lint commands CI will run before opening the PR.

## Cursor-specific

Project rules live in [.cursor/rules/](.cursor/rules/) as `.mdc` files. They repeat critical constraints; this file is the full reference.

## Codex-specific

Codex discovers `AGENTS.md` from the repository root downward. Nested `AGENTS.override.md` files may be added under packages later for package-local overrides; root file always applies.

**Collaboration:** On claim, post the `🤖 Agent claim` comment on the Linear issue (if your environment has API access). Always update [`.agents/claims.yaml`](.agents/claims.yaml) so other agents see blockers without calling Linear.
