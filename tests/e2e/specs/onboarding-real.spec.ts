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
 * (the content script hides the sidebar entirely for PRs with no .md files).
 *
 * No network mocking — real github.com page, real GitHub API, real Google Drive API.
 *
 * Playwright limitation: chrome.sidePanel.open() requires a user gesture that Chrome does not
 * propagate through the async message-passing chain in headful test mode. The "Set up dorv"
 * button click IS exercised (proving the content script wiring works), but after clicking we
 * navigate to sidepanel.html directly — Playwright cannot capture Chrome's native side panel
 * surface via a page event.
 */
import { expect, test } from "../fixtures/extension.js";

const PR_URL = "https://github.com/ahnpolished/dorv/pull/6";
const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 15_000;

test("set up dorv with real credentials — PR sidebar → sidepanel onboarding", async ({
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

  // Content script fetches PR files and injects the needs-setup sidebar
  await prPage.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });
  await prPage.waitForTimeout(2_000); // let the user see the needs-setup sidebar

  // Click "Set up dorv" — exercises the real button/message wiring.
  // In real Chrome the gesture propagates and chrome.sidePanel.open() fires; Playwright's
  // async message chain breaks gesture propagation so we navigate to the panel directly after.
  await prPage.locator("button", { hasText: "Set up dorv" }).click();
  await prPage.waitForTimeout(1_000); // brief pause so the click is visible

  // Open the sidepanel directly (Playwright cannot capture Chrome's native side panel surface)
  const panel = await extensionContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });
  await panel.waitForTimeout(1_000);

  // Step 1: Connect GitHub with real PAT
  await panel.waitForSelector("h1", { timeout: TIMEOUT });
  await expect(panel.locator("h1")).toContainText("Connect GitHub");
  await panel.waitForTimeout(1_500);

  await panel.locator("input.pat-input").fill(githubPat);
  await panel.waitForTimeout(1_000);
  await panel.locator("button.onboarding-btn", { hasText: "Continue" }).click();

  // Step 2: Connect Google — patch chrome.identity to return the real token
  await expect(panel.locator("h1")).toContainText("Connect Google", { timeout: TIMEOUT });
  await panel.waitForTimeout(1_500);

  await panel.evaluate((token: string) => {
    const identity = chrome.identity as {
      getAuthToken: (opts: unknown, cb: (t: string) => void) => void;
    };
    identity.getAuthToken = (_opts, cb) => {
      cb(token);
    };
  }, googleToken);
  await panel.locator("button.onboarding-btn", { hasText: "Sign in with Google" }).click();

  // Done state
  await expect(panel.locator("h1")).toContainText("You're set", { timeout: TIMEOUT });
  await panel.waitForTimeout(2_000);
  await panel.locator("button.onboarding-btn", { hasText: "Get started" }).click();

  // Clean up PAT from storage
  await extensionWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove(["github_pat"], resolve);
      })
  );

  await prPage.close();
  await panel.close();
});
