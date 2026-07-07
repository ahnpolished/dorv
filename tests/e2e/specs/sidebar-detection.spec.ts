/**
 * AC #2: Buttons hidden on non-MD PRs; create-doc button shown on MD PRs.
 *
 * v0.3.0 note: the sidepanel-era `dorv-pr-sidebar-root` file-list UI was
 * deleted. The GitHub-side surface is now `github-buttons.content.tsx`,
 * mounted as a `<dorv-gh-buttons>` shadow host that always mounts (once an
 * injection anchor exists) but renders nothing when the PR has no markdown
 * files — there is no more standalone file list, just action buttons.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_NON_MD_FILES } from "../fixtures/mock-apis.js";

const BUTTON_HOST = "dorv-gh-buttons";
const TIMEOUT = 15_000;

async function shadowQuery(
  page: import("@playwright/test").Page,
  selector: string
): Promise<boolean> {
  return page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-gh-buttons");
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
    const allHosts = document.querySelectorAll("dorv-gh-buttons");
    for (const host of allHosts) {
      const el = host.shadowRoot?.querySelector(sel);
      if (el) return el.textContent;
    }
    return null;
  }, selector);
}

test("buttons render nothing when PR has no markdown files", async ({
  extensionContext,
  seedStorage
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await setupPageRoutes(extensionContext, { files: FAKE_NON_MD_FILES });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);

  await page.waitForTimeout(3_000);
  // The host may still mount (idempotent-guard injection doesn't depend on
  // file-fetch results), but it must render no buttons for a non-md PR.
  expect(await shadowQuery(page, "button")).toBe(false);
  await page.close();
});

test("create-doc button shows file count when PR has markdown files", async ({
  extensionContext,
  seedStorage
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });

  // FAKE_MD_FILES (the setupPageRoutes default) has exactly one markdown
  // file, so the button reads "Create linked doc" (singular).
  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Create linked doc");

  await page.close();
});

test("buttons show needs-setup state when no credentials", async ({ extensionContext }) => {
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });

  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Set up dorv");
});

test("buttons auto-update from needs-setup when PAT is stored after load", async ({
  extensionContext,
  seedStorage
}) => {
  await setupPageRoutes(extensionContext);

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });

  // Initially needs-setup (no PAT stored yet)
  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Set up dorv");

  // Simulate onboarding completing in options.html
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });

  // Buttons should reactively leave the needs-setup state without a page reload
  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Create linked doc");

  await page.close();
});

test("buttons update to linked state when doc mapping is stored after load", async ({
  extensionContext,
  seedStorage
}) => {
  await setupPageRoutes(extensionContext);
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });

  // Initially no-doc state (PAT present but no mapping)
  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Create linked doc");

  // Simulate doc creation completing (background writes mapping to storage).
  // v0.3.0: DocMapping.docId/docUrl -> docs: DocFileMapping[].
  const mappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    [mappingKey]: {
      repo: TEST_PR.ref,
      prNumber: TEST_PR.prNumber,
      docs: [
        {
          filename: "docs/rfc.md",
          docId: "fake-doc-id-123",
          docUrl: "https://docs.google.com/document/d/fake-doc-id-123/edit"
        }
      ],
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      headSha: "abc123",
      latestSha: "abc123",
      isStale: false
    }
  });

  // Buttons should reactively show the linked state's "Open doc" button
  // (single-doc mapping renders as a plain button, not an <a> — only
  // multi-doc mappings show a menu of <a href> links).
  await expect
    .poll(async () => shadowText(page, "button"), { timeout: TIMEOUT })
    .toContain("Open doc");

  await page.close();
});
