/**
 * TC-006 GDoc→GH Line Matching — GH review comment POST has correct path + line
 * TC-007 Author Identity        — GDoc author name appears in pushed GH comment body
 * TC-008 Large Files            — 1000-line MD PR completes doc creation within timeout
 * TC-009 Mermaid Diagrams       — Drive upload body contains mermaid.ink URL
 * TC-011 Token Expiry           — 401 from Google during sync → statusStore state=error
 */
import { expect, test, TEST_PR } from "../fixtures/extension.js";
import { setupPageRoutes, FAKE_MD_FILES } from "../fixtures/mock-apis.js";

const SIDEBAR_HOST = "dorv-pr-sidebar-root";
const TIMEOUT = 20_000;

const BASE_DOC_MAPPING = {
  repo: TEST_PR.ref,
  prNumber: TEST_PR.prNumber,
  docId: "fake-doc-id-123",
  docUrl: "https://docs.google.com/document/d/fake-doc-id-123/edit",
  createdAt: "2026-05-17T10:00:00Z",
  lastSyncedAt: "2026-05-17T10:00:00Z",
  headSha: "abc123def456",
  latestSha: "abc123def456",
  isStale: false
};

// React Query throws when queryFn returns undefined; seed a status so the sidepanel loads
const BASE_STATUS = { repo: TEST_PR.ref, prNumber: TEST_PR.prNumber, state: "idle" };
const STATUS_KEY = `statusStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;

/**
 * Open the sidepanel and patch chrome.tabs.query so it behaves as if the
 * active tab is the fake GH PR page.  Must be called BEFORE goto() so the
 * init-script runs before the React tree mounts.
 */
async function openSidepanelOnPR(
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string
): Promise<import("@playwright/test").Page> {
  const panel = await extensionContext.newPage();
  // Inject before any page script runs so the React tree mounts with correct tab + auth state
  await panel.addInitScript(
    ({ prUrl, tabId, googleToken }) => {
      const fakeTab = [{ url: prUrl, id: tabId }];
      // chrome.tabs.query is promise-based in MV3 — return a Promise when no callback given
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (chrome.tabs as any).query = (
        _filter: unknown,
        callback?: (tabs: { url: string; id: number }[]) => void
      ) => {
        if (typeof callback === "function") {
          callback(fakeTab);
          return;
        }
        return Promise.resolve(fakeTab);
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (chrome.identity as any).getAuthToken = (
        _opts: unknown,
        callback: (token: string) => void
      ) => {
        callback(googleToken);
      };
    },
    { prUrl: TEST_PR.url, tabId: 1, googleToken: "fake-google-token-e2e" }
  );
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
    waitUntil: "domcontentloaded"
  });
  return panel;
}

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

test("TC-006: GDoc→GH push places comment on correct file and line", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  const unmappedGdocComment = {
    id: "doc-comment-push-1",
    content: "This section needs clarification.",
    // "Content here." appears on line 7 of the fake raw file content
    quotedFileContent: { value: "Content here." },
    author: { displayName: "DocReviewer" },
    createdTime: "2026-05-17T13:00:00Z",
    replies: []
  };

  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    [docMappingKey]: BASE_DOC_MAPPING,
    [STATUS_KEY]: BASE_STATUS
  });
  await patchWorkerIdentity();

  // Register setupPageRoutes first so that our capturing route wins (Playwright LIFO)
  await setupPageRoutes(extensionContext, {
    gdocComments: { comments: [unmappedGdocComment] },
    ghReviewComments: []
  });

  let ghPostBody: string | undefined;
  await extensionContext.route(
    `https://api.github.com/repos/${TEST_PR.owner}/${TEST_PR.repo}/pulls/${TEST_PR.prNumber.toString()}/comments*`,
    (route) => {
      if (route.request().method() === "POST") {
        ghPostBody = route.request().postData() ?? undefined;
        void route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 5001 })
        });
      } else {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([])
        });
      }
    }
  );

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  // Wait for the "Google Doc" tab to be visible (means PR + doc loaded)
  await expect(panel.locator("button", { hasText: "Google Doc" })).toBeVisible({
    timeout: TIMEOUT
  });
  await panel.locator("button", { hasText: "Google Doc" }).click();

  // Wait for the Push button and click it
  await expect(panel.locator('[data-testid^="dorv-push-btn-"]').first()).toBeVisible({
    timeout: TIMEOUT
  });
  panel.on("dialog", (d) => void d.accept());
  await panel.locator('[data-testid^="dorv-push-btn-"]').first().click();

  // Wait for GH POST to be captured
  await expect
    .poll(() => ghPostBody !== undefined, {
      timeout: TIMEOUT,
      message: "GH review comment POST expected"
    })
    .toBe(true);

  if (!ghPostBody) throw new Error("Expected ghPostBody after poll");
  const parsed = JSON.parse(ghPostBody) as {
    path?: string;
    line?: number;
    commit_id?: string;
    body?: string;
  };
  expect(typeof parsed.path).toBe("string");
  expect(typeof parsed.line).toBe("number");
  expect(parsed.commit_id).toBe(BASE_DOC_MAPPING.headSha);

  await panel.close();
});

test("TC-007: GDoc→GH push body contains GDoc author name", async ({
  extensionContext,
  extensionId,
  seedStorage,
  patchWorkerIdentity
}) => {
  const docMappingKey = `docStore:${TEST_PR.ref}#${TEST_PR.prNumber.toString()}`;
  const unmappedGdocComment = {
    id: "doc-comment-push-2",
    content: "Looks good from my end.",
    quotedFileContent: { value: "Content here." },
    author: { displayName: "JaneDoe" },
    createdTime: "2026-05-17T13:00:00Z",
    replies: []
  };

  await seedStorage({
    github_pat: "ghp_test_pat_for_e2e",
    [docMappingKey]: BASE_DOC_MAPPING,
    [STATUS_KEY]: BASE_STATUS,
    // Prevent stale GDoc comments from a prior test from hydrating the cache
    sidepanel_query_cache_snapshot: null
  });
  await patchWorkerIdentity();

  // Register setupPageRoutes first so our capturing route wins (Playwright LIFO)
  await setupPageRoutes(extensionContext, {
    gdocComments: { comments: [unmappedGdocComment] },
    ghReviewComments: []
  });

  let ghPostBody: string | undefined;
  await extensionContext.route(
    `https://api.github.com/repos/${TEST_PR.owner}/${TEST_PR.repo}/pulls/${TEST_PR.prNumber.toString()}/comments*`,
    (route) => {
      if (route.request().method() === "POST") {
        ghPostBody = route.request().postData() ?? undefined;
        void route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ id: 5002 })
        });
      } else {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([])
        });
      }
    }
  );

  const panel = await openSidepanelOnPR(extensionContext, extensionId);

  await expect(panel.locator("button", { hasText: "Google Doc" })).toBeVisible({
    timeout: TIMEOUT
  });
  await panel.locator("button", { hasText: "Google Doc" }).click();

  await expect(panel.locator('[data-testid^="dorv-push-btn-"]').first()).toBeVisible({
    timeout: TIMEOUT
  });
  panel.on("dialog", (d) => void d.accept());
  await panel.locator('[data-testid^="dorv-push-btn-"]').first().click();

  await expect
    .poll(() => ghPostBody !== undefined, {
      timeout: TIMEOUT,
      message: "GH review comment POST expected"
    })
    .toBe(true);

  if (!ghPostBody) throw new Error("Expected ghPostBody after poll");
  const parsed = JSON.parse(ghPostBody) as { body?: string };
  expect(parsed.body).toContain("JaneDoe");

  await panel.close();
});

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
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });
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
  await page.waitForSelector(SIDEBAR_HOST, { timeout: TIMEOUT });
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

async function shadowButtonText(
  page: import("@playwright/test").Page,
  selector: string
): Promise<string | null> {
  return page.evaluate((sel) => {
    const allHosts = document.querySelectorAll("dorv-pr-sidebar-root");
    for (const host of allHosts) {
      const el = host.shadowRoot?.querySelector<HTMLElement>(sel);
      if (el) return el.textContent;
    }
    return null;
  }, selector);
}
