/**
 * AC: Clicking "Set up dorv" in the PR sidebar opens the side panel without error.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 10_000;

test("clicking 'Set up dorv' opens side panel without user-gesture error", async ({
  extensionContext
}) => {
  await setupPageRoutes(extensionContext);
  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });

  await page.locator("button", { hasText: "Set up dorv" }).click();
  await page.waitForTimeout(1_000);

  const errorText = await page.evaluate(() => {
    const host = document.querySelector("dorv-pr-sidebar-root");
    return (host?.shadowRoot?.querySelector(".dorv-error")?.textContent ?? "").trim();
  });

  expect(errorText).toBe("");
});
