/**
 * AC: Onboarding — user completes GitHub + Google setup.
 *
 * v0.3.0 note: this used to drive a multi-step sidepanel onboarding wizard
 * ("Connect GitHub" -> "Connect Google" -> "You're set", `input.pat-input` /
 * `button.onboarding-btn`) that no longer exists — the sidepanel was
 * deleted. Onboarding is now a single settings page (`options.html`,
 * `apps/extension/src/options.tsx`): a GitHub PAT input + "Validate & Save"
 * button, and a "Connect Google Account" button. The entry point on the PR
 * page is the github-buttons content script's "Set up dorv to sync review
 * docs" button, which calls `chrome.runtime.openOptionsPage()`.
 *
 * Flow: open PR page -> see "Set up dorv" button (no creds) -> click it ->
 * options page opens -> validate GitHub PAT -> connect Google.
 */
import { expect, test } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_MD_FILES } from "../fixtures/mock-apis.js";

const PR_6 = {
  owner: "ahnpolished",
  repo: "dorv",
  prNumber: 6,
  url: "https://github.com/ahnpolished/dorv/pull/6"
};

const BUTTON_HOST = "dorv-gh-buttons";
const TIMEOUT = 10_000;

test("set up dorv — completes GitHub and Google onboarding starting from PR page", async ({
  extensionContext,
  extensionId,
  extensionWorker
}) => {
  await setupPageRoutes(extensionContext, { files: FAKE_MD_FILES, ghReviewComments: [] });

  // Validate & Save posts to GET /user to check the PAT is valid.
  await extensionContext.route("https://api.github.com/user", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ login: "e2e-test-user" })
    });
  });

  // Navigate to the PR page — content script injects the "Set up dorv" button
  // (no-creds state) since no github_pat is stored yet.
  const prPage = await extensionContext.newPage();
  await prPage.goto(PR_6.url);
  await prPage.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });

  const setupButton = prPage.locator(BUTTON_HOST).locator("button", {
    hasText: "Set up dorv"
  });
  await expect(setupButton).toBeVisible({ timeout: TIMEOUT });

  // Clicking calls chrome.runtime.openOptionsPage(), which opens options.html
  // as a new extension page.
  const [optionsPage] = await Promise.all([
    extensionContext.waitForEvent("page", {
      predicate: (p) => p.url().includes(`${extensionId}/options.html`),
      timeout: TIMEOUT
    }),
    setupButton.click()
  ]);
  await optionsPage.waitForLoadState("domcontentloaded");

  // Step 1: GitHub PAT
  await expect(optionsPage.locator("h2", { hasText: "GitHub Authentication" })).toBeVisible({
    timeout: TIMEOUT
  });
  await optionsPage.locator('input[type="password"]').fill("ghp_e2e_onboarding_test_token");
  await optionsPage.locator("button", { hasText: "Validate & Save" }).click();
  await expect(optionsPage.locator("p.save-confirmation")).toContainText("validated and saved", {
    timeout: TIMEOUT
  });

  // Step 2: Google — patch chrome.identity in the options page context
  await optionsPage.evaluate(() => {
    const identity = chrome.identity as {
      getAuthToken: (opts: unknown, cb: (t: string) => void) => void;
    };
    identity.getAuthToken = (_opts, cb) => {
      cb("fake-google-token-e2e");
    };
  });
  await optionsPage.locator("button", { hasText: "Connect Google Account" }).click();
  await expect(optionsPage.locator("button", { hasText: "Sign Out from Google" })).toBeVisible({
    timeout: TIMEOUT
  });

  // Clean up storage
  await extensionWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove(["github_pat"], resolve);
      })
  );

  await prPage.close();
  await optionsPage.close();
});
