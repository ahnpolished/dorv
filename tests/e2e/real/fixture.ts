/**
 * Shared fixtures and helpers for real-credential E2E tests.
 *
 * Required env vars (all four spec files skip when absent):
 *   DORV_GITHUB_PAT    — GitHub PAT with repo read + PR comment write (needs `repo` scope)
 *   DORV_GOOGLE_TOKEN  — Short-lived Google OAuth access token with the scopes the extension
 *                        requests (drive, drive.file, userinfo.email).
 *
 *                        Obtain via the extension's own identity flow:
 *                          1. Load the extension in Chrome
 *                          2. Open any extension page DevTools console
 *                          3. Run: chrome.identity.getAuthToken({ interactive: true }, console.log)
 *
 *                        NOTE: tokens expire in ~1 h. Re-run step 3 between long test sessions.
 *
 * Optional env vars:
 *   DORV_TEST_REPO        — owner/repo (default: "ahnpolished/dorv")
 *   DORV_TEST_PR_NUMBER   — PR number  (default: 6)
 *                           The PR must have ≥ 1 markdown file; PAT must have comment-write access.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { chromium, test as base, expect } from "@playwright/test";
import type { BrowserContext, Worker } from "@playwright/test";
import type {
  CreateDocInput,
  CreateDocResult,
  MarkdownFileRef
} from "../../../apps/extension/lib/adapters/types.js";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { GOOGLE_TOKEN_FILE } from "../../global-setup.js";

export { expect };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../../../apps/extension/.output/chrome-mv3");

// ── Env vars ──────────────────────────────────────────────────────────────────
export const GITHUB_PAT = process.env.DORV_GITHUB_PAT ?? "";

// DORV_GOOGLE_TOKEN can be set directly or auto-refreshed via globalSetup (which writes
// to a temp file because process.env changes in globalSetup don't propagate to workers).
const _tokenFromFile = (() => {
  try {
    return fs.readFileSync(GOOGLE_TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
})();
export const GOOGLE_TOKEN = process.env.DORV_GOOGLE_TOKEN ?? _tokenFromFile;
export const REAL_REPO = process.env.DORV_TEST_REPO ?? "ahnpolished/dorv";
export const REAL_PR_NUMBER = parseInt(process.env.DORV_TEST_PR_NUMBER ?? "6", 10);
export const REAL_PR_URL = `https://github.com/${REAL_REPO}/pull/${REAL_PR_NUMBER.toString()}`;

export const HAVE_CREDS = Boolean(GITHUB_PAT && GOOGLE_TOKEN);
export const SKIP_REASON =
  "Requires DORV_GITHUB_PAT and DORV_GOOGLE_TOKEN. Use a Google OAuth token with documents + drive.file scopes.";
const REQUIRED_GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive.file"] as const;

// ── GH REST helpers ───────────────────────────────────────────────────────────

export interface GhPrMeta {
  headSha: string;
  prUrl: string;
  title: string;
  author: string;
  branch: string;
}

export interface GhCommentTarget {
  path: string;
  line: number;
  headSha: string;
}

/** Fetch real PR metadata (head SHA etc.) and cache it for the test run. */
let _cachedPrMeta: GhPrMeta | undefined;
export async function fetchRealPrMeta(): Promise<GhPrMeta> {
  if (_cachedPrMeta) return _cachedPrMeta;
  const resp = await fetch(
    `https://api.github.com/repos/${REAL_REPO}/pulls/${REAL_PR_NUMBER.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  if (!resp.ok) throw new Error(`PR meta fetch failed: ${resp.status.toString()}`);
  const data = await resp.json();
  _cachedPrMeta = {
    headSha: data.head.sha,
    prUrl: data.html_url,
    title: data.title,
    author: data.user?.login ?? "unknown",
    branch: data.head.ref ?? "unknown"
  };
  return _cachedPrMeta;
}

/** Fetch the real PR's markdown file refs in the shape expected by CREATE_DOC. */
export async function fetchRealMarkdownFiles(): Promise<MarkdownFileRef[]> {
  const filesResp = await fetch(
    `https://api.github.com/repos/${REAL_REPO}/pulls/${REAL_PR_NUMBER.toString()}/files`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  if (!filesResp.ok) {
    throw new Error(`PR files fetch failed: ${filesResp.status.toString()}`);
  }
  const files = (await filesResp.json()) as {
    filename?: unknown;
    raw_url?: unknown;
    status?: unknown;
    previous_filename?: unknown;
  }[];
  return files
    .filter(
      (
        file
      ): file is {
        filename: string;
        raw_url: string;
        status: string;
        previous_filename?: string;
      } =>
        typeof file.filename === "string" &&
        typeof file.raw_url === "string" &&
        typeof file.status === "string" &&
        /\.mdx?$/iu.test(file.filename)
    )
    .map((file) => {
      const ref: MarkdownFileRef = {
        filename: file.filename,
        rawUrl: file.raw_url,
        status: file.status
      };
      if (file.previous_filename) {
        ref.previousFilename = file.previous_filename;
      }
      return ref;
    });
}

/** Build the CREATE_DOC message payload from live GitHub metadata. */
export async function buildRealCreateDocInput(): Promise<CreateDocInput> {
  const [meta, files] = await Promise.all([fetchRealPrMeta(), fetchRealMarkdownFiles()]);
  if (files.length === 0) {
    throw new Error(`${REAL_REPO}#${REAL_PR_NUMBER.toString()} has no markdown files`);
  }

  return {
    repo: REAL_REPO,
    prNumber: REAL_PR_NUMBER,
    title: meta.title,
    author: meta.author,
    branch: meta.branch,
    headSha: meta.headSha,
    prUrl: meta.prUrl,
    files
  };
}

/** Send CREATE_DOC through the extension runtime, using the same background adapter path as UI. */
export async function createDocViaExtension(
  extensionContext: BrowserContext,
  extensionId: string,
  input: CreateDocInput
): Promise<CreateDocResult> {
  const page = await extensionContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded"
  });
  const response = await page.evaluate((payload) => {
    return new Promise<{ success: boolean; payload?: CreateDocResult; error?: string }>(
      (resolve) => {
        chrome.runtime.sendMessage({ type: "CREATE_DOC", payload }, resolve);
      }
    );
  }, input);
  await page.close();
  if (!response.success || !response.payload) {
    throw new Error(response.error ?? "CREATE_DOC returned no payload");
  }
  return response.payload;
}

/** True only when DORV_GOOGLE_TOKEN carries the Drive/Docs scopes needed for live doc tests. */
export async function hasRequiredGoogleScopes(): Promise<boolean> {
  if (!GOOGLE_TOKEN) {
    return false;
  }
  const resp = await fetch("https://oauth2.googleapis.com/tokeninfo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: GOOGLE_TOKEN })
  });
  if (!resp.ok) {
    return false;
  }
  const data = (await resp.json()) as { scope?: string };
  const scopes = new Set((data.scope ?? "").split(/\s+/u).filter(Boolean));
  return REQUIRED_GOOGLE_SCOPES.every((scope) => scopes.has(scope));
}

/**
 * Find the first valid (path, line) pair for creating a GH review comment.
 * Prefers "added" files (every line is in the diff) to avoid diff-parsing.
 * Falls back to parsing the unified-diff patch of the first modified file.
 */
let _cachedTarget: GhCommentTarget | undefined;
export async function fetchCommentTarget(): Promise<GhCommentTarget | undefined> {
  if (_cachedTarget) return _cachedTarget;
  const { headSha } = await fetchRealPrMeta();

  const filesResp = await fetch(
    `https://api.github.com/repos/${REAL_REPO}/pulls/${REAL_PR_NUMBER.toString()}/files`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json"
      }
    }
  );
  if (!filesResp.ok) return undefined;
  const files = (await filesResp.json()) as any[];

  // Prefer added files — all lines are in the diff, line 1 always works
  const added = files.find((f: any) => f.status === "added");
  if (added) {
    _cachedTarget = { path: added.filename, line: 1, headSha };
    return _cachedTarget;
  }

  // Fall back: parse the first modified file's patch to locate a valid added line
  const modified = files.find((f: any) => typeof f.patch === "string");
  if (!modified) return undefined;

  const patch: string = modified.patch;
  // @@ -old +newStart,newCount @@
  const hunkMatch = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/m.exec(patch);
  if (!hunkMatch) {
    _cachedTarget = { path: modified.filename, line: 1, headSha };
    return _cachedTarget;
  }
  const startLine = parseInt(hunkMatch[1] ?? "1", 10);
  const afterHeader = patch.slice(hunkMatch.index + hunkMatch[0].length + 1);
  let currentLine = startLine;
  for (const l of afterHeader.split("\n")) {
    if (l.startsWith("+")) {
      _cachedTarget = { path: modified.filename, line: currentLine, headSha };
      return _cachedTarget;
    }
    if (!l.startsWith("-")) currentLine++;
  }
  _cachedTarget = { path: modified.filename, line: startLine, headSha };
  return _cachedTarget;
}

// ── Rate limit helpers ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with retry/backoff for GitHub API rate limits */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.ok) return resp;
    if (resp.status !== 403 && resp.status !== 429) return resp;

    const retryAfter = (resp as any).headers?.get?.("retry-after");
    const waitMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : baseDelayMs * Math.pow(2, attempt);

    console.log(
      `[rate-limit] ${resp.status} — retry in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`
    );

    if (attempt < maxRetries) {
      await delay(waitMs);
    }
  }
  return fetch(url, init);
}

/**
 * Create a GH review comment. Returns the comment id, or null on failure.
 * Failures are expected if the line is not in the diff for modified files.
 */
export async function createGhReviewComment(
  headSha: string,
  filePath: string,
  line: number,
  body: string,
  prNumber: number = REAL_PR_NUMBER
): Promise<number | null> {
  const url = `https://api.github.com/repos/${REAL_REPO}/pulls/${prNumber.toString()}/comments`;
  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({ body, commit_id: headSha, path: filePath, line, side: "RIGHT" })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.id as number;
}

/** Create a reply to a review comment thread. */
export async function createGhCommentReply(
  parentId: number,
  body: string,
  prNumber: number = REAL_PR_NUMBER
): Promise<number | null> {
  const url = `https://api.github.com/repos/${REAL_REPO}/pulls/${prNumber.toString()}/comments`;
  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json"
    },
    body: JSON.stringify({ body, in_reply_to: parentId })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.id as number;
}

/** Delete a GH review comment by id. */
export async function deleteGhReviewComment(commentId: number): Promise<void> {
  await fetch(`https://api.github.com/repos/${REAL_REPO}/pulls/comments/${commentId.toString()}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: "application/vnd.github+json" }
  });
}

/** Resolve a GH review thread. Returns true on success. */
export async function resolveGhThread(threadId: string): Promise<boolean> {
  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `mutation { resolveReviewThread(input: { threadId: "${threadId}" }) { thread { id isResolved } } }`
    })
  });
  return resp.ok;
}

// ── Drive REST helpers ────────────────────────────────────────────────────────

/** Create a Drive comment on a document. */
export async function createDriveComment(
  docId: string,
  content: string,
  quotedValue?: string
): Promise<string | null> {
  const body: Record<string, unknown> = { content };
  if (quotedValue) {
    body.quotedFileContent = { mimeType: "text/html", value: quotedValue };
  }
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${docId}/comments?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.id as string;
}

/** Delete a Drive comment. */
export async function deleteDriveComment(docId: string, commentId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${docId}/comments/${commentId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${GOOGLE_TOKEN}` }
  });
}

/** Move a Drive file to trash (soft delete). */
export async function trashDriveFile(fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${GOOGLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ trashed: true })
  });
}

/** Export a Drive doc as plain text to scan for mermaid.ink URLs. */
export async function exportDriveDocAsText(fileId: string): Promise<string> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${GOOGLE_TOKEN}` } }
  );
  if (!resp.ok) return "";
  return resp.text();
}

// ── Sidepanel helper ──────────────────────────────────────────────────────────

/**
 * Navigate to the real PR URL, press Alt+Shift+D to trigger the extension's
 * toggle-sidepanel command, and wait for the sidepanel page to appear.
 *
 * In headed Chrome the native sidepanel opens; in --headless=new the
 * openSidePanelForTab fallback opens sidepanel.html as a tab instead.
 * Either way chrome.tabs.query and chrome.identity are patched via an init
 * script so the sidepanel can resolve the PR URL and Google token in tests.
 */
export async function openSidepanelOnRealPr(
  extensionContext: BrowserContext,
  extensionId: string
): Promise<import("@playwright/test").Page> {
  // Patch chrome APIs in every new extension page (including the sidepanel).
  // addInitScript accumulates per-call but the patches are idempotent.
  await extensionContext.addInitScript(
    ({ prUrl, googleToken }: { prUrl: string; googleToken: string }) => {
      if (typeof chrome === "undefined") return;
      const fakeTab = [{ url: prUrl, id: 1 }];
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
    { prUrl: REAL_PR_URL, googleToken: GOOGLE_TOKEN }
  );

  const prPage = await extensionContext.newPage();

  // Try keyboard shortcut first (works in --headless=new when the content script
  // intercepts it and calls chrome.sidePanel.open(), which opens as a tab).
  // Fall back to direct navigation if the page event doesn't fire — the shortcut
  // doesn't reliably reach chrome.commands in all headless configurations.
  let sidepanel: import("@playwright/test").Page;
  try {
    [sidepanel] = await Promise.all([
      extensionContext.waitForEvent("page", {
        predicate: (p) => p.url().includes(`${extensionId}/sidepanel`),
        timeout: 8_000
      }),
      (async () => {
        await prPage.goto(REAL_PR_URL, { waitUntil: "domcontentloaded" });
        await prPage.keyboard.press("Alt+Shift+D");
      })()
    ]);
  } catch {
    // Keyboard shortcut didn't trigger the sidepanel page event — open directly.
    sidepanel = await extensionContext.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: "domcontentloaded"
    });
  }

  await sidepanel.waitForLoadState("domcontentloaded");
  return sidepanel;
}

// ── Playwright fixture definition ─────────────────────────────────────────────

interface WorkerFixtures {
  extensionContext: BrowserContext;
  extensionId: string;
  extensionWorker: Worker;
}

interface TestFixtures {
  /** Seeds real PAT and patches SW identity. Skips the test if creds absent. */
  realAuth: undefined;
  /** Trigger SYNC_NOW via the options extension page. */
  triggerSync: () => Promise<void>;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  extensionContext: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dorv-real-e2e-"));
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          ...(process.env.PW_HEADED === "true" ? [] : ["--headless=new"])
        ]
      });
      await use(ctx);
      await ctx.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
    { scope: "worker" }
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      let worker = extensionContext.serviceWorkers()[0];
      worker ??= await extensionContext.waitForEvent("serviceworker");
      const extensionId = worker.url().split("/")[2] ?? "";
      await use(extensionId);
    },
    { scope: "worker" }
  ],

  extensionWorker: [
    async ({ extensionContext }, use) => {
      let worker = extensionContext.serviceWorkers()[0];
      worker ??= await extensionContext.waitForEvent("serviceworker");
      await use(worker);
    },
    { scope: "worker" }
  ],

  realAuth: [
    async ({ extensionWorker }, use) => {
      if (!HAVE_CREDS) {
        test.skip(true, SKIP_REASON);
        await use(undefined);
        return;
      }
      // Seed the real GitHub PAT into extension storage
      await extensionWorker.evaluate((pat: string) => {
        return new Promise<void>((resolve) => {
          chrome.storage.local.set({ github_pat: pat }, resolve);
        });
      }, GITHUB_PAT);
      // Patch chrome.identity in the SW context
      await extensionWorker.evaluate((token: string) => {
        (chrome.identity as any).getAuthToken = (_opts: unknown, callback: (t: string) => void) => {
          callback(token);
        };
      }, GOOGLE_TOKEN);
      await use(undefined);
    },
    { auto: true }
  ],

  triggerSync: async ({ extensionContext, extensionId }, use) => {
    const trigger = async () => {
      const page = await extensionContext.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: "domcontentloaded"
      });
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          chrome.runtime.sendMessage({ type: "SYNC_NOW", payload: null }, () => {
            resolve();
          });
        });
      });
      await page.close();
    };
    await use(trigger);
  }
});
