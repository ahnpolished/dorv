/**
 * AC #2: Panel hidden on non-MD PRs; file list shown on MD PRs.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_NON_MD_FILES } from "../fixtures/mock-apis.js";

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 10_000;

async function shadowQuery(
  page: import("@playwright/test").Page,
  selector: string
): Promise<boolean> {
  return page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-pr-sidebar-root");
    for (const host of allHosts) {
      if (host.shadowRoot?.querySelector(sel)) return true;
    }
    return false;
  }, selector);
}

async function shadowText(
  page: import("@playwright/test").Page,
  selector: string
): Promise<string | null> {
  return page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-pr-sidebar-root");
    for (const host of allHosts) {
      const el = host.shadowRoot?.querySelector(sel);
      if (el) return el.textContent;
    }
    return null;
  }, selector);
}

test("sidebar hidden when PR has no markdown files", async ({ extensionContext, seedStorage }) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await setupPageRoutes(extensionContext, { files: FAKE_NON_MD_FILES });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);

  await page.waitForTimeout(3_000);
  expect(await page.locator(SIDEBAR_HOST).count()).toBe(0);
  await page.close();
});

test("sidebar shows file list when PR has markdown files", async ({
  extensionContext,
  seedStorage
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });

  await expect
    .poll(async () => shadowText(page, "li span"), { timeout: TIMEOUT })
    .toContain("docs/rfc.md");

  await page.close();
});

test("sidebar shows needs-setup state when no credentials", async ({ extensionContext }) => {
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });

  await expect
    .poll(async () => shadowQuery(page, ".dorv-needs-setup"), { timeout: TIMEOUT })
    .toBe(true);

  await page.close();
});
