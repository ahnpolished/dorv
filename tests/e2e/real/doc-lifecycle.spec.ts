/**
 * Real-credential doc-lifecycle tests.
 *
 * TC-001: Green-field Creation — create Google Doc from a standard Markdown PR
 * TC-009: Mermaid Diagrams — mermaid.ink URL present in exported doc text (skips if no mermaid)
 * TC-008: Large Files — doc creation does not time out on a 1000+ line PR
 *                       (set DORV_LARGE_PR_NUMBER to a PR with large files, else skipped)
 * TC-010: GDoc Pickup — createDoc reuses the existing GDoc when a dorv bot comment is present
 *                       (skips if TC-001 has not yet run for this PR)
 * TC-011: Green-field  — createDoc creates a new GDoc and posts a bot comment with the hidden
 *                       marker when no prior bot comment exists on the PR.
 *                       Requires DORV_GREEN_FIELD_PR_NUMBER (a PR with ≥1 md file and no
 *                       existing dorv bot comments, or one that tolerates comment deletion).
 *
 * Side-effect: writes docId + mapping to /tmp/dorv-real-e2e-state.json for
 * downstream spec files (sync.spec.ts, push.spec.ts).
 *
 * Run:  DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-00[1890]"
 * Run TC-011: DORV_GREEN_FIELD_PR_NUMBER=<pr> pnpm e2e:real --grep "TC-011"
 */
import {
  test,
  expect,
  exportDriveDocAsText,
  buildRealCreateDocInput,
  createDocViaExtension,
  hasRequiredGoogleScopes,
  fetchPrIssueComments,
  fetchPrIssueCommentsWithIds,
  deleteGhIssueComment,
  GITHUB_PAT,
  REAL_REPO,
  REAL_PR_NUMBER
} from "./fixture.js";
import { readStateForPr, writeStateForPr } from "./state.js";
import type { DocMapping } from "../../../apps/extension/lib/adapters/types.js";
import {
  extractDocsFromBotComment,
  buildDocsMarker
} from "../../../apps/extension/lib/gdoc/urls.js";

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

    // createDocViaExtension already drives doc creation through the
    // extension's message-passing API (CREATE_DOC), the same code path the
    // new button-injection UI uses — no UI interaction is needed here.
    const input = await buildRealCreateDocInput();
    const result = await createDocViaExtension(extensionContext, extensionId, input);

    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );

    const mapping = storage[DOC_STORE_KEY] as DocMapping | undefined;

    expect(mapping, "doc mapping must be saved to storage").toBeDefined();
    expect(Array.isArray(mapping?.docs), "mapping must have a docs array").toBe(true);
    expect(mapping?.docs.length, "mapping must have at least one doc").toBeGreaterThan(0);
    for (const doc of mapping?.docs ?? []) {
      expect(doc.docId, `doc for ${doc.filename} must have a docId`).toBeTruthy();
      expect(doc.docUrl, `doc for ${doc.filename} must have a docUrl`).toMatch(/docs\.google\.com/);
    }
    expect(mapping?.docs.map((d) => d.docId).sort()).toEqual(
      result.mapping.docs.map((d) => d.docId).sort()
    );

    // The test PR (see fixture.ts REAL_PR_NUMBER default) has exactly one
    // markdown file, so mapping.docs[0] is "the" doc for downstream specs.
    const firstDoc = result.mapping.docs[0];
    if (!firstDoc) {
      throw new Error("doc mapping was missing docs after creation");
    }

    // Persist for downstream spec files
    writeStateForPr(REAL_REPO, REAL_PR_NUMBER, {
      docId: firstDoc.docId,
      docUrl: firstDoc.docUrl,
      docStoreKey: DOC_STORE_KEY,
      docMapping: storage[DOC_STORE_KEY] as Record<string, unknown>
    });
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

    const prResp = await fetch(
      `https://api.github.com/repos/${largePrRepo}/pulls/${largePrNumber.toString()}`,
      { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github+json" } }
    );
    if (!prResp.ok) {
      test.skip(true, `Could not fetch PR #${largePrNumber.toString()} from ${largePrRepo}`);
      return;
    }
    const prData = (await prResp.json()) as {
      head: { sha: string; ref: string };
      html_url: string;
      title: string;
      user?: { login?: string };
    };
    const filesResp = await fetch(
      `https://api.github.com/repos/${largePrRepo}/pulls/${largePrNumber.toString()}/files`,
      { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github+json" } }
    );
    const filesData = filesResp.ok
      ? ((await filesResp.json()) as { filename?: unknown; raw_url?: unknown; status?: unknown }[])
      : [];
    const files = filesData
      .filter(
        (f): f is { filename: string; raw_url: string; status: string } =>
          typeof f.filename === "string" &&
          typeof f.raw_url === "string" &&
          typeof f.status === "string" &&
          /\.mdx?$/iu.test(f.filename)
      )
      .map((f) => ({ filename: f.filename, rawUrl: f.raw_url, status: f.status }));
    if (files.length === 0) {
      test.skip(true, `PR #${largePrNumber.toString()} has no markdown files`);
      return;
    }
    const input = {
      repo: largePrRepo,
      prNumber: largePrNumber,
      title: prData.title,
      author: prData.user?.login ?? "unknown",
      branch: prData.head.ref,
      headSha: prData.head.sha,
      prUrl: prData.html_url,
      files
    };

    // Time the createDocViaExtension call itself — there is no UI button to
    // click-and-wait-for-disappearance anymore, so the elapsed time around
    // the message round-trip is the equivalent large-file timing signal.
    const startMs = Date.now();
    const result = await createDocViaExtension(extensionContext, extensionId, input);
    const elapsed = Date.now() - startMs;

    // Creation must complete well under a reasonable timeout (soft assertion: log if > 30s)
    console.log(`[TC-008] Large-file doc created in ${elapsed.toString()} ms`);
    expect(elapsed, "large-file doc creation must complete within 90s").toBeLessThan(90_000);
    expect(result.mapping.docs.length).toBeGreaterThan(0);

    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    const mapping = storage[largeDocStoreKey] as DocMapping | undefined;
    expect(mapping?.docs.length, "large-file doc must have at least one doc").toBeGreaterThan(0);
  });

  test("TC-010: reuses existing GDoc from bot comment without creating a new Drive file", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(!(await hasRequiredGoogleScopes()), "DORV_GOOGLE_TOKEN must include Drive scopes");

    // Find existing dorv bot comments on the PR before calling createDoc.
    // TC-001 must have run at least once to post the initial bot comment.
    // extractDocsFromBotComment understands both the current multi-doc
    // marker (`<!-- dorv-docs={...} -->`) and the legacy single-doc marker,
    // so this picks up bot comments left by either shape.
    const commentBodies = await fetchPrIssueComments();
    const botComments = commentBodies.filter((b) => extractDocsFromBotComment(b) !== undefined);

    if (botComments.length === 0) {
      test.skip(true, "No dorv bot comment found — run TC-001 first to create the initial GDoc");
      return;
    }

    // Extract all docIds referenced by existing bot comments so we can verify pickup.
    const existingDocIds = new Set(
      botComments.flatMap((b) => (extractDocsFromBotComment(b) ?? []).map((d) => d.docId))
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

    // Every doc in the returned mapping must be one of the pre-existing bot comment docIds
    for (const doc of result.mapping.docs) {
      expect(
        existingDocIds.has(doc.docId),
        `expected picked-up docId (${doc.docId}) to match an existing bot comment; ` +
          `known ids: ${[...existingDocIds].join(", ")}`
      ).toBe(true);
      expect(doc.docUrl).toMatch(/docs\.google\.com/);
    }

    // Verify mapping was persisted to extension storage
    const storageAfter = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    const mapping = storageAfter[DOC_STORE_KEY] as DocMapping | undefined;
    expect(mapping?.docs.map((d) => d.docId).sort()).toEqual(
      result.mapping.docs.map((d) => d.docId).sort()
    );

    // No new bot comment must have been posted
    const commentBodiesAfter = await fetchPrIssueComments();
    const botCommentsAfter = commentBodiesAfter.filter(
      (b) => extractDocsFromBotComment(b) !== undefined
    );
    expect(botCommentsAfter.length, "pickup must not post a new bot comment").toBe(
      commentCountBefore
    );
  });

  test("TC-011: green-field creates new GDoc and posts bot comment with hidden marker", async ({
    extensionContext,
    extensionId,
    extensionWorker
  }) => {
    test.skip(!(await hasRequiredGoogleScopes()), "DORV_GOOGLE_TOKEN must include Drive scopes");

    const gfPrNumber = process.env.DORV_GREEN_FIELD_PR_NUMBER
      ? parseInt(process.env.DORV_GREEN_FIELD_PR_NUMBER, 10)
      : undefined;

    if (!gfPrNumber) {
      test.skip(true, "Set DORV_GREEN_FIELD_PR_NUMBER to a PR with ≥1 markdown file");
      return;
    }

    const gfDocStoreKey = `docStore:${REAL_REPO}#${gfPrNumber.toString()}`;

    // Delete any existing dorv bot comments so this is truly green-field
    const existingComments = await fetchPrIssueCommentsWithIds(gfPrNumber);
    const existingBotComments = existingComments.filter(
      (c) => extractDocsFromBotComment(c.body) !== undefined
    );
    for (const c of existingBotComments) {
      await deleteGhIssueComment(c.id);
    }

    // Clear any stored mapping for this PR
    await extensionWorker.evaluate((key: string) => {
      return new Promise<void>((resolve) => {
        chrome.storage.local.remove([key], resolve);
      });
    }, gfDocStoreKey);

    // Build input for the green-field PR (fetched directly rather than via
    // fetchRealPrMeta/fetchRealMarkdownFiles, which are cached against
    // REAL_PR_NUMBER, not gfPrNumber).

    const prResp = await fetch(
      `https://api.github.com/repos/${REAL_REPO}/pulls/${gfPrNumber.toString()}`,
      { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github+json" } }
    );
    if (!prResp.ok) {
      test.skip(true, `Could not fetch PR #${gfPrNumber.toString()}`);
      return;
    }
    const prData = (await prResp.json()) as {
      head: { sha: string; ref: string };
      html_url: string;
      title: string;
      user?: { login?: string };
    };
    const filesResp = await fetch(
      `https://api.github.com/repos/${REAL_REPO}/pulls/${gfPrNumber.toString()}/files`,
      { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github+json" } }
    );
    const filesData = filesResp.ok
      ? ((await filesResp.json()) as { filename?: unknown; raw_url?: unknown; status?: unknown }[])
      : [];
    const files = filesData
      .filter(
        (f): f is { filename: string; raw_url: string; status: string } =>
          typeof f.filename === "string" &&
          typeof f.raw_url === "string" &&
          typeof f.status === "string" &&
          /\.mdx?$/iu.test(f.filename)
      )
      .map((f) => ({ filename: f.filename, rawUrl: f.raw_url, status: f.status }));

    if (files.length === 0) {
      test.skip(true, `PR #${gfPrNumber.toString()} has no markdown files`);
      return;
    }

    const input = {
      repo: REAL_REPO,
      prNumber: gfPrNumber,
      title: prData.title,
      author: prData.user?.login ?? "unknown",
      branch: prData.head.ref,
      headSha: prData.head.sha,
      prUrl: prData.html_url,
      files
    };

    const result = await createDocViaExtension(extensionContext, extensionId, input);

    // A fresh Drive doc must have been created for every markdown file
    expect(result.mapping.docs.length).toBe(files.length);
    for (const doc of result.mapping.docs) {
      expect(doc.docId, "new doc must have an id").toBeTruthy();
      expect(doc.docUrl).toMatch(/docs\.google\.com/);
    }

    // Mapping must be in extension storage
    const storage = await extensionWorker.evaluate<Record<string, unknown>>(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(null, resolve);
        })
    );
    const stored = storage[gfDocStoreKey] as DocMapping | undefined;
    expect(stored?.docs.map((d) => d.docId).sort()).toEqual(
      result.mapping.docs.map((d) => d.docId).sort()
    );

    // Bot comment must have been posted and must carry the new multi-doc marker
    const postedComments = await fetchPrIssueCommentsWithIds(gfPrNumber);
    const botComment = postedComments.find(
      (c) => c.body.includes("<!-- dorv-docs=") && c.body.includes("**dorv**")
    );
    expect(botComment, "bot comment with hidden marker must be posted").toBeDefined();
    expect(botComment?.body).toContain(buildDocsMarker(result.mapping.docs));
    for (const doc of result.mapping.docs) {
      expect(botComment?.body).toContain(doc.docUrl);
    }
  });
});
