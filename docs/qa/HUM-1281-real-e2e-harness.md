# HUM-1281 real-credential E2E harness

This is the manual/non-blocking live-system validation path for HUM-1274 thread-sync work.
Mocked Playwright E2E remains the default PR gate; this harness is for release validation,
nightly/manual runs, and debugging behavior against real GitHub + Google Docs APIs.

## What is real vs mocked

Real:

- GitHub REST/GraphQL calls use `DORV_GITHUB_PAT` against a real PR.
- Google Drive/Docs calls use `DORV_GOOGLE_TOKEN` against a real Google Doc.
- The built WXT extension, service worker, Chrome storage, sidepanel, sync code, and API adapters run in Chromium.

Still controlled by the harness:

- `chrome.identity.getAuthToken` is patched to return `DORV_GOOGLE_TOKEN` so the test can run without an interactive OAuth prompt.
- `sidepanel.html` is opened directly and `chrome.tabs.query` is patched to point at the target PR, because Playwright cannot reliably capture Chrome's native side panel surface.
- The shared doc mapping is persisted in a temp state file between spec files.

## Credentials

Create an ignored local env file at `apps/extension/.env` and/or export the same variables in your shell:

```bash
GOOGLE_CLIENT_ID=...
DORV_GITHUB_PAT=...
DORV_GOOGLE_TOKEN=...
DORV_TEST_REPO=ahnpolished/dorv
DORV_TEST_PR_NUMBER=6
```

Optional:

```bash
DORV_LARGE_PR_REPO=ahnpolished/dorv
DORV_LARGE_PR_NUMBER=...
```

`DORV_GITHUB_PAT` must be able to read the target repo and create/delete PR review comments.

`DORV_GOOGLE_TOKEN` must include the extension scopes from `apps/extension/wxt.config.ts`, especially:

- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/documents`

A plain `gcloud auth print-access-token` token is usually scoped for Cloud SDK only and will fail Drive/Docs calls with `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`.

Preferred token refresh flow:

```bash
gcloud auth application-default login \
  --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive.file,https://www.googleapis.com/auth/documents

gcloud auth application-default print-access-token \
  --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive.file,https://www.googleapis.com/auth/documents
```

Alternative interactive extension flow:

```js
chrome.identity.getAuthToken({ interactive: true }, console.log)
```

## Running

From the repo/worktree root:

```bash
set -a
source apps/extension/.env
set +a

pnpm install
pnpm e2e:build
pnpm e2e:real
```

Useful focused runs:

```bash
pnpm e2e:real --grep "TC-001|TC-002|TC-003|TC-004|TC-005|TC-012"
pnpm e2e:real --grep "TC-011|TC-013|TC-014|TC-015"
```

The default `pnpm e2e` command runs only the mocked Playwright project. The real project is intentionally opt-in.

## State and cleanup

The real harness writes shared state to:

```bash
/tmp/dorv-real-e2e-state.json
```

The state file lets `doc-lifecycle.spec.ts` create/reuse a doc and lets `sync.spec.ts` seed a later browser context with the same mapping.

Cleanup expectations:

- Tests attempt to delete review comments they create on GitHub when practical.
- Google Docs created by TC-001 may be reused across runs; delete or trash them manually if you need a clean slate.
- Remove `/tmp/dorv-real-e2e-state.json` to force a new doc creation run.

## Current coverage mapping

- TC-001: create Google Doc from a real PR and persist mapping.
- TC-002: create a real GitHub review comment and verify it appears in Google Docs.
- TC-003: create a real GitHub reply and verify it appears in the same Google Docs thread.
- TC-004: create a multiline/code-oriented GitHub comment and verify mirroring.
- TC-005: resolve a GitHub thread and verify the Google Docs comment is resolved when thread id is available.
- TC-008: optional large-file doc creation path via `DORV_LARGE_PR_NUMBER`.
- TC-009: verify exported doc text / mermaid handling when the target PR has mermaid blocks.
- TC-010: simulate stale PR mapping by forcing an old `headSha` and verifying stale state.
- TC-011: verify an empty Google token produces an error sync state.
- TC-012: run sync twice and verify GitHub comments are not duplicated in Google Docs.
- TC-013: verify sidepanel responsiveness at narrow widths.
- TC-014: verify sync-now spinner state.
- TC-015: verify sidepanel GitHub deep links.

TC-006/TC-007 remain primarily covered by unit/integration tests for the current implementation seam because `syncAll()` currently handles Google Doc replies to mapped GitHub threads, while standalone Google Doc top-level comment push is exposed as an adapter method rather than an automatic polling path.

## PR/Linear closeout template

Record the live validation separately from normal CI:

- `pnpm run ci` passed.
- `pnpm e2e` passed against mocked APIs.
- `pnpm e2e:build` passed.
- `pnpm e2e:real` passed with local `apps/extension/.env` (do not paste secret values).
- Any skipped optional cases were skipped because: ...
