# dorv

**Document review** — sync GitHub PR comments with Google Docs.

Chrome extension that bridges GitHub PR inline review and Google Docs comments for markdown-heavy PRs (RFCs, design docs, ADRs, READMEs). Reviewers work in Google Docs; authors merge in GitHub as usual.

| Resource | Link |
| --- | --- |
| Linear project | [dorv overview](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/overview) |
| PRD | [Product requirements](https://linear.app/humphreyahn/document/prd-product-requirements-78de50358785) |
| Architecture | [Architecture overview](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f) |
| Rollout | [Rollout plan](https://linear.app/humphreyahn/document/rollout-plan-bb3a252aa510) |

## Current milestone: v0.2.0

Stable bidirectional sync with real-credential E2E coverage. **DirectAdapter** only — no backend required.

### What's new in v0.2.0

- **Thread-first sync** — review threads with root comments + replies sync bidirectionally between GitHub and Google Docs
- **Thread lifecycle** — resolution sync (GH → GDoc and GDoc → GH), destructive whole-thread updates on edit
- **Activities feed** — replaces the old PR Info tab with a real-time event feed of synced comments (GH→GDoc, GDoc→GH, push/fail events)
- **Real-credential E2E tests** — 30+ Playwright tests running against live GitHub PRs and Google Docs
- **Stale-PR detection** — amber warning banner when new commits land after doc creation
- **Sidepanel caching** — TanStack Query with persisted cache for fast tab switching
- **Animations & design polish** — sync spinner, slide-in comments, dark mode, Google Sans for tab titles
- **Compatibility** — Auto-open fallback for Arc/Edge without native sidePanel support
- **Sentry error collection** — throttled error reporting with surface-level tagging
- **Existing GDoc pickup** — if a bot comment already links a GDoc, reuses it instead of creating a new one

See [docs/PRIORITIES.md](docs/PRIORITIES.md) for the Linear backlog, priorities, and suggested build order.

## Docs in this repo

| Doc | Purpose |
| --- | --- |
| [docs/PRIORITIES.md](docs/PRIORITIES.md) | Issue backlog, P0/P1 acceptance criteria, implementation order |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Condensed architecture (canonical detail lives in Linear) |
| [docs/GITHUB_AUTH.md](docs/GITHUB_AUTH.md) | GitHub PAT setup, org approval, and 403 troubleshooting |
| [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md) | Draft privacy policy for Chrome Web Store submission |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents (Codex, Cursor, Claude Code, …) |
| [docs/AGENT_COLLABORATION.md](docs/AGENT_COLLABORATION.md) | Claim issues, wait on dependencies, `.agents/claims.yaml` |
| [docs/LINEAR_DEPENDENCIES.md](docs/LINEAR_DEPENDENCIES.md) | Linear **Blocked by** relations + description format for agents |
| [.cursor/rules/](.cursor/rules/) | Cursor-specific rules (`.mdc`) |
| [CLAUDE.md](CLAUDE.md) | Pointer to AGENTS.md for Claude Code |

## Problem (summary)

GitHub diff review is a poor fit for long markdown. Teams often review in Google Docs, but feedback splits across GitHub and Drive with no reconciliation. dorv creates a linked Google Doc from PR markdown and keeps review comments in sync both ways.

## Core user flows

1. **Author** opens a PR with `.md` files → sidebar offers **Create Google Doc** → formatted doc + bot comment on PR.
2. **GH → GDoc** — GitHub review threads with replies appear in the doc within ~1 minute (alarm poll).
3. **Reviewer** opens the doc → side panel lists GH comments and GDoc comments; highlights text → pushes Drive comments to GitHub with line matching.
4. **Stale commits** — new pushes set `isStale`; sidebar warns (doc content is not auto-updated).
5. **Activities** — real-time feed shows every synced comment, push, and resolution event.

## Tech stack (planned)

- [WXT](https://wxt.dev/) + React
- GitHub REST API (PAT), Google Drive / Docs comments API (`chrome.identity`)
- `marked` for markdown → HTML on doc creation

## Local development

Prerequisites:

- Node.js 22+
- pnpm 10+
- `prek` for local git hooks (`uv tool install prek`, `brew install prek`, or another supported install path)

```bash
# Install dependencies
pnpm install

# Install git hooks
prek install

# Dev extension
pnpm dev

# Run all CI checks locally
pnpm run ci

# Individual checks
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm zip
```

Use `.env.example` as the placeholder reference for local extension credentials. Do not commit real PATs, OAuth client IDs, or backend URLs. For GitHub Organization repositories, follow [GitHub authentication](docs/GITHUB_AUTH.md) before testing the create-doc flow.

## Status

**v0.2.0** — stable, dogfooding on real PRs. Track feature work in [Linear (dorv)](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).
