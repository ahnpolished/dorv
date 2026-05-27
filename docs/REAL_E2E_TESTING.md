# Real E2E Testing

Explains what the `tests/e2e/real/` suite actually tests, what credentials it needs, and what it creates in external systems.

---

## What "real" means

| Layer | Real? | Detail |
|---|---|---|
| GitHub PR | ✅ Yes | Fetches metadata from `https://api.github.com` using your PAT; creates/deletes actual review comments on the target PR |
| Google Drive / Docs | ✅ Yes | Creates actual Google Docs in your Drive; reads and writes Drive comments via the Drive v3 API |
| Extension sync logic | ✅ Yes | Runs the full background service worker sync path end-to-end |
| Browser session | ❌ No | Headless Chromium with a fresh temp profile — not your logged-in Chrome |
| `chrome.tabs.query` | ❌ No | Patched via `addInitScript` to return the target PR URL (the headless browser isn't navigated to GitHub from Chrome's perspective) |
| `chrome.identity.getAuthToken` | ❌ No | Patched in the service worker to return the injected `DORV_GOOGLE_TOKEN` |

**Bottom line:** the extension's sync logic runs against real APIs, but the browser plumbing (auth, tab detection) is wired via injection rather than a real logged-in session.

---

## Credentials required

| Env var | What it is | Where to get it |
|---|---|---|
| `DORV_GITHUB_PAT` | GitHub PAT, `repo` scope | github.com/settings/tokens — select `ahnpolished/dorv`, Contents + Pull requests read, PR reviews write |
| `DORV_GOOGLE_REFRESH_TOKEN` | Long-lived OAuth refresh token | Google OAuth Playground with `drive.file`, `documents`, `userinfo.email` scopes and your OAuth client |
| `DORV_GOOGLE_CLIENT_ID` | OAuth client ID | GCP Console → APIs & Services → Credentials |
| `DORV_GOOGLE_CLIENT_SECRET` | OAuth client secret | Same credential detail page |

Put these in `.env.test.local` (gitignored). `playwright.config.ts` loads the file automatically — no `source` needed.

`DORV_GOOGLE_TOKEN` is derived automatically at test start via `tests/global-setup.ts` by exchanging the refresh token. You don't need to set it manually.

### Optional

| Env var | Default | Purpose |
|---|---|---|
| `DORV_TEST_REPO` | `ahnpolished/dorv` | owner/repo for the test PR |
| `DORV_TEST_PR_NUMBER` | `6` | PR number; must have ≥ 1 markdown file |

---

## What tests create in external systems

| Spec | Creates | Cleans up |
|---|---|---|
| `doc-lifecycle.spec.ts` | A real Google Doc in your Drive | Trashes the doc in teardown; stores doc ID in `/tmp/dorv-real-e2e-state.json` for subsequent specs |
| `sync.spec.ts` | GitHub review comments tagged `[dorv-real-test]`; GDoc comments | Deletes GH comments in teardown; Drive comments cleaned via trash |
| `auth-smoke.spec.ts` | Nothing persistent | — |

If a test run is interrupted mid-teardown, orphan GH comments and Drive docs may remain. Clean them up manually or re-run — the test suite detects existing docs and reuses them.

---

## Running

```bash
# Full real suite
pnpm e2e:real

# Single test by grep
pnpm e2e:real --grep "TC-012"

# Build extension first if you changed extension code
pnpm e2e:build && pnpm e2e:real
```

Or use the `/e2e-real` Claude command which handles build + run + summary automatically.

---

## Test execution order

The real specs have a dependency chain — run them in this order (Playwright respects file order within a project):

1. `auth-smoke.spec.ts` — no persistent state, safe to run standalone
2. `doc-lifecycle.spec.ts` — creates the doc; writes to `/tmp/dorv-real-e2e-state.json`
3. `sync.spec.ts` — reads state file; requires doc from step 2
