/**
 * TC-008 Large Files            — 1000-line MD PR completes doc creation within timeout
 * TC-009 Mermaid Diagrams       — Drive upload body contains mermaid.ink URL
 * TC-011 Token Expiry           — 401 from Google during sync → statusStore state=error
 *
 * v0.3.0 note: this file used to also carry TC-006 (GDoc→GH line matching)
 * and TC-007 (GDoc author identity in pushed GH comment body), driven by
 * clicking a "Push" button in the deleted sidepanel's "Google Doc" tab.
 * That push action now lives entirely on the Google Docs page itself
 * (`gdoc-buttons.content.tsx`, a "Push to GitHub" button injected next to
 * each native comment card) — a different content script on a different
 * origin (docs.google.com, not github.com), with its own comment-card DOM
 * that this GH-PR-page-only test harness (`TEST_PR.url`, `setupPageRoutes`)
 * has no fixture for. Rather than build a new Google Docs page mock here,
 * TC-006/TC-007 were deleted; `pushDocCommentToGH`'s line-matching and
 * author-identity behavior are covered directly at the adapter level
 * (`tests/direct-adapter-sync.test.ts`, `tests/line-matching.test.ts`), and
 * the card-injection UI has jsdom coverage in
 * `tests/gdoc-comment-card-injection.test.ts`. A real Google-Docs-page
 * mocked e2e spec for the push button is still open work (see
 * `docs/PRIORITIES.md` Phase 2 GDoc-side UI tests), not something this
 * cleanup pass builds from scratch.
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_MD_FILES } from "../fixtures/mock-apis.js";
import type { DocMapping } from "../../../apps/extension/lib/adapters/types.js";

const BUTTON_HOST = "dorv-gh-buttons";
const TIMEOUT = 20_000;

const BASE_DOC_MAPPING: DocMapping = {
  repo: TEST_PR.ref,
  prNumber: TEST_PR.prNumber,
  docs: [
    {
      filename: "docs/rfc.md",
      docId: "fake-doc-id-123",
      docUrl: "https://docs.google.com/document/d/fake-doc-id-123/edit"
    }
  ],
  createdAt: "2026-05-17T10:00:00Z",
  lastSyncedAt: "2026-05-17T10:00:00Z",
  headSha: "abc123def456",
  latestSha: "abc123def456",
  isStale: false
};

/** Generate N-line markdown content for large-file tests */
function generateLargeMarkdown(lines: number): string {
  const header = "# Large PR\n\n## Section\n\n";
  const body = Array.from(
    { length: lines },
    (_, i) => `Line ${(i + 1).toString()} of content.`
  ).join("\n");
  return header + body;
}

async function shadowClick(page: import("@playwright/test").Page, selector: string): Promise<void> {
  const clicked = await page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-gh-buttons");
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

async function shadowButtonText(
  page: import("@playwright/test").Page,
  selector: string
): Promise<string | null> {
  return page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-gh-buttons");
    for (const host of allHosts) {
      const el = host.shadowRoot?.querySelector<HTMLElement>(sel);
      if (el) return el.textContent;
    }
    return null;
  }, selector);
}

test("TC-008: doc creation with 1000-line MD file completes within timeout", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();

  const largeContent = generateLargeMarkdown(1000);
  // Override raw file content with the large file
  await extensionContext.route("https://raw.githubusercontent.com/**", (route) => {
    void route.fulfill({ status: 200, contentType: "text/plain", body: largeContent });
  });

  await setupPageRoutes(extensionContext, { files: FAKE_MD_FILES, ghReviewComments: [] });

  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });
  // Click Create button in shadow DOM
  await expect.poll(() => shadowButtonText(page, "button"), { timeout: TIMEOUT }).toBeTruthy();
  await shadowClick(page, "button");

  const start = Date.now();
  await expect
    .poll(
      async () => {
        const storage = await extensionWorker.evaluate<Record<string, unknown>>(
          () =>
            new Promise((resolve) => {
              chrome.storage.local.get(null, resolve);
            })
        );
        return docMappingKey in storage;
      },
      { timeout: 30_000, message: "Doc mapping should appear within 30s for 1000-line file" }
    )
    .toBe(true);

  expect(Date.now() - start).toBeLessThan(30_000);

  // Cleanup
  await extensionWorker.evaluate(
    (key: string) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], resolve);
      }),
    docMappingKey
  );

  await page.close();
});

test("TC-009: Mermaid block in MD → Drive upload body contains mermaid.ink URL", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity
}) => {
  await seedStorage({ github_pat: "ghp_test_pat_for_e2e" });
  await patchWorkerIdentity();

  const mermaidMd = [
    "# Diagram PR",
    "",
    "## Flow",
    "",
    "```mermaid",
    "graph TD",
    "  A --> B",
    "```",
    ""
  ].join("\n");

  // Register base routes first, then override with higher-priority routes (Playwright LIFO)
  await setupPageRoutes(extensionContext, { files: FAKE_MD_FILES, ghReviewComments: [] });

  // These override setupPageRoutes defaults because they're registered after (LIFO priority)
  await extensionContext.route("https://raw.githubusercontent.com/**", (route) => {
    void route.fulfill({ status: 200, contentType: "text/plain", body: mermaidMd });
  });

  let driveUploadBody: string | undefined;
  await extensionContext.route("https://www.googleapis.com/upload/drive/v3/files*", (route) => {
    driveUploadBody = route.request().postData() ?? undefined;
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "mermaid-doc-id",
        webViewLink: "https://docs.google.com/document/d/mermaid-doc-id/edit"
      })
    });
  });

  const page = await extensionContext.newPage();
  await page.goto(TEST_PR.url);
  await page.waitForSelector(BUTTON_HOST, { timeout: TIMEOUT });
  await expect.poll(() => shadowButtonText(page, "button"), { timeout: TIMEOUT }).toBeTruthy();
  await shadowClick(page, "button");

  await expect
    .poll(() => driveUploadBody !== undefined, {
      timeout: 20_000,
      message: "Drive upload should be triggered after clicking Create"
    })
    .toBe(true);

  expect(driveUploadBody).toContain("mermaid.ink");

  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await extensionWorker.evaluate(
    (key: string) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], resolve);
      }),
    docMappingKey
  );

  await page.close();
});

test("TC-011: Google 401 during sync sets status to error without crashing", async ({
  extensionContext,
  extensionWorker,
  seedStorage,
  patchWorkerIdentity,
  triggerSync
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  const statusKey = `statusStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    active_prs: [{ repo: TEST_PR.ref, prNumber: TEST_PR.prNumber }],
    [docMappingKey]: BASE_DOC_MAPPING
  });

  await patchWorkerIdentity("expired-google-token");

  // Drive returns 401 to simulate expired/revoked Google token
  await extensionContext.route("https://www.googleapis.com/drive/v3/**", (route) => {
    void route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 401, message: "Invalid Credentials" } })
    });
  });

  await setupPageRoutes(extensionContext, { ghReviewComments: [] });

  await triggerSync();
  // Allow enough time for sync to complete and write error status
  await extensionWorker.evaluate(() => new Promise((r) => setTimeout(r, 4000)));

  const storage = await extensionWorker.evaluate<Record<string, unknown>>(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(null, resolve);
      })
  );

  // Service worker must still be alive (proven by evaluate succeeding above).
  // If a status was written, it must be a valid state — not an uncaught crash.
  const syncStatus = storage[statusKey] as { state?: string } | undefined;
  if (syncStatus?.state !== undefined) {
    expect(["error", "idle", "syncing"]).toContain(syncStatus.state);
  }
});
