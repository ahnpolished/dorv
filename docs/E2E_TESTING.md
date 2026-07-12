# E2E Testing — Architecture & Best Practices

> **v0.3.0 note**: the sidepanel (`sidepanel.html`, `Alt+Shift+D` toggle, `chrome.sidePanel`) described throughout this doc was deleted in the v0.3.0 rewrite. The extension now injects buttons directly into the native GitHub PR page (`github-buttons.content.tsx`, shadow host `<dorv-gh-buttons>`) and the native Google Docs comment sidebar (`gdoc-buttons.content.tsx`); onboarding moved to `options.html`. The Playwright mechanics below (`launchPersistentContext`, service-worker access, PAT/identity mocking, headless-vs-headed constraints) are still accurate for the extension in general — only the sidepanel-specific bits (rows/sections that mention `sidepanel`, `debug-sidepanel.ts`, `Alt+Shift+D`) are stale. A broader rewrite of this doc is tracked separately; this note exists so the stale bits aren't read as current architecture.

Chrome extension testing has hard constraints that don't apply to web apps. This doc explains the current setup, the known limitations, and the recommended architecture for each test scenario.

---

## Current state (what works, don't break)

| Capability | Status | How |
|---|---|---|
| Load extension in Playwright | ✅ | `launchPersistentContext(tmpDir, { args: ['--load-extension=...', '--headless=new'] })` |
| Sidepanel detection | ✅ (headless only) | `context.waitForEvent('page', { predicate: p => p.url().includes('sidepanel') })` |
| Alt+Shift+D keyboard shortcut | ✅ (headless) | `page.keyboard.press('Alt+Shift+D')` — works because headless opens sidepanel as a tab |
| GitHub PAT injection | ✅ | `extensionWorker.evaluate(() => chrome.storage.local.set({ github_pat }))` |
| Google identity mock | ✅ | Patching `chrome.identity.getAuthToken` in SW + `addInitScript` |
| Service worker access | ✅ | `context.serviceWorkers()[0]` |
| Real GH/GDocs API calls | ✅ | PAT + Google token via env vars |
| Debug against running Chrome | ✅ | `debug-sidepanel.ts` → `chromium.connectOverCDP()` |

---

## Hard constraints (Chrome, not Playwright)

1. **Sidepanel in headed mode**: `chrome.sidePanel.open()` renders in the browser chrome layer. Playwright's `waitForEvent('page')` does **not** fire. In `--headless=new`, Chrome falls back to opening the sidepanel URL as a tab — this is why current tests work. ([Playwright issue #26693](https://github.com/microsoft/playwright/issues/26693) — P3, no roadmap.)

2. **`chrome.commands` keyboard shortcuts**: `page.keyboard.press()` sends to the renderer process; `chrome.commands` dispatches at the browser process level. Works in `--headless=new` empirically (likely via content script listener calling `chrome.sidePanel.open()` directly), not guaranteed in headed mode. ([Playwright issue #22683](https://github.com/microsoft/playwright/issues/22683).)

3. **Profile lock**: Chrome writes a `SingletonLock` file. Two browsers cannot share a profile directory simultaneously. Playwright's temp-dir approach is correct.

4. **No better alternative**: Puppeteer's `triggerExtensionAction` opens sidepanel natively (treats it as a real user gesture), but migrating the full fixture system to Puppeteer + Jest solves exactly one gap at the cost of rewriting everything. Not worth it. WXT defers entirely to Playwright. WebDriver BiDi is not ready.

---

## Three-mode architecture

### Mode A: CI / mocked creds (current — `tests/e2e/specs/`)

For all logic/UI tests. Fastest, most reliable.

```
launchPersistentContext(tmpDir)  →  --headless=new  →  inject PAT + mock identity
sidepanel: waitForEvent('page') — works because headless opens it as tab
```

Run via: `pnpm e2e`. No changes needed.

### Mode B: Real credentials (current — `tests/e2e/real/`)

For integration tests against real GH + GDocs APIs.

```
launchPersistentContext(tmpDir)  →  --headless=new  →  inject real PAT + real Google token
sidepanel: same as Mode A — headless tab fallback
```

**Current gap**: Google token expires in ~1h. Fix: add `tests/global-setup.ts` to auto-refresh via refresh token (see below).

### Mode C: Real Chrome + real profile (local dev only — `debug-sidepanel.ts`)

For debugging the actual sidepanel with real profile cookies/state. Not suitable for CI.

```
User launches Chrome: bin/chrome-dev.sh  →  --remote-debugging-port=9222
connectOverCDP('http://localhost:9222')  →  context.pages() find sidepanel
```

---

## Token management

### Problem

`DORV_GOOGLE_TOKEN` expires in ~1h. Manually re-obtaining it via `chrome.identity.getAuthToken({ interactive: true })` blocks CI runs.

### Fix: store a refresh token, exchange at test start

**`tests/global-setup.ts`** (new file):

```typescript
export default async function globalSetup() {
  const refreshToken = process.env.DORV_GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.DORV_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.DORV_GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) return;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    console.warn("[globalSetup] Google token refresh failed — real tests will skip");
    return;
  }
  const { access_token } = (await resp.json()) as { access_token: string };
  process.env.DORV_GOOGLE_TOKEN = access_token;
}
```

Wire into `playwright.config.ts`:

```typescript
export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  // rest unchanged
});
```

**Env file** (`.env.test.local`, gitignored by `.env.*`):

```bash
DORV_GITHUB_PAT=ghp_...
DORV_GOOGLE_REFRESH_TOKEN=1//...
DORV_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
DORV_GOOGLE_CLIENT_SECRET=GOCSPX-...
DORV_TEST_REPO=ahnpolished/dorv
DORV_TEST_PR_NUMBER=6
```

**Getting the refresh token** (one-time):
- Use Google OAuth Playground (accounts.google.com/o/oauth2/auth) with `access_type=offline`
- Or use `gcloud auth application-default login --scopes=...` and extract from `~/.config/gcloud/application_default_credentials.json`
- Store in GitHub Secrets for CI. Refresh tokens are long-lived — rotate quarterly.

---

## Real Chrome profile setup (`bin/chrome-dev.sh`)

```bash
#!/usr/bin/env bash
# Launch Chrome for extension debugging with a dedicated test profile.
# Usage: ./bin/chrome-dev.sh
set -euo pipefail

PROFILE="${HOME}/.config/chrome-dorv-dev"
EXTENSION_PATH="$(pwd)/apps/extension/.output/chrome-mv3"

mkdir -p "$PROFILE"

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXTENSION_PATH" \
  --load-extension="$EXTENSION_PATH" \
  --no-first-run \
  --no-default-browser-check
```

Use a **dedicated profile dir** (`~/.config/chrome-dorv-dev`), NOT your real `~/Library/Application Support/Google/Chrome`. Log in to GitHub + Google in this profile once. Then:

```bash
pnpm e2e:build
./bin/chrome-dev.sh
# Open PR page, trigger sidepanel
npx tsx tests/e2e/debug-sidepanel.ts http://127.0.0.1:9222
```

**If you need real cookies** (rare — usually not needed since you inject tokens via env vars):

```bash
# Safe copy of real Chrome cookies to the test profile
SOURCE="$HOME/Library/Application Support/Google/Chrome/Default"
DEST="$HOME/.config/chrome-dorv-dev/Default"
mkdir -p "$DEST"
# sqlite3 .backup is safe even while Chrome is running (WAL mode)
sqlite3 "$SOURCE/Cookies" ".backup $DEST/Cookies"
```

Chrome encrypts cookies via macOS Keychain. If you copy them, pass `--password-store=keychain` to the Chrome launch args.

---

## Sidepanel content extraction

Once you have a `Page` reference:

```typescript
// Text
const text = await sidepanel.evaluate(() => document.body.innerText);

// Structured state
const state = await sidepanel.evaluate(() => ({
  heading: document.querySelector("h3")?.textContent ?? null,
  comments: Array.from(document.querySelectorAll(".comment-card")).map(c => ({
    author: c.querySelector(".author")?.textContent ?? "",
    body: c.querySelector(".comment-body")?.textContent?.slice(0, 120) ?? "",
  })),
}));

// Wait for async state
await sidepanel.waitForSelector(".dorv-sidepanel:not(.loading)", { timeout: 15_000 });

// Screenshot
await sidepanel.screenshot({ path: "/tmp/sidepanel.png", fullPage: true });
```

For **headed mode CDP-only** (no Playwright Page — for `debug-sidepanel.ts` style scripts):

```typescript
const client = await context.newCDPSession(anyPage);
const { targetInfos } = await client.send("Target.getTargets");
const spTarget = targetInfos.find(t => t.url.includes("sidepanel.html"));
// Use connectOverCDP + allPages instead — debug-sidepanel.ts already does this correctly
```

---

## Coding agent tips

1. **Always build first**: `pnpm e2e:build` before `pnpm e2e` or `pnpm e2e:real`. Stale `.output/chrome-mv3` causes silent failures.

2. **`workers: 1` is required**: Don't change it. Extension tests can't be parallelized.

3. **Side panel = tab in headless by design**: `waitForEvent('page', { predicate: url.includes('sidepanel') })` is correct. Don't "fix" it.

4. **Seed storage before `goto()`**: Extension reads `chrome.storage.local` on load. Seeding after `goto()` races.

5. **Extension ID is dynamic**: Always `worker.url().split('/')[2]`. Never hardcode.

6. **`addInitScript` for chrome API patches**: Runs before page scripts. Patching after `goto()` is a race.

7. **Real tests skip gracefully**: `DORV_GITHUB_PAT`/`DORV_GOOGLE_TOKEN` absent → `test.skip()`. Intentional. Keep it.

8. **`debug-sidepanel.ts` for live diagnosis**: `./bin/chrome-dev.sh` → open PR → trigger sidepanel → `npx tsx tests/e2e/debug-sidepanel.ts`. Gets you storage snapshot + screenshot + live Drive API response in one command.

---

## Action items

| Priority | Item | Effort |
|---|---|---|
| P0 | Add `tests/global-setup.ts` — Google token auto-refresh | ~30 min |
| P0 | Wire `globalSetup` into `playwright.config.ts` | 1 line |
| P0 | Add `.env.example` with all real test env var names | ~5 min |
| P1 | Add `bin/chrome-dev.sh` to repo | ~10 min |
| P2 | CI workflow: add Google refresh token secrets | ~15 min |
| skip | Migrate to Puppeteer for sidepanel trigger testing | Not worth it |
| skip | Real Chrome profile copy for CI | Complexity > benefit |
