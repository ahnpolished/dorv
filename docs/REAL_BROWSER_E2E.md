# Real-browser E2E tests (Chrome MCP)

Playwright headless cannot navigate to `chrome-extension://...` pages (Chrome v130+
redirects them). This document describes how to run E2E tests against **real Chrome**
using the Chrome DevTools MCP — the same browser the developer uses, with the real
extension loaded.

**These tests are local/QA only.** They do not run in CI (no real browser there).
CI stays with Playwright for smoke/unit-level extension checks.

## Prerequisites

- Real Chrome with the dorv extension loaded (unpacked)
- Chrome DevTools MCP connected (`chrome-devtools` server)
- Extension ID: `ndkhkamgdenpllbpjmaljcdajlfclhli` (from `wxt.config.ts`)

## Test scenarios

### TC-SMOKE-1: Options page loads

Navigate to the options page and verify it renders.

```
chrome_devtools_navigate_page: chrome-extension://<id>/options.html
chrome_devtools_take_snapshot → expect heading "Extension Settings"
```

### TC-SMOKE-2: Message round-trip

Send a message from the options page to the background SW and verify response.

```
chrome_devtools_evaluate_script:
  () => new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'GET_SYNC_STATUS',
      payload: { repo: 'ahnpolished/dorv', prNumber: 6 }
    }, resolve);
  })
→ expect { success: true }
```

### TC-AUTH-1: PAT validate & save

Fill the PAT input, click Validate & Save, verify storage.

```
1. Navigate to chrome-extension://<id>/options.html
2. Fill PAT input with test PAT
3. Click "Validate & Save"
4. Verify via evaluate: chrome.storage.local.get('github_pat') → matches test PAT
```

### TC-AUTH-2: Google sign-in status

Verify the connected Google account is displayed.

```
chrome_devtools_take_snapshot → expect StaticText with email address
```

### TC-DOC-1: Create Doc button on real PR

Navigate to a real GitHub PR with markdown files and verify the injected buttons appear.

```
1. Navigate to https://github.com/ahnpolished/dorv/pull/6/files
2. Wait for dorv-gh-buttons to appear
3. verify button text contains "Create linked doc"
```

### TC-DOC-2: Create Doc end-to-end

Click the Create Doc button and verify a Google Doc is created.

```
1. On a PR file page, click "Create linked doc" button
2. Wait for the button state to change to "linked" (showing doc URL)
3. Verify docStore in storage contains the doc mapping
4. Navigate to the created doc URL → verify it loads
```

### TC-SYNC-1: Sync comments to GDoc

After creating a doc, trigger sync and verify comments appear.

```
1. Ensure doc mapping exists for a PR
2. Send SYNC_NOW message via evaluate
3. Wait for sync to complete
4. Navigate to the Google Doc → verify comments exist
```

## Running a test manually

Each test is a sequence of MCP tool calls. Example for TC-SMOKE-2:

```bash
# In the agent session with Chrome MCP connected:
# 1. Navigate
mcp chrome_devtools_navigate_page '{"url": "chrome-extension://ndkhkamgdenpllbpjmaljcdajlfclhli/options.html", "type": "url"}'

# 2. Send message round-trip
mcp chrome_devtools_evaluate_script '{"function": "() => new Promise(resolve => { chrome.runtime.sendMessage({ type: \"GET_SYNC_STATUS\", payload: { repo: \"ahnpolished/dorv\", prNumber: 6 } }, resolve); })"}'
# → {"success":true}
```

## Automation

These steps can be scripted. The Chrome MCP exposes 29 tools (navigate, click, fill,
evaluate, screenshot, snapshot, network inspection) — enough to build a full test runner.
See `tests/e2e/real-browser/` for scripted versions.

## Why this works when Playwright doesn't

| Playwright headless | Real Chrome (MCP) |
|---|---|
| Redirects `chrome-extension://...` navigations | Extension pages load natively |
| `chrome.runtime` unavailable on opened pages | Full extension API access |
| Must mock GitHub/GDrive API responses | Can use real APIs (or mock at network level) |
| Service worker lifecycle unpredictable | Real SW lifecycle, real message passing |
