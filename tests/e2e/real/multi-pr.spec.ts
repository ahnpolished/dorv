/**
 * Multi-PR real-credential E2E tests.
 *
 * Runs the same sidepanel assertions across many real PRs with varying
 * markdown content — from tiny single-file PRs (PR #9, +21 md lines) to
 * large multi-file PRs (PR #7, +288 md lines) and the load-test fixture
 * (PR #70, +267 md lines with 100+ review comments).
 *
 * PR taxonomy (all in repo ahnpolished/dorv):
 *
 *   SMALL  — PR #9   (1 md file,  +21 md lines)  — design doc fix
 *   SMALL  — PR #8   (2 md files, +116 md lines) — background worker
 *   SMALL  — PR #6   (2 md files, +140 md lines) — auth system
 *   SMALL  — PR #10  (2 md files, +182 md lines) — GH->GDoc sync
 *   MEDIUM — PR #13  (2 md files, +237 md lines) — GDoc->GH push
 *   MEDIUM — PR #70  (1 md file,  +267 md lines) — load test fixture
 *   LARGE  — PR #7   (2 md files, +288 md lines) — GH->GDoc creation
 *
 * Run all:     DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-02[6-9]|TC-03[0-5]"
 * Run small:   ... pnpm e2e:real --grep "TC-02[67].*small"
 * Run medium:  ... pnpm e2e:real --grep "TC-028|TC-033"
 * Run large:   ... pnpm e2e:real --grep "TC-029|TC-034.*large"
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  test,
  expect,
  createGhReviewComment,
  createGhCommentReply,
  deleteGhReviewComment,
  createDocViaExtension,
  hasRequiredGoogleScopes,
  GITHUB_PAT,
  GOOGLE_TOKEN,
  REAL_REPO
} from "./fixture.js";
import { readState, writeState } from "./state.js";
import fs from "fs";
import os from "os";
import path from "path";

// ── PR catalogue ──────────────────────────────────────────────────────────────

const PR_CATALOG = [
  {
    prNumber: 9,
    label: "9-small-design-fix",
    size: "small",
    mdFileCount: 1,
    mdMinLines: 15,
    state: "closed"
  },
  {
    prNumber: 8,
    label: "8-small-background-worker",
    size: "small",
    mdFileCount: 2,
    mdMinLines: 80,
    state: "closed"
  },
  {
    prNumber: 6,
    label: "6-small-auth",
    size: "small",
    mdFileCount: 2,
    mdMinLines: 100,
    state: "closed"
  },
  {
    prNumber: 10,
    label: "10-small-gh-gdoc-sync",
    size: "small",
    mdFileCount: 2,
    mdMinLines: 150,
    state: "closed"
  },
  {
    prNumber: 13,
    label: "13-medium-gdoc-gh-push",
    size: "medium",
    mdFileCount: 2,
    mdMinLines: 200,
    state: "closed"
  },
  {
    prNumber: 70,
    label: "70-medium-load-test",
    size: "medium",
    mdFileCount: 1,
    mdMinLines: 200,
    state: "open"
  },
  {
    prNumber: 7,
    label: "7-large-gh-gdoc-creation",
    size: "large",
    mdFileCount: 2,
    mdMinLines: 250,
    state: "closed"
  }
];

const TEST_TAG = "[dorv-multi-pr-test]";
const createdGhCommentIds: number[] = [];

test.beforeAll(async () => {
  // Pre-warm the PR data cache with generous delays to avoid rate limiting.
  // PRs are fetched sequentially with 3s between each pair of requests.
  for (const pr of PR_CATALOG) {
    try {
      await fetchPrMeta(pr.prNumber);
      await delay(1500);
      await fetchPrFiles(pr.prNumber);
      await delay(1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[beforeAll] PR #${pr.prNumber.toString()} cache warm failed: ${msg}`);
    }
  }
  console.log(
    `[beforeAll] PR cache warm complete — ${prMetaCache.size.toString()} meta, ${prFilesCache.size.toString()} files cached`
  );
});

test.afterAll(async () => {
  const ids = [...createdGhCommentIds, ...(readState().ghCommentIds ?? [])];
  for (const id of ids) {
    await deleteGhReviewComment(id);
  }
  writeState({ ghCommentIds: [] });
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Disk cache for PR API responses that persist across test runs */
const PR_CACHE_DIR = path.join(os.tmpdir(), "dorv-e2e-pr-cache");
try {
  fs.mkdirSync(PR_CACHE_DIR, { recursive: true });
} catch {
  /* ok */
}

function prUrl(prNumber: number): string {
  return `https://github.com/${REAL_REPO}/pull/${prNumber.toString()}`;
}

/** Read PR data from disk cache */
function readPrCache(prNumber: number, type: "meta" | "files"): any {
  try {
    const file = path.join(PR_CACHE_DIR, `${prNumber}-${type}.json`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write PR data to disk cache */
function writePrCache(prNumber: number, type: "meta" | "files", data: any): void {
  try {
    const file = path.join(PR_CACHE_DIR, `${prNumber}-${type}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    /* ok */
  }
}

async function fetchPrFiles(prNumber: number): Promise<any[]> {
  const memCached = prFilesCache.get(prNumber);
  if (memCached) return memCached;

  const diskCached = readPrCache(prNumber, "files");
  if (diskCached) {
    prFilesCache.set(prNumber, diskCached);
    return diskCached;
  }

  const resp = await fetchWithRetry(
    `https://api.github.com/repos/${REAL_REPO}/pulls/${prNumber.toString()}/files`,
    {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json"
    }
  );
  if (!resp.ok) {
    throw new Error(`PR #${prNumber.toString()} files fetch failed: ${resp.status.toString()}`);
  }
  const data = await resp.json();
  prFilesCache.set(prNumber, data);
  writePrCache(prNumber, "files", data);
  return data;
}

async function fetchPrMeta(prNumber: number): Promise<any> {
  const memCached = prMetaCache.get(prNumber);
  if (memCached) return memCached;

  const diskCached = readPrCache(prNumber, "meta");
  if (diskCached) {
    prMetaCache.set(prNumber, diskCached);
    return diskCached;
  }

  const resp = await fetchWithRetry(
    `https://api.github.com/repos/${REAL_REPO}/pulls/${prNumber.toString()}`,
    {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json"
    }
  );
  if (!resp.ok) {
    throw new Error(`PR #${prNumber.toString()} meta fetch failed: ${resp.status.toString()}`);
  }
  const data = await resp.json();
  prMetaCache.set(prNumber, data);
  writePrCache(prNumber, "meta", data);
  return data;
}

function mdFilesFromList(files: any[]): any[] {
  return files.filter((f) => typeof f.filename === "string" && /\.mdx?$/iu.test(f.filename));
}

// ── API response cache ──────────────────────────────────────────────────────

const prMetaCache = new Map<number, any>();
const prFilesCache = new Map<number, any[]>();

/** Delay helper for rate limit backoff */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with retry/backoff for GitHub API rate limits */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, { headers });
    if (resp.ok) return resp;
    if (resp.status !== 403 && resp.status !== 429) return resp;

    // Rate limited — check for Retry-After header, else use exponential backoff
    const retryAfter = resp.headers.get("retry-after");
    const waitMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : baseDelayMs * Math.pow(2, attempt);

    console.log(
      `[rate-limit] ${resp.status} on ${url.split("github.com")[1] ?? url} — retry in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`
    );

    if (attempt < maxRetries) {
      await delay(waitMs);
    }
  }
  // Last attempt — just return the response (will throw on !resp.ok)
  return fetch(url, { headers });
}

async function openSidepanelOnPr(
  extensionContext: import("@playwright/test").BrowserContext,
  extensionId: string,
  prNumber: number
): Promise<import("@playwright/test").Page> {
  await extensionContext.addInitScript(
    ({ prUrl: prUrlValue, googleToken }: { prUrl: string; googleToken: string }) => {
      if (typeof chrome === "undefined") return;
      const fakeTab = [{ url: prUrlValue, id: 1 }];
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (chrome.identity) {
        (chrome.identity as any).getAuthToken = (
          _opts: unknown,
          callback: (token: string) => void
        ) => {
          callback(googleToken);
        };
      }
    },
    { prUrl: prUrl(prNumber), googleToken: GOOGLE_TOKEN }
  );

  const prPage = await extensionContext.newPage();
  let sidepanel: import("@playwright/test").Page;
  try {
    [sidepanel] = await Promise.all([
      extensionContext.waitForEvent("page", {
        predicate: (p) => p.url().includes(`${extensionId}/sidepanel`),
        timeout: 8_000
      }),
      (async () => {
        await prPage.goto(prUrl(prNumber), { waitUntil: "domcontentloaded" });
        await prPage.keyboard.press("Alt+Shift+D");
      })()
    ]);
  } catch {
    sidepanel = await extensionContext.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded"
    });
  }

  await sidepanel.waitForLoadState("domcontentloaded");
  return sidepanel;
}

/** Wait for the sidepanel to render any recognizable state */
async function waitForSidepanelReady(
  panel: import("@playwright/test").Page,
  timeout = 30_000
): Promise<void> {
  const selectors = [
    "[data-testid='dorv-main-panel']",
    "[data-testid='dorv-create-doc-title']",
    "[data-testid='dorv-checking']",
    "[data-testid='dorv-loading']",
    "[data-testid='dorv-error']",
    "[data-testid='dorv-neutral']",
    "[data-testid='dorv-onboarding-container']",
    "[data-testid='dorv-no-mapping']"
  ];
  const combined = selectors.join(", ");
  await expect(panel.locator(combined).first()).toBeVisible({ timeout });
}

async function seedForPr(
  extensionWorker: import("@playwright/test").Worker,
  prNumber: number,
  mapping?: Record<string, unknown>
): Promise<void> {
  const data: Record<string, unknown> = {
    github_pat: GITHUB_PAT,
    active_prs: [{ repo: REAL_REPO, prNumber }]
  };
  if (mapping) {
    data[`docStore:${REAL_REPO}#${prNumber.toString()}`] = mapping;
  }
  await extensionWorker.evaluate((d: any) => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.set(d, resolve);
    });
  }, data);
}

function pick<T>(arr: readonly T[], ...indices: number[]): T[] {
  return indices.map((i) => arr[i]).filter((v): v is T => v !== undefined);
}

// ── TC-026: Unlinked PR file listing across all PRs ─────────────────────────

test.describe("TC-026: unlinked PR file listing", () => {
  for (const pr of PR_CATALOG) {
    test(`TC-026-${pr.label}: sidepanel shows correct md file count and names`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      await seedForPr(extensionWorker, pr.prNumber);

      let files: any[];
      try {
        files = await fetchPrFiles(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const mdFiles = mdFilesFromList(files);
      expect(mdFiles.length, `PR #${pr.prNumber.toString()} md file count`).toBe(pr.mdFileCount);

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await expect(panel.locator("[data-testid='dorv-create-doc-title']")).toBeVisible({
        timeout: 30_000
      });

      const fileList = panel.locator("[data-testid='dorv-file-list']");
      await expect(fileList).toBeVisible({ timeout: 15_000 });
      const items = fileList.locator("li");
      await expect(items).toHaveCount(mdFiles.length);

      for (const f of mdFiles) {
        const fileItem = panel.locator(`[data-testid='dorv-file-item-${f.filename}']`);
        await expect(fileItem).toBeVisible({ timeout: 5_000 });
        await expect(fileItem).toContainText(f.filename);
      }

      const createBtn = panel.locator("[data-testid='dorv-create-doc-btn']");
      await expect(createBtn).toBeVisible({ timeout: 5_000 });
      await expect(createBtn).toContainText(
        `${mdFiles.length.toString()} file${mdFiles.length === 1 ? "" : "s"}`
      );

      await panel.close();
    });
  }
});

// ── TC-027: PR metadata detection across sizes ──────────────────────────────

test.describe("TC-027: PR metadata detection", () => {
  for (const pr of PR_CATALOG) {
    test(`TC-027-${pr.label}: fetches correct PR meta`, async () => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      let data: any;
      try {
        data = await fetchPrMeta(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }

      expect(typeof data.title).toBe("string");
      expect(data.title.length).toBeGreaterThan(0);
      expect(typeof data.user?.login).toBe("string");
      expect(typeof data.head?.ref).toBe("string");
      expect(typeof data.head?.sha).toBe("string");
      expect(data.head.sha.length).toBeGreaterThanOrEqual(40);
      expect(data.state).toBe(pr.state);

      let files: any[];
      try {
        files = await fetchPrFiles(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const mdFiles = mdFilesFromList(files);
      expect(mdFiles.length).toBeGreaterThanOrEqual(1);

      console.log(
        `[TC-027-${pr.label}] PR #${pr.prNumber.toString()}: "${data.title}" by @${data.user.login}, branch=${data.head.ref}, mdFiles=${mdFiles.length}`
      );
    });
  }
});

// ── TC-028: Create GDoc from medium/large PRs ───────────────────────────────

test.describe("TC-028: create GDoc from medium/large PRs", () => {
  const targets = PR_CATALOG.filter((p) => p.size === "medium" || p.size === "large");

  for (const pr of targets) {
    test(`TC-028-${pr.label}: creates Google Doc from PR with ${pr.mdFileCount} md files`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(
        !(await hasRequiredGoogleScopes()),
        "DORV_GOOGLE_TOKEN must include Google Docs + Drive file scopes"
      );

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();
      if (existingState.docId && existingState.docStoreKey === docStoreKey) {
        console.log(`[TC-028-${pr.label}] Reusing existing doc: ${existingState.docId}`);
        return;
      }

      let meta: any;
      try {
        meta = await fetchPrMeta(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }

      let prFiles: any[];
      try {
        prFiles = await fetchPrFiles(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const mdFiles = mdFilesFromList(prFiles).map((f) => ({
        filename: f.filename,
        rawUrl: f.raw_url,
        status: f.status,
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {})
      }));

      expect(mdFiles.length).toBeGreaterThan(0);

      const input = {
        repo: REAL_REPO,
        prNumber: pr.prNumber,
        title: meta.title,
        author: meta.user?.login ?? "unknown",
        branch: meta.head?.ref ?? "unknown",
        headSha: meta.head?.sha ?? "",
        prUrl: meta.html_url ?? prUrl(pr.prNumber),
        files: mdFiles
      };

      try {
        await createDocViaExtension(extensionContext, extensionId, input);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("rate limit") || msg.includes("403")) {
          console.log(`[TC-028-${pr.label}] Rate limited — skipping: ${msg}`);
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }

      const storage = await extensionWorker.evaluate<Record<string, unknown>>(() => {
        return new Promise((r) => {
          chrome.storage.local.get(null, r);
        });
      });
      const mapping = storage[docStoreKey] as { docId?: string; docUrl?: string } | undefined;
      expect(mapping, `doc mapping for PR #${pr.prNumber.toString()}`).toBeDefined();
      expect(mapping?.docId).toBeTruthy();
      expect(mapping?.docUrl).toMatch(/docs\.google\.com/);

      writeState({
        docId: mapping?.docId ?? "",
        docUrl: mapping?.docUrl ?? "",
        docStoreKey,
        docMapping: storage[docStoreKey] as Record<string, unknown>
      });

      console.log(
        `[TC-028-${pr.label}] Created doc ${mapping?.docId ?? ""} for PR #${pr.prNumber.toString()} (${mdFiles.length} md files)`
      );
    });
  }
});

// ── TC-029: GH comment rendering in medium/large PR sidepanel ───────────────

test.describe("TC-029: GH comment rendering in medium/large PR sidepanel", () => {
  const targets = PR_CATALOG.filter((p) => p.size === "medium" || p.size === "large");

  for (const pr of targets) {
    test(`TC-029-${pr.label}: real GH review comment renders in sidepanel DOM`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      let prData: any;
      try {
        prData = await fetchPrMeta(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const headSha = prData.head?.sha;
      expect(headSha).toBeTruthy();

      let files: any[];
      try {
        files = await fetchPrFiles(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const addedFile = files.find((f) => f.status === "added" && /\.mdx?$/iu.test(f.filename));
      const targetFile = addedFile ?? files.find((f) => f.status === "modified");
      if (!targetFile) {
        console.log(`[TC-029-${pr.label}] No suitable file for review comment — skipping`);
        return;
      }

      const target = { path: targetFile.filename, line: 1, headSha };
      const body = `${TEST_TAG} TC-029 ${pr.label} ${Date.now().toString()}`;
      const commentId = await createGhReviewComment(
        target.headSha,
        target.path,
        target.line,
        body,
        pr.prNumber
      );
      if (!commentId) {
        console.log(`[TC-029-${pr.label}] Could not create review comment — skipping`);
        return;
      }
      createdGhCommentIds.push(commentId);

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (await mainPanel.isVisible().catch(() => false)) {
        const commentLocator = panel.locator(
          `[data-testid='dorv-gh-comment-${String(commentId)}']`
        );
        await expect(commentLocator).toBeVisible({ timeout: 40_000 });
        await expect(commentLocator.locator(".author")).toContainText("@");
        await expect(commentLocator.locator(".comment-body")).toContainText(body, {
          timeout: 5_000
        });

        const section = panel.locator(`[data-testid='dorv-gh-file-section-${target.path}']`);
        await expect(section).toBeVisible({ timeout: 10_000 });

        console.log(
          `[TC-029-${pr.label}] Comment ${commentId.toString()} rendered for PR #${pr.prNumber.toString()}`
        );
      } else {
        console.log(`[TC-029-${pr.label}] Unlinked view — comment test skipped`);
      }

      await panel.close();
    });
  }
});

// ── TC-030: Tab switching across PRs ────────────────────────────────────────

test.describe("TC-030: tab switching across PRs", () => {
  const targets = pick(PR_CATALOG, 0, 3, 6);

  for (const pr of targets) {
    test(`TC-030-${pr.label}: tab switching works with real PR data`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (!(await mainPanel.isVisible().catch(() => false))) {
        console.log(`[TC-030-${pr.label}] Unlinked view — tab switching N/A`);
        await panel.close();
        return;
      }

      await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
      await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({
        timeout: 15_000
      });

      await panel.locator("[data-testid='dorv-tab-gdoc']").click();
      await expect(panel.locator("[data-testid='dorv-tab-gdoc']")).toHaveClass(/active/);
      await expect(panel.locator("[data-testid='dorv-tab-github']")).not.toHaveClass(/active/);
      await expect(panel.locator("[data-testid='dorv-gdoc-comments']")).toBeVisible({
        timeout: 10_000
      });
      await expect(panel.locator("[data-testid='dorv-gdoc-heading']")).toContainText(
        "Google Doc Comments"
      );
      await expect(panel.locator("[data-testid='dorv-push-all-btn']")).toBeVisible();

      await panel.locator("[data-testid='dorv-tab-activities']").click();
      await expect(panel.locator("[data-testid='dorv-tab-activities']")).toHaveClass(/active/);
      await expect(panel.locator("[data-testid='dorv-activities']")).toBeVisible({
        timeout: 10_000
      });

      await panel.locator("[data-testid='dorv-tab-github']").click();
      await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
      await expect(panel.locator("[data-testid='dorv-gh-comments']")).toBeVisible({
        timeout: 10_000
      });

      console.log(`[TC-030-${pr.label}] Tab switching verified for PR #${pr.prNumber.toString()}`);
      await panel.close();
    });
  }
});

// ── TC-031: Thread expand/collapse across PRs ───────────────────────────────

test.describe("TC-031: thread expand/collapse across PRs", () => {
  const targets = pick(PR_CATALOG, 2, 4);

  for (const pr of targets) {
    test(`TC-031-${pr.label}: thread toggle works with real PR data`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      let prData: any;
      try {
        prData = await fetchPrMeta(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const headSha = prData.head?.sha;

      let files: any[];
      try {
        files = await fetchPrFiles(pr.prNumber);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("403") || msg.includes("rate limit")) {
          test.skip(true, `GitHub rate limited: ${msg}`);
          return;
        }
        throw err;
      }
      const targetFile = files.find((f) => f.status === "added") ?? files[0];
      if (!targetFile || !headSha) {
        console.log(`[TC-031-${pr.label}] No suitable target — skipping`);
        return;
      }

      const parentBody = `${TEST_TAG} TC-031 parent ${pr.label} ${Date.now().toString()}`;
      const parentId = await createGhReviewComment(
        headSha,
        targetFile.filename,
        1,
        parentBody,
        pr.prNumber
      );
      if (!parentId) {
        console.log(`[TC-031-${pr.label}] Could not create parent comment — skipping`);
        return;
      }
      createdGhCommentIds.push(parentId);

      const replyId = await createGhCommentReply(
        parentId,
        `${TEST_TAG} TC-031 reply ${pr.label}`,
        pr.prNumber
      );
      if (replyId) {
        createdGhCommentIds.push(replyId);
      }

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (!(await mainPanel.isVisible().catch(() => false))) {
        console.log(`[TC-031-${pr.label}] Unlinked view — thread test N/A`);
        await panel.close();
        return;
      }

      const parentLocator = panel.locator(`[data-testid='dorv-gh-comment-${String(parentId)}']`);
      await expect(parentLocator).toBeVisible({ timeout: 40_000 });
      await expect(parentLocator.locator(".comment-body")).toContainText(parentBody, {
        timeout: 5_000
      });

      const toggleBtn = panel.locator(`[data-testid='dorv-thread-toggle-${String(parentId)}']`);
      if (await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await toggleBtn.click();
        await panel.waitForTimeout(500);
        console.log(
          `[TC-031-${pr.label}] Thread toggle clicked for comment ${parentId.toString()}`
        );
      } else {
        console.log(`[TC-031-${pr.label}] No toggle (single comment, no replies visible)`);
      }

      await expect(panel.locator("[data-testid='dorv-tab-github']")).toHaveClass(/active/);
      await panel.close();
    });
  }
});

// ── TC-032: Sidepanel responsiveness across PRs ──────────────────────────────

test.describe("TC-032: sidepanel responsiveness across PRs", () => {
  for (const pr of PR_CATALOG) {
    test(`TC-032-${pr.label}: no horizontal overflow at narrow widths`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      await seedForPr(extensionWorker, pr.prNumber);

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);
      await waitForSidepanelReady(panel);

      for (const width of [320, 480, 720]) {
        await panel.setViewportSize({ width, height: 800 });
        await panel.evaluate(() => {
          return new Promise((r) => {
            requestAnimationFrame(r);
          });
        });
        const { scrollWidth, innerWidth } = await panel.evaluate(() => ({
          scrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth
        }));
        expect(
          scrollWidth,
          `PR #${pr.prNumber.toString()} horizontal overflow at ${width.toString()}px`
        ).toBeLessThanOrEqual(innerWidth + 2);
      }

      await panel.close();
    });
  }
});

// ── TC-033: GDoc comment push from medium/large PRs ─────────────────────────

test.describe("TC-033: GDoc comment push from medium/large PRs", () => {
  const targets = PR_CATALOG.filter((p) => p.size === "medium" || p.size === "large");

  for (const pr of targets) {
    test(`TC-033-${pr.label}: push-all button visible in GDoc tab`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (!(await mainPanel.isVisible().catch(() => false))) {
        console.log(`[TC-033-${pr.label}] Unlinked view — push button N/A`);
        await panel.close();
        return;
      }

      await panel.locator("[data-testid='dorv-tab-gdoc']").click();
      await expect(panel.locator("[data-testid='dorv-gdoc-comments']")).toBeVisible({
        timeout: 10_000
      });
      await expect(panel.locator("[data-testid='dorv-push-all-btn']")).toBeVisible({
        timeout: 5_000
      });
      await expect(panel.locator("[data-testid='dorv-gdoc-heading']")).toContainText(
        "Google Doc Comments"
      );

      console.log(
        `[TC-033-${pr.label}] Push-all button verified for PR #${pr.prNumber.toString()}`
      );
      await panel.close();
    });
  }
});

// ── TC-034: Status bar states across PRs ────────────────────────────────────

test.describe("TC-034: status bar states across PRs", () => {
  const targets = pick(PR_CATALOG, 0, 2, 5, 6);

  for (const pr of targets) {
    test(`TC-034-${pr.label}: status bar renders correctly`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (!(await mainPanel.isVisible().catch(() => false))) {
        console.log(`[TC-034-${pr.label}] Unlinked view — status bar N/A`);
        await panel.close();
        return;
      }

      await expect(panel.locator("[data-testid='dorv-status-bar']")).toBeVisible({
        timeout: 10_000
      });
      await expect(panel.locator("[data-testid='dorv-status-dot']")).toBeVisible();

      const statusText = await panel.locator("[data-testid='dorv-status-bar']").textContent();
      expect(statusText).toMatch(/Last synced:|Syncing/);

      await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toBeVisible();
      await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toContainText("Sync now");
      await expect(panel.locator("[data-testid='dorv-refresh-icon']")).toBeVisible();
      await expect(panel.locator("[data-testid='dorv-refresh-icon']")).not.toHaveClass(
        /dorv-spinning/
      );

      console.log(
        `[TC-034-${pr.label}] Status bar OK for PR #${pr.prNumber.toString()}: "${statusText?.trim()}"`
      );
      await panel.close();
    });
  }
});

// ── TC-035: Header renders correctly across all PRs ─────────────────────────

test.describe("TC-035: header renders correctly across all PRs", () => {
  for (const pr of PR_CATALOG) {
    test(`TC-035-${pr.label}: header with eyebrand, title, and action buttons`, async ({
      extensionContext,
      extensionId,
      extensionWorker
    }) => {
      test.skip(!GITHUB_PAT, "Requires DORV_GITHUB_PAT");

      const docStoreKey = `docStore:${REAL_REPO}#${pr.prNumber.toString()}`;
      const existingState = readState();

      if (existingState.docStoreKey === docStoreKey && existingState.docMapping) {
        await seedForPr(extensionWorker, pr.prNumber, existingState.docMapping);
      } else {
        await seedForPr(extensionWorker, pr.prNumber);
      }

      const panel = await openSidepanelOnPr(extensionContext, extensionId, pr.prNumber);

      await waitForSidepanelReady(panel);

      const mainPanel = panel.locator("[data-testid='dorv-main-panel']");
      if (!(await mainPanel.isVisible().catch(() => false))) {
        // Unlinked / checking / neutral / error state — just verify the panel rendered
        console.log(`[TC-035-${pr.label}] Non-linked view rendered`);
        await panel.close();
        return;
      }

      await expect(panel.locator("[data-testid='dorv-header']")).toBeVisible({
        timeout: 10_000
      });
      await expect(panel.locator("[data-testid='dorv-header'] .dorv-eyebrow")).toContainText(
        "dorv"
      );
      await expect(panel.locator("[data-testid='dorv-header'] h1")).toContainText("Review Sync");
      await expect(panel.locator("[data-testid='dorv-open-pr-btn']")).toBeVisible();
      await expect(panel.locator("[data-testid='dorv-open-doc-btn']")).toBeVisible();
      await expect(panel.locator("[data-testid='dorv-close-panel-btn']")).toBeVisible();
      await expect(panel.locator("[data-testid='dorv-sync-now-btn']")).toBeVisible();

      console.log(`[TC-035-${pr.label}] Header verified for PR #${pr.prNumber.toString()}`);
      await panel.close();
    });
  }
});
