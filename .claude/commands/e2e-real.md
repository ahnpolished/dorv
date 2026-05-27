---
description: Build the extension and run real-credential E2E tests against live GitHub and Google Drive, then report pass/fail inline
argument-hint: Optional spec file or grep pattern (e.g. TC-012, auth-smoke, sync)
---

# Real-Credential E2E Test Runner

Run the dorv real-credential E2E suite (`tests/e2e/real/`) against live GitHub and Google Drive APIs.

**What "real" means:** the extension sync logic runs end-to-end against actual GitHub PR comments and actual Google Docs. The browser session is headless with injected credentials — see `docs/REAL_E2E_TESTING.md` for full details.

## Pre-flight checks

Before running tests, verify credentials are in place:

1. Check that `.env.test.local` exists and contains `DORV_GITHUB_PAT`, `DORV_GOOGLE_REFRESH_TOKEN`, `DORV_GOOGLE_CLIENT_ID`, `DORV_GOOGLE_CLIENT_SECRET`.
2. If any are missing, stop and tell the user exactly which vars are missing and where to get them (see `docs/REAL_E2E_TESTING.md`).
3. Do NOT proceed without credentials — tests will silently skip and produce a misleading "all passed" result.

## Steps

1. **Build the extension** — run `pnpm e2e:build` from the repo root. If the build fails, stop and report the build error; do not continue.

2. **Run real E2E tests** — run `pnpm e2e:real $ARGUMENTS` from the repo root.
   - If `$ARGUMENTS` is provided, pass it as `--grep "$ARGUMENTS"` to filter to matching tests.
   - Capture stdout and stderr.
   - The first line of output should be `[globalSetup] Google access token refreshed` — if it instead says `Skipping token refresh`, stop and report that credentials are missing or not loading.

3. **Report results** inline:
   - If all tests pass: one line — "All N tests passed (Xs)."
   - If any tests are skipped: note the count and remind the user that skips mean credentials are missing.
   - If any tests fail:
     - List each failure: spec file + TC number + test title + first 8 lines of error.
     - Classify each failure as: **infrastructure** (timeout, sidepanel open, CDP) or **product bug** (assertion on sync logic, comment counts, doc content).
     - For product bugs, offer to file a Linear issue (HUM project).
     - End with: "N/M tests passed, K skipped."
   - If the build failed, show the last 20 lines of build output.

Keep the report concise. Do not repeat passing test names.

## Cleanup note

Real tests create GitHub review comments and Google Drive documents. If a run is interrupted, orphan artifacts may remain. Mention this if the run was interrupted mid-teardown.
