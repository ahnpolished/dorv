# dorv

**Document review** — sync GitHub PR comments with Google Docs.

Chrome extension that bridges GitHub PR inline review and Google Docs comments for markdown-heavy PRs (RFCs, design docs, ADRs, READMEs). Reviewers work in Google Docs; authors merge in GitHub as usual.

| Resource | Link |
| --- | --- |
| Linear project | [dorv overview](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/overview) |
| PRD | [Product requirements](https://linear.app/humphreyahn/document/prd-product-requirements-78de50358785) |
| Architecture | [Architecture overview](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f) |
| Rollout | [Rollout plan](https://linear.app/humphreyahn/document/rollout-plan-bb3a252aa510) |

## Current milestone: v0.3.0

Rewrite of the UI and sync orchestration after v0.2.0 dogfooding surfaced two P0s: a flickering/non-opening side panel, and an incident where a single PR synced 1000+ duplicate comments. **DirectAdapter** only — no backend required.

### What's new in v0.3.0

- **No more side panel** — buttons are injected directly into native GitHub PR UI and native Google Docs comment cards, so the user triggers each action explicitly instead of relying on an always-open panel.
- **No more background alarm** — sync is user-triggered only (button click), eliminating the periodic storage-write bursts that caused the old UI to flicker.
- **Exact-once sync, by design** — dedup now anchors on remote GitHub/Drive content (list-before-push) instead of a local storage write succeeding, fixing the root cause of the 1000-duplicate incident.
- **Multi-doc PRs** — a PR with several markdown files gets one Google Doc per file (`DocMapping.docs[]`), since the Google Docs API can't create tabs programmatically.
- **Existing GDoc pickup** — if a bot comment already links a doc set, reuses it instead of creating new ones.

Deferred to v0.3.1 to keep this rewrite scoped to stability + the new UI: bi-directional resolution sync, Mermaid support in comments, refresh-doc-content workflow. See [docs/PRIORITIES.md](docs/PRIORITIES.md).

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

1. **Author** opens a PR with `.md` files → a button injected into the PR page offers **Create linked doc(s)** → one formatted Google Doc per markdown file + a single bot comment linking all of them.
2. **GH → GDoc** — author or reviewer clicks **Sync new comments to doc** on the PR page; GitHub review threads with replies are pushed to the matching file's doc, deduped against that doc's existing comments.
3. **Reviewer** comments in the Google Doc → a **Push to GitHub** button appears on that comment card → click to push it as a GitHub review comment with line matching.
4. **Stale commits** — new pushes set `isStale`; the injected GitHub-side button shows an amber badge (doc content is not auto-updated).

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

**v0.3.0** — rewrite in progress, dogfooding on real PRs. Track feature work in [Linear (dorv)](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).
