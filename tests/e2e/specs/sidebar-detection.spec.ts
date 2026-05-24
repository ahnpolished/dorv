/**
 * AC #2: Panel hidden on non-MD PRs; file list shown on MD PRs.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_NON_MD_FILES } from "../fixtures/mock-apis.js";

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 15_000;

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

test("sidebar auto-updates from needs-setup when PAT is stored after load", async ({
  extensionContext,
  seedStorage
}) => {
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });

  // Initially needs-setup (no PAT stored yet)
  await expect
    .poll(async () => shadowQuery(page, ".dorv-needs-setup"), { timeout: TIMEOUT })
    .toBe(true);

  // Simulate onboarding completing in the sidepanel
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });

  // Sidebar should reactively leave the needs-setup state without a page reload
  await expect
    .poll(async () => shadowQuery(page, ".dorv-needs-setup"), { timeout: TIMEOUT })
    .toBe(false);

  await page.close();
});

test("sidebar updates to linked state when doc mapping is stored after load", async ({
  extensionContext,
  seedStorage
}) => {
  await setupPageRoutes(extensionContext);
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });

  // Initially no-doc state (PAT present but no mapping)
  await expect
    .poll(async () => shadowQuery(page, ".dorv-needs-setup"), { timeout: TIMEOUT })
    .toBe(false);

  // Simulate doc creation completing (background writes mapping to storage)
  const mappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    [mappingKey]: {
      repo: TEST_PR.ref,
      prNumber: TEST_PR.prNumber,
      docId: "fake-doc-id-123",
      docUrl: "https://docs.google.com/document/d/fake-doc-id-123/edit",
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      headSha: "abc123",
      latestSha: "abc123",
      isStale: false
    }
  });

  // Sidebar should reactively show the linked state with a GDoc link
  await expect
    .poll(async () => shadowText(page, "a[href*='docs.google.com']"), { timeout: TIMEOUT })
    .toBeTruthy();

  await page.close();
});
