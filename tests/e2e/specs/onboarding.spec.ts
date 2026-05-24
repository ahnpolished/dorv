/**
 * AC: Onboarding — user completes GitHub + Google setup.
 * Flow: open PR page → see needs-setup sidebar → open sidepanel → complete setup.
 */
import { expect, test } from "../fixtures/extension.js";
import { FAKE_MD_FILES } from "../fixtures/mock-apis.js";
import type { Route } from "@playwright/test";

const PR_6 = {
  owner: "ahnpolished",
  repo: "dorv",
  prNumber: 6,
  url: "https://github.com/ahnpolished/dorv/pull/6"
};

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 10_000;

test("set up dorv — completes GitHub and Google onboarding starting from PR page", async ({
  extensionContext,
  extensionId,
  extensionWorker
}) => {
  // Mock the GitHub PR page HTML so the content script runs
  await extensionContext.route(PR_6.url, (route: Route) => {
    void route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>PR #6 · ${PR_6.owner}/${PR_6.repo}</title></head>
<body>
  <div class="Layout-sidebar">
    <div id="partial-discussion-sidebar"></div>
  </div>
</body>
</html>`
    });
  });

  // Mock PR files so the sidebar renders (no credentials → needs-setup state)
  await extensionContext.route(
    `https://api.github.com/repos/${PR_6.owner}/${PR_6.repo}/pulls/${PR_6.prNumber.toString()}/files*`,
    (route: Route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FAKE_MD_FILES)
      });
    }
  );

  // Navigate to the PR page — content script injects the needs-setup sidebar
  const prPage = await extensionContext.newPage();
  await prPage.goto(PR_6.url);
  await prPage.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });
  await prPage.waitForTimeout(2_000);

  // Open the sidepanel for onboarding
  const panel = await extensionContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });

  // Step 1: Connect GitHub
  await panel.waitForSelector("h1", { timeout: TIMEOUT });
  await expect(panel.locator("h1")).toContainText("Connect GitHub");
  await panel.waitForTimeout(1_500);

  await panel.locator("input.pat-input").fill("ghp_e2e_onboarding_test_token");
  await panel.waitForTimeout(1_000);
  await panel.locator("button.onboarding-btn", { hasText: "Continue" }).click();

  // Step 2: Connect Google — patch chrome.identity in the sidepanel page context
  await expect(panel.locator("h1")).toContainText("Connect Google", { timeout: TIMEOUT });
  await panel.waitForTimeout(1_500);

  await panel.evaluate(() => {
    const identity = chrome.identity as {
      getAuthToken: (opts: unknown, cb: (t: string) => void) => void;
    };
    identity.getAuthToken = (_opts, cb) => {
      cb("fake-google-token-e2e");
    };
  });
  await panel.locator("button.onboarding-btn", { hasText: "Sign in with Google" }).click();

  // Done state
  await expect(panel.locator("h1")).toContainText("You're set", { timeout: TIMEOUT });
  await panel.waitForTimeout(2_000);
  await panel.locator("button.onboarding-btn", { hasText: "Get started" }).click();

  // Clean up storage
  await extensionWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove(["github_pat"], resolve);
      })
  );

  await prPage.close();
  await panel.close();
});
