# dorv

**Document review** — sync GitHub PR comments with Google Docs.

Chrome extension that bridges GitHub PR inline review and Google Docs comments for markdown-heavy PRs (RFCs, design docs, ADRs, READMEs). Reviewers work in Google Docs; authors merge in GitHub as usual.

| Resource | Link |
| --- | --- |
| Linear project | [dorv overview](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/overview) |
| PRD | [Product requirements](https://linear.app/humphreyahn/document/prd-product-requirements-78de50358785) |
| Architecture | [Architecture overview](https://linear.app/humphreyahn/document/architecture-overview-f7a18d7c265f) |
| Rollout | [Rollout plan](https://linear.app/humphreyahn/document/rollout-plan-bb3a252aa510) |

## Current milestone: v0.1.0

Weekend hack scope: working Chrome extension with **DirectAdapter** (GitHub PAT + `chrome.identity`). No backend. Team dogfoods on real markdown PRs.

- **Phase 1 adapter:** alarm polling every 2 min, `chrome.storage.local`
- **Phase 2 adapter (later):** set `backend_url` in options → BackendAdapter + webhooks (no reinstall)

See [docs/PRIORITIES.md](docs/PRIORITIES.md) for the Linear backlog, priorities, and suggested build order.

## Docs in this repo

| Doc | Purpose |
| --- | --- |
| [docs/PRIORITIES.md](docs/PRIORITIES.md) | Issue backlog, P0/P1 acceptance criteria, implementation order |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Condensed architecture (canonical detail lives in Linear) |
| [AGENTS.md](AGENTS.md) | Instructions for coding agents (Codex, Cursor, Claude Code, …) |
| [docs/AGENT_COLLABORATION.md](docs/AGENT_COLLABORATION.md) | Claim issues, wait on dependencies, `.agents/claims.yaml` |
| [docs/LINEAR_DEPENDENCIES.md](docs/LINEAR_DEPENDENCIES.md) | Linear **Blocked by** relations + description format for agents |
| [.cursor/rules/](.cursor/rules/) | Cursor-specific rules (`.mdc`) |
| [CLAUDE.md](CLAUDE.md) | Pointer to AGENTS.md for Claude Code |

## Problem (summary)

GitHub diff review is a poor fit for long markdown. Teams often review in Google Docs, but feedback splits across GitHub and Drive with no reconciliation. dorv creates a linked Google Doc from PR markdown and keeps review comments in sync both ways.

## Core user flows

1. **Author** opens a PR with `.md` files → sidebar offers **Create Google Doc** → formatted doc + bot comment on PR.
2. **GH → GDoc** — new GitHub review comments appear in the doc within ~2 minutes (alarm poll).
3. **Reviewer** opens the doc → side panel lists GH comments; highlights text → pushes Drive comments to GitHub with line matching.
4. **Stale commits** — new pushes set `isStale`; sidebar warns (doc content is not auto-updated).

## Tech stack (planned)

- [WXT](https://wxt.dev/) + React
- GitHub REST API (PAT), Google Drive / Docs comments API (`chrome.identity`)
- `marked` for markdown → HTML on doc creation

## Status

Greenfield — implementation not started. Track work in [Linear (dorv)](https://linear.app/humphreyahn/project/dorv-ffb245d3afc0/issues).
