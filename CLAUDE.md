# dorv (Claude Code)

**Agent instructions moved.** Use these instead of this file:

| Tool | Location |
| --- | --- |
| **All agents (Codex, Cursor, etc.)** | [AGENTS.md](AGENTS.md) |
| **Multi-agent claims / waits** | [docs/AGENT_COLLABORATION.md](docs/AGENT_COLLABORATION.md) |
| **Cursor** | [AGENTS.md](AGENTS.md) + [.cursor/rules/](.cursor/rules/) |
| **Humans** | [README.md](README.md) |

This file remains as a lightweight pointer for Claude Code sessions that auto-load `CLAUDE.md`.

## Quick principles

- Simplicity over architectural beauty; TDD with CI; monorepo + per-package READMEs; [prek](https://github.com/j178/prek) for hooks.
- **v0.3.0** = DirectAdapter only, no side panel (native-UI buttons instead), no background alarm (user-triggered sync), multi-doc PRs, exact-once sync.
- Next: v0.3.1 — GDoc → GH resolution sync, Mermaid in comments, refresh doc content workflow.
- Org: enough polish, no fuss — [Ahnpolished](README.md) bar in [AGENTS.md](AGENTS.md).
