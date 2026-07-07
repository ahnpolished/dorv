# GDoc version evolution (HUM-1417 scoping)

Markdown files in a PR change after a Google Doc is already created. This scopes
whether the Drive/Docs APIs let dorv track and expose that evolution.

## 1. Can dorv create/name versions via API?

**No.** Drive API v3 `revisions` is read-only for native Google Docs:

- `revisions.list` / `revisions.get` return metadata (`id`, `modifiedTime`,
  `lastModifyingUser`) — there is no `revisions.create` or "name this version"
  endpoint.
- `keepForever` (pinning a revision so Drive won't purge it) only applies to
  **blob files** (binary uploads). Google Docs is a Workspace-native format, so
  pinning doesn't apply — nothing to protect a revision from GC even if we
  wanted to.
- "Name current version" only exists in the Docs editor UI (File → Version
  history), with no API equivalent.

**Conclusion:** dorv cannot programmatically create a version per git commit,
or label a revision with a git hash.

## 2. Can dorv link to a specific version by URL?

**No stable, documented scheme.** What exists:

- `files.export` always exports the **current head** — no revision parameter.
- `revisions.get?fields=exportLinks` returns per-revision export URLs, but
  these **download** a static snapshot (e.g. as HTML/plain text) — they do not
  open the live Docs editor at that point in history.
- The Docs editor's own version-history panel URL (what you see clicking a
  version in File → Version history) uses opaque, undocumented identifiers.
  Google does not publish a `?version=<id>` query scheme for it, and nothing
  guarantees it's stable across releases.

**Conclusion:** dorv cannot deep-link a user into the live editor at a specific
past version. It can only offer a downloaded snapshot of a revision's content.

## 3. Design given these constraints

Given 1 and 2 are both "no," the issue's original shape (named versions per
commit, deep link to a version) isn't buildable on top of the public API. The
achievable subset:

- **List, don't create.** Use `revisions.list` (read-only, already scoped
  under `drive.file` since dorv owns the doc) to show a chronological list of
  edits — timestamp + editor — without dorv ever storing version history
  itself. This satisfies the "don't save version history in local/extension
  storage" preference in the issue: always fetch live from Drive.
- **No git-hash-to-revision mapping.** There's no way to tag a Drive revision
  with the git SHA that triggered it, so don't attempt to correlate specific
  revisions to specific commits. Correlating by nearest `modifiedTime` to a
  known sync event would be approximate and misleading — skip it.
- **Reuse existing staleness signal instead of new version UI.** `DocMapping`
  already tracks `headSha` (sha at doc creation/seed), `latestSha` (sha at last
  poll), and `isStale` (amber UI when they diverge) — see
  [ARCHITECTURE.md](ARCHITECTURE.md#stale-commits). That's the real product
  need behind this issue ("doc fell behind the PR's current markdown") and it
  already works without any Drive revision API calls.
- **Hover popup scope:** show the Drive revision list (time + editor) as
  read-only context on hover — a "here's the edit history" affordance, not a
  version switcher. Each entry can open its `exportLinks` download as a
  fallback for "what did this look like before," but should not claim to jump
  the user into a live version — set expectations in the UI copy.
- **Out of scope for v0.3.x:** any feature promising "jump to the version that
  matches this commit" or "auto-create a version on each push." Both require
  API capabilities that don't exist. If this becomes a hard requirement later,
  the only path is Apps Script (a separate OAuth scope + deployment,
  disproportionate to the ask) — not recommended.

## First-pass implementation (this PR)

- `listGoogleDocRevisions(token, fileId)` in
  [`apps/extension/lib/gdoc/drive.ts`](../apps/extension/lib/gdoc/drive.ts) —
  thin wrapper over `revisions.list`, no local persistence.
- Test: [`tests/gdoc-revisions.test.ts`](../tests/gdoc-revisions.test.ts).

**Not in this PR** (follow-up if prioritized): the hover popup UI on the PR
sidebar doc icon that renders this list.
