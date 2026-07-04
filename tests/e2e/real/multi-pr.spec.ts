/**
 * Multi-PR real-credential E2E tests.
 *
 * Runs PR-metadata and doc-creation checks across many real PRs with
 * varying markdown content — from tiny single-file PRs (PR #9, +21 md
 * lines) to large multi-file PRs (PR #7, +288 md lines) and the load-test
 * fixture (PR #70, +267 md lines with 100+ review comments).
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
 * v0.3.0 note: this file originally also carried TC-026 and TC-029 through
 * TC-035, which drove the deleted sidepanel UI (tabs, file lists, thread
 * toggles, status bar, header) across the PR catalog above. They were
 * removed rather than adapted — the sidepanel/tabs UI they exercised no
 * longer exists, and there is no multi-doc-model equivalent to assert
 * against; button-injection UI has its own coverage in
 * tests/github-button-injection.test.ts and
 * tests/gdoc-comment-card-injection.test.ts. Only TC-027 (pure GitHub API
 * metadata, no UI) and TC-028 (doc creation via the extension's
 * message-passing API, no UI) survive, updated for the `docs[]`
 * multi-doc-mapping shape.
 *
 * Run all:     DORV_GITHUB_PAT=... DORV_GOOGLE_TOKEN=... pnpm e2e:real --grep "TC-02[78]"
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
  deleteGhReviewComment,
  createDocViaExtension,
  hasRequiredGoogleScopes,
  GITHUB_PAT,
  REAL_REPO
} from "./fixture.js";
import { readState, readStateForPr, writeState, writeStateForPr } from "./state.js";
import type { DocMapping } from "../../../apps/extension/lib/adapters/types.js";
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
      const existingState = readStateForPr(REAL_REPO, pr.prNumber);
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
      const mapping = storage[docStoreKey] as DocMapping | undefined;
      expect(mapping, `doc mapping for PR #${pr.prNumber.toString()}`).toBeDefined();
      expect(Array.isArray(mapping?.docs), "mapping must have a docs array").toBe(true);
      expect(
        mapping?.docs.length,
        `PR #${pr.prNumber.toString()} must have one doc per md file`
      ).toBe(mdFiles.length);
      for (const doc of mapping?.docs ?? []) {
        expect(doc.docId, `doc for ${doc.filename} must have a docId`).toBeTruthy();
        expect(doc.docUrl, `doc for ${doc.filename} must have a docUrl`).toMatch(
          /docs\.google\.com/
        );
      }

      const firstDoc = mapping?.docs[0];
      writeStateForPr(REAL_REPO, pr.prNumber, {
        docId: firstDoc?.docId ?? "",
        docUrl: firstDoc?.docUrl ?? "",
        docStoreKey,
        docMapping: storage[docStoreKey] as Record<string, unknown>
      });

      console.log(
        `[TC-028-${pr.label}] Created ${mapping?.docs.length.toString() ?? "0"} doc(s) for PR #${pr.prNumber.toString()} (${mdFiles.length} md files)`
      );
    });
  }
});
