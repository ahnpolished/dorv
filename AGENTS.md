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
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Adapters, entrypoints, data model, sync direction |
| [Linear — dorv](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues) | Canonical issue descriptions and status |

**Suggested first implementation chain:** HUM-1194 → HUM-1193 → HUM-1204 → HUM-1195 → HUM-1200 → HUM-1196 → HUM-1202 → HUM-1197 → HUM-1201 → HUM-1198 → HUM-1199 → HUM-1203.

Close duplicate **HUM-1192** (same as HUM-1193) in Linear; implement only HUM-1193.

## Engineering principles

1. **Simplicity over architectural beauty.** Prefer the smallest change that meets the issue acceptance criteria.
2. **TDD.** Write or update tests before implementation. CI must gate merges; aim for ~100% coverage on touched code.
3. **Monorepo.** Keep related packages in this repo. Each app/package gets its own `README.md`; root [README.md](README.md) links to them.
4. **SOLID** and **[12-Factor](https://12factor.net/)** where they apply (extension: config via options/managed storage, not baked-in secrets).
5. **prek** for pre-commit hooks — configure per package when the tree exists; do not skip hooks unless the user asks.
6. **Ahnpolished org bar:** enough polish to be great, no meaningless ceremony. UI should feel slick and no-fuss (GitHub Primer on GH surfaces; Google Sans / `#1a73e8` on Docs side panel per Linear specs).

## Scope and safety (agents)

- **One Linear issue per session** when possible. Do not implement out-of-order dependencies from [docs/PRIORITIES.md](docs/PRIORITIES.md).
- **Do not** sync non-markdown files, edit GDoc back to GitHub file content, auto-update doc body on new commits, or add a GitHub App in v0.1.0 (see PRD non-goals in Linear).
- **Do not** commit secrets (PATs, `GOOGLE_CLIENT_ID`, `.env` with real values). Use `.env.example` placeholders only.
- **Do not** create git commits or open PRs unless the user explicitly asks.
- **Loop guards:** respect `CommentMapping.source` and `hasByGH` / `hasByDoc` — double-sync is a P0 failure mode.
- **Errors:** one PR’s sync failure must not abort other PRs in `active_prs`.

## Repository layout (target)

Monorepo shape will emerge with HUM-1194. Expect roughly:

- Extension app under a package directory (WXT: content scripts, background, side panel, options)
- `lib/adapters/` — `SyncAdapter`, `DirectAdapter`, `BackendAdapter` factory
- Shared types and storage helpers

When layout exists, follow existing paths; do not invent a second structure.

## Commands (update when scaffold lands)

Until `package.json` exists, skip inventing scripts. After HUM-1194, this section should list real commands, for example:

```bash
# Install (example — replace with actual package manager)
npm install

# Dev extension
npm run dev

# Test
npm test

# Lint
npm run lint

# Extension zip for distribution
npm run zip
```

**Definition of done for a change:**

1. Matches the assigned Linear issue description and relevant P0/P1 rows in [docs/PRIORITIES.md](docs/PRIORITIES.md).
2. Tests added/updated; full test suite passes locally.
3. Lint/format passes (prek hooks if configured).
4. No unrelated refactors or drive-by docs unless requested.
5. User-facing setup steps reflected in the package or root README when behavior changes.

## Pull requests (when user asks)

- Reference Linear ID in title or body (e.g. `HUM-1194: WXT scaffolding`).
- Keep PRs focused; link to issue.
- Run the same test/lint commands CI will run before claiming ready.

## Cursor-specific

Project rules live in [.cursor/rules/](.cursor/rules/) as `.mdc` files. They repeat critical constraints; this file is the full reference.

## Codex-specific

Codex discovers `AGENTS.md` from the repository root downward. Nested `AGENTS.override.md` files may be added under packages later for package-local overrides; root file always applies.
