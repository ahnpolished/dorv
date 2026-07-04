/**
 * Realistic onboarding test using real GitHub and Google credentials.
 *
 * Required env vars (skipped when absent):
 *   DORV_GITHUB_PAT   — GitHub PAT with repo read + PR comment write
 *   DORV_GOOGLE_TOKEN — short-lived Google OAuth access token; obtain via:
 *                         gcloud auth print-access-token
 *                       or from any extension page's DevTools console:
 *                         chrome.identity.getAuthToken({ interactive: true }, console.log)
 *
 * Assumes PR #6 of ahnpolished/dorv contains at least one markdown file
 * (the github-buttons content script renders nothing for PRs with no .md
 * files).
 *
 * No network mocking — real github.com page, real GitHub API, real Google Drive API.
 *
 * v0.3.0 note: the sidepanel-based multi-step wizard this used to drive
 * ("Connect GitHub" -> "Connect Google" -> "You're set") no longer exists.
 * Onboarding is now the single `options.html` settings page, reached from
 * the github-buttons content script's "Set up dorv to sync review docs"
 * button via `chrome.runtime.openOptionsPage()`.
 */
import { expect, test } from "../fixtures/extension.js";

const PR_URL = "https://github.com/ahnpolished/dorv/pull/6";
const BUTTON_HOST = "dorv-gh-buttons";
const TIMEOUT = 15_000;

test("set up dorv with real credentials — PR button → options page onboarding", async ({
  extensionContext,
  extensionId,
  extensionWorker
}) => {
  const githubPat = process.env.DORV_GITHUB_PAT ?? "";
  const googleToken = process.env.DORV_GOOGLE_TOKEN ?? "";
  test.skip(!githubPat || !googleToken, "Requires DORV_GITHUB_PAT and DORV_GOOGLE_TOKEN env vars");

  // Navigate to the real GitHub PR page — content script runs on the actual DOM
  const prPage = await extensionContext.newPage();
  await prPage.goto(PR_URL, { waitUntil: "domcontentloaded" });

  // Content script fetches PR files and injects the no-creds "Set up dorv" button
  await prPage.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });
  const setupButton = prPage.locator(BUTTON_HOST).locator("button", {
    hasText: "Set up dorv"
  });
  await expect(setupButton).toBeVisible({ timeout: TIMEOUT });

  // Clicking exercises the real button/message wiring and opens options.html
  // as a new extension page via chrome.runtime.openOptionsPage().
  const [optionsPage] = await Promise.all([
    extensionContext.waitForEvent("page", {
      predicate: (p) => p.url().includes(`${extensionId}/options.html`),
      timeout: TIMEOUT
    }),
    setupButton.click()
  ]);
  await optionsPage.waitForLoadState("domcontentloaded");

  // Step 1: Connect GitHub with real PAT
  await expect(optionsPage.locator("h2", { hasText: "GitHub Authentication" })).toBeVisible({
    timeout: TIMEOUT
  });
  await optionsPage.locator('input[type="password"]').fill(githubPat);
  await optionsPage.locator("button", { hasText: "Validate & Save" }).click();
  await expect(optionsPage.locator("p.save-confirmation")).toContainText("validated and saved", {
    timeout: TIMEOUT
  });

  // Step 2: Connect Google — patch chrome.identity to return the real token
  await optionsPage.evaluate((token: string) => {
    const identity = chrome.identity as {
      getAuthToken: (opts: unknown, cb: (t: string) => void) => void;
    };
    identity.getAuthToken = (_opts, cb) => {
      cb(token);
    };
  }, googleToken);
  await optionsPage.locator("button", { hasText: "Connect Google Account" }).click();
  await expect(optionsPage.locator("button", { hasText: "Sign Out from Google" })).toBeVisible({
    timeout: TIMEOUT
  });

  // Clean up PAT from storage
  await extensionWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove(["github_pat"], resolve);
      })
  );

  await prPage.close();
  await optionsPage.close();
});
