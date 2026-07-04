/**
 * AC #9: Options page: PAT input → validate → storage updated.
 */
import { expect, test } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

const TIMEOUT = 20_000;

test("entering PAT and saving stores it in chrome.storage.local", async ({
  extensionContext,
  extensionWorker
}) => {
  await setupPageRoutes(extensionContext);

  // Open options page via the extension SW runtime to bypass Chrome v130+
  // redirect of direct page.goto("chrome-extension://...") navigations.
  const [page] = await Promise.all([
    extensionContext.waitForEvent("page"),
    extensionWorker.evaluate(() => chrome.runtime.openOptionsPage())
  ]);
  await page.waitForLoadState("domcontentloaded");

  // Options page starts in "Loading..." state, then shows the form once auth state loads.
  // getGoogleToken(false) is now wrapped in try/catch so it doesn't block rendering.
  await page.waitForFunction(() => document.querySelectorAll("input[type='password']").length > 0, {
    timeout: TIMEOUT
  });

  const testPat = "ghp_testpat_e2e_abcdef1234567890";
  await page.locator("input[type='password']").first().fill(testPat);

  page.on("dialog", (dialog) => void dialog.accept());
  await page.locator("button", { hasText: "Validate & Save" }).first().click();

  // Poll until storage is updated
  await expect
    .poll(
      async () => {
        const result = await extensionWorker.evaluate<Record<string, unknown>>(
          () =>
            new Promise((resolve) => {
              chrome.storage.local.get(["github_pat"], (items) => {
                resolve(items);
              });
            })
        );
        return result.github_pat;
      },
      { timeout: TIMEOUT }
    )
    .toBe(testPat);

  await extensionWorker.evaluate(
    () =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove(["github_pat"], resolve);
      })
  );

  await page.close();
});
