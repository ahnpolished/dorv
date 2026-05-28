/**
 * Real-credential doc-lifecycle tests.
 *
 * TC-001: Green-field Creation — create Google Doc from a standard Markdown PR
 * TC-009: Mermaid Diagrams — mermaid.ink URL present in exported doc text (skips if no mermaid)
 * TC-008: Large Files — doc creation does not time out on a 1000+ line PR
 *                       (set DORV_LARGE_PR_NUMBER to a PR with large files, else skipped)
 * TC-010: GDoc Pickup — createDoc reuses the existing GDoc when a dorv bot comment is present
 *                       (skips if TC-001 has not yet run for this PR)
 *
 * Side-effect: writes docId + mapping to /tmp/dorv-real-e2e-state.json for
 * downstream spec files (sync.spec.ts, push.spec.ts).
 *
 * Run:  DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-00[1890]"
 */
import {
  test,
  expect,
  openSidepanelOnRealPr,
  exportDriveDocAsText,
  buildRealCreateDocInput,
  createDocViaExtension,
  hasRequiredGoogleScopes,
  fetchPrIssueComments,
  REAL_REPO,
  REAL_PR_NUMBER
} from "./fixture.js";
import { readStateForPr, writeStateForPr } from "./state.js";

const DOC_STORE_KEY = `docStore:${REAL_REPO}#${REAL_PR_NUMBER.toString()}`;

test.describe("doc lifecycle", () => {
  test("TC-001: creates Google Doc from real PR and stores mapping", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(
      !(await hasRequiredGoogleScopes()),
      "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to create live docs"
    );

    // Idempotency: if a doc was already created in a prior run, reuse it
    const existingState = readStateForPr(REAL_REPO, REAL_PR_NUMBER);
    if (existingState.docId) {
      if (!existingState.docStoreKey || !existingState.docMapping) {
        throw new Error("State file has docId but is missing doc mapping metadata");
      }
      console.log(`[TC-001] Reusing existing doc: ${existingState.docId}`);
      return;
    }

    const input = await buildRealCreateDocInput();
    const result = await createDocViaExtension(extensionContext, extensionId, input);

    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );

    const mapping = storage[DOC_STORE_KEY] as
      | {
          docId?: string;
          docUrl?: string;
          repo?: string;
          prNumber?: number;
        }
      | undefined;

    expect(mapping, "doc mapping must be saved to storage").toBeDefined();
    expect(mapping?.docId, "mapping must have a docId").toBeTruthy();
    expect(mapping?.docUrl, "mapping must have a docUrl").toMatch(/docs\.google\.com/);
    expect(mapping?.docId).toBe(result.mapping.docId);

    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);
    await expect(panel.locator(".tabs")).toBeVisible({ timeout: 30_000 });

    // Verify tabs are visible (TC-001 step 5)
    await expect(panel.locator("button", { hasText: "GitHub" })).toBeVisible();
    await expect(panel.locator("button", { hasText: "Google Doc" })).toBeVisible();
    await expect(panel.locator("button", { hasText: "PR Info" })).toBeVisible();

    const docId = mapping?.docId;
    const docUrl = mapping?.docUrl;
    if (!docId || !docUrl) {
      throw new Error("doc mapping was missing docId or docUrl after creation");
    }

    // Persist for downstream spec files
    writeStateForPr(REAL_REPO, REAL_PR_NUMBER, {
      docId,
      docUrl,
      docStoreKey: DOC_STORE_KEY,
      docMapping: storage[DOC_STORE_KEY] as Record<string, unknown>
    });

    await panel.close();
  });

  test("TC-009: mermaid blocks become mermaid.ink image URLs in exported doc", async ({
    extensionWorker
  }) => {
    test.skip(
      !(await hasRequiredGoogleScopes()),
      "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to read live docs"
    );

    const state = readStateForPr(REAL_REPO, REAL_PR_NUMBER);
    if (!state.docId) {
      test.skip(true, "Run TC-001 first to create the doc");
      return;
    }

    const docText = await exportDriveDocAsText(state.docId);
    const hasMermaid = docText.includes("mermaid.ink");
    if (!hasMermaid) {
      // If the test PR has no mermaid blocks, this TC is not applicable
      // Soft assertion: at minimum the doc export succeeded
      expect(docText.length, "doc export must return non-empty text").toBeGreaterThan(0);
      console.log(
        "[TC-009] Test PR has no mermaid blocks — doc export verified but mermaid.ink check skipped"
      );
      return;
    }

    // Verify the mermaid.ink pattern
    expect(docText).toMatch(/https:\/\/mermaid\.ink\/img\//);

    // Also confirm doc mapping exists in storage
    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    expect(storage[DOC_STORE_KEY], "doc mapping must still be in storage").toBeDefined();
  });

  test("TC-008: doc creation does not time out on a large-file PR", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(
      !(await hasRequiredGoogleScopes()),
      "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes to create live docs"
    );

    const largePrNumber = process.env.DORV_LARGE_PR_NUMBER
      ? parseInt(process.env.DORV_LARGE_PR_NUMBER, 10)
      : undefined;

    if (!largePrNumber) {
      test.skip(true, "Set DORV_LARGE_PR_NUMBER env var to a PR with 1000+ line files");
      return;
    }

    const largePrRepo = process.env.DORV_LARGE_PR_REPO ?? REAL_REPO;
    const largeDocStoreKey = `docStore:${largePrRepo}#${largePrNumber.toString()}`;

    const panel = await openSidepanelOnRealPr(extensionContext, extensionId);

    const createBtn = panel.locator("button.onboarding-btn", { hasText: /Create Google Doc/ });

    // Allow extra time for large files
    await expect(createBtn).toBeVisible({ timeout: 30_000 });
    const startMs = Date.now();
    await createBtn.click();
    await expect(createBtn).not.toBeVisible({ timeout: 90_000 });
    const elapsed = Date.now() - startMs;

    // Creation must complete under the 90 s timeout (soft assertion: warn if > 30 s)
    console.log(`[TC-008] Large-file doc created in ${elapsed.toString()} ms`);

    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    const mapping = storage[largeDocStoreKey] as { docId?: string } | undefined;
    expect(mapping?.docId, "large-file doc must have a docId").toBeTruthy();

    await panel.close();
  });

  test("TC-010: reuses existing GDoc from bot comment without creating a new Drive file", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(!(await hasRequiredGoogleScopes()), "DORV_GOOGLE_TOKEN must include Drive scopes");

    // Find existing dorv bot comments on the PR before calling createDoc.
    // TC-001 must have run at least once to post the initial bot comment.
    const commentBodies = await fetchPrIssueComments();
    const botComments = commentBodies.filter(
      (b) => b.includes("<!-- dorv-doc-id=") || b.includes("**dorv**")
    );

    if (botComments.length === 0) {
      test.skip(true, "No dorv bot comment found — run TC-001 first to create the initial GDoc");
      return;
    }

    // Extract all docIds referenced by existing bot comments so we can verify pickup.
    const existingDocIds = new Set(
      botComments
        .map((b) => {
          const markerMatch = /<!--\s*dorv-doc-id=([a-zA-Z0-9_-]+)\s*-->/.exec(b);
          if (markerMatch?.[1]) return markerMatch[1];
          const urlMatch = /\/document\/d\/([a-zA-Z0-9_-]+)/.exec(b);
          return urlMatch?.[1];
        })
        .filter((id): id is string => Boolean(id))
    );

    // Clear storage mapping so createDoc sees no locally-cached doc
    await extensionWorker.evaluate((key: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], resolve);
      });
    }, DOC_STORE_KEY);

    // Count bot comments before createDoc — pickup must not post a new one
    const commentCountBefore = botComments.length;

    const input = await buildRealCreateDocInput();
    const result = await createDocViaExtension(extensionContext, extensionId, input);

    // The returned docId must be one of the pre-existing bot comment docIds
    expect(
      existingDocIds.has(result.mapping.docId),
      `expected picked-up docId (${result.mapping.docId}) to match an existing bot comment; ` +
        `known ids: ${[...existingDocIds].join(", ")}`
    ).toBe(true);
    expect(result.mapping.docUrl).toMatch(/docs\.google\.com/);

    // Verify mapping was persisted to extension storage
    const storageAfter = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    const mapping = storageAfter[DOC_STORE_KEY] as { docId?: string } | undefined;
    expect(mapping?.docId).toBe(result.mapping.docId);

    // No new bot comment must have been posted
    const commentBodiesAfter = await fetchPrIssueComments();
    const botCommentsAfter = commentBodiesAfter.filter(
      (b) => b.includes("<!-- dorv-doc-id=") || b.includes("**dorv**")
    );
    expect(botCommentsAfter.length, "pickup must not post a new bot comment").toBe(
      commentCountBefore
    );
  });
});
