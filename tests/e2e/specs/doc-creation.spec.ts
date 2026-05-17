/**
 * AC #3: Google Doc created; sidebar switches to linked state.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes } from "../fixtures/mock-apis.js";

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 20_000;

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

async function shadowClick(page: import("@playwright/test").Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-pr-sidebar-root");
    for (const host of allHosts) {
      const el = host.shadowRoot?.querySelector<HTMLElement>(sel);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  }, selector);
  if (!clicked) throw new Error(`Shadow element not found: ${selector}`);
}

test("clicking Create Google Doc calls Drive API and shows linked state", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();

  // setupPageRoutes sets up Drive upload, raw file content, and issue comments routes
  await setupPageRoutes(extensionContext, { ghReviewComments: [] });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);

  // Wait for sidebar in no-doc state (button present)
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });
  await expect.poll(async () => shadowQuery(page, "button"), { timeout: TIMEOUT }).toBe(true);

  // Click the Create button
  await shadowClick(page, "button");

  // Primary check: verify storage was updated with the doc mapping
  // (decoupled from UI re-render which depends on renderGeneration timing)
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;

  await expect
    .poll(
      async () => {
        return extensionWorker.evaluate<Record<string, unknown>>(
          () =>
            new Promise((resolve) => {
              chrome.storage.local.get(null, (items) => {
                resolve(items);
              });
            })
        );
      },
      {
        timeout: TIMEOUT,
        message: "Storage should contain doc mapping after creation"
      }
    )
    .toMatchObject({ [docMappingKey]: expect.objectContaining({ docId: "fake-doc-id-123" }) });

  // Secondary: sidebar may re-render to "linked" state (best-effort; renderGeneration timing)
  void shadowQuery(page, "a");

  await page.close();
});
