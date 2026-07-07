import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentScriptContext } from "wxt/utils/content-script-context";

import { parseGitHubPullRequestUrl } from "../lib/github/pr-files.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createStatusStore } from "../lib/storage/stores.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";
import {
  createDocViaBackground,
  fetchPrInfoViaBackground,
  openOptionsPageViaBackground,
  syncPRViaBackground,
  toPullRequestRef
} from "../lib/adapters/messages.js";
import {
  fileButtonRootId,
  findInjectionAnchors,
  getFileHeaderFilename,
  hasFileButton
} from "../lib/github/button-injection.js";
import type { DocMapping, SyncStatus } from "../lib/adapters/types.js";
import { IconAlert, IconFile, IconFileAdd, IconGear, IconSync } from "../lib/design/icons.js";
import animationsCss from "../lib/design/animations.css?inline";
import tokensCss from "../lib/design/tokens.css?inline";

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea);
const statusStore = createStatusStore(storageArea);
const adapter = resolveAdapter({ authStore, storageArea });

// Build-stamp for freshness checks during debugging.
// Content scripts run in an isolated world, so we stamp the DOM
// instead of `window` — otherwise chrome_devtools_evaluate_script
// (main world) can't see it.  Check with:
//   chrome_devtools_evaluate_script `() => document.documentElement.dataset.dorvCsBuild`
document.documentElement.dataset.dorvCsBuild = __DORV_BUILD_ID__;

initSentryForSurface("github-buttons");

// ─── Per-file button state ────────────────────────────────────────────

type FileViewState =
  | { kind: "loading" }
  | { kind: "no-creds" }
  | { kind: "hidden" }
  | { kind: "no-doc" }
  | { kind: "linked"; mapping: DocMapping; status: SyncStatus | undefined };

async function loadFileView(ref: GitHubPullRequestRef, filename: string): Promise<FileViewState> {
  const pat = await authStore.getGitHubToken();
  if (!pat) return { kind: "no-creds" };

  const repo = `${ref.owner}/${ref.repo}`;
  const mapping = await adapter.getDoc({ repo, prNumber: ref.prNumber });

  if (!mapping) return { kind: "no-doc" };

  // Check if this specific file has a linked doc
  const doc = mapping.docs.find((d) => d.filename === filename);
  if (doc) {
    const status = await statusStore.get(mapping.repo, ref.prNumber);
    return { kind: "linked", mapping, status };
  }

  return { kind: "no-doc" };
}

// ─── Per-file compact button component ─────────────────────────────────

function FileButton({ prRef: ref, filename }: { prRef: GitHubPullRequestRef; filename: string }) {
  const [view, setView] = useState<FileViewState>({ kind: "loading" });
  const [isCreating, setIsCreating] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();

  // Initial load
  useEffect(() => {
    let cancelled = false;
    loadFileView(ref, filename)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          captureExtensionException(err, {
            surface: "github-buttons",
            tags: { operation: "load_file_view" }
          });
        }
      });

    // Listen for storage changes to refresh
    const relevantKeys = [
      `docStore:${ref.owner}/${ref.repo}#${ref.prNumber.toString()}`,
      `statusStore:${ref.owner}/${ref.repo}#${ref.prNumber.toString()}`,
      "github_pat"
    ];
    const keysSet = new Set(relevantKeys);

    let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== "local") return;
      if (!Object.keys(changes).some((k) => keysSet.has(k))) return;
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
      coalesceTimer = setTimeout(() => {
        coalesceTimer = null;
        loadFileView(ref, filename)
          .then((next) => {
            if (!cancelled) setView(next);
          })
          .catch(() => {
            // Silently ignore refresh failures — the button will retry on
            // the next storage change or user interaction.
          });
      }, 200);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      cancelled = true;
      if (coalesceTimer !== null) clearTimeout(coalesceTimer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [ref.owner, ref.repo, ref.prNumber, filename]);

  const handleCreate = async () => {
    setCreateError(undefined);
    setIsCreating(true);
    try {
      const pat = await authStore.getGitHubToken();
      if (!pat) throw new Error("Missing GitHub token");

      // Fetch PR files + meta through the background service worker.
      // Content-script fetch() stalls on cross-origin API calls even
      // with host_permissions; the background has unrestricted access.
      const prRef = toPullRequestRef(ref);
      const { files: allFiles, meta } = await fetchPrInfoViaBackground(prRef);

      const file = allFiles.find((f: { filename: string }) => f.filename === filename);
      if (!file) throw new Error(`File "${filename}" not found in PR`);

      const result = await createDocViaBackground({
        repo: prRef.repo,
        prNumber: ref.prNumber,
        files: [file],
        title: meta.title,
        author: meta.author,
        branch: meta.branch,
        headSha: meta.headSha,
        prUrl: meta.prUrl
      });
      setView({ kind: "linked", mapping: result.mapping, status: undefined });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[dorv] handleCreate FAILED:", msg, err);
      setCreateError(msg);
      captureExtensionException(err, {
        surface: "github-buttons",
        tags: { operation: "create_doc_file" }
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleSync = async () => {
    setSyncError(undefined);
    setIsSyncing(true);
    try {
      await syncPRViaBackground({
        repo: `${ref.owner}/${ref.repo}`,
        prNumber: ref.prNumber
      });
      // Refresh view after sync
      const next = await loadFileView(ref, filename);
      setView(next);
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err));
      captureExtensionException(err, {
        surface: "github-buttons",
        tags: { operation: "sync_pr_file" }
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenDoc = () => {
    if (view.kind !== "linked") return;
    const doc = view.mapping.docs.find((d) => d.filename === filename);
    if (doc) {
      window.open(doc.docUrl, "_blank", "noreferrer");
    }
  };

  const versionCount =
    view.kind === "linked"
      ? (view.mapping.docs.find((d) => d.filename === filename)?.versions?.length ?? 1)
      : 1;

  const handleOpenOptions = () => {
    openOptionsPageViaBackground().catch((err: unknown) => {
      captureExtensionException(err, {
        surface: "github-buttons",
        tags: { operation: "open_options_page" }
      });
    });
  };

  if (view.kind === "hidden" || view.kind === "loading") return null;

  return (
    <span className="dorv-file-btn dorv-state-enter" data-dorv-file={filename}>
      {view.kind === "no-creds" && (
        <span className="dorv-file-btn-set">
          <button
            type="button"
            className="dorv-file-btn-el"
            onClick={handleOpenOptions}
            title="Set up dorv"
            aria-label="Set up dorv"
          >
            <IconGear />
          </button>
        </span>
      )}

      {view.kind === "no-doc" && (
        <span className="dorv-file-btn-set">
          <button
            type="button"
            className="dorv-file-btn-el"
            onClick={() => {
              void handleCreate();
            }}
            disabled={isCreating}
            title={isCreating ? "Creating Google Doc…" : `Create Google Doc for ${filename}`}
            aria-label={isCreating ? "Creating Google Doc" : `Create Google Doc for ${filename}`}
          >
            {isCreating ? <IconSync className="dorv-spinning" /> : <IconFileAdd />}
          </button>
        </span>
      )}

      {view.kind === "linked" && (
        <>
          <span className="dorv-file-btn-set">
            <button
              type="button"
              className="dorv-file-btn-el"
              onClick={handleOpenDoc}
              title={`Open Google Doc for ${filename}${versionCount > 1 ? ` (${versionCount.toString()} versions)` : ""}`}
              aria-label={`Open Google Doc for ${filename}${versionCount > 1 ? ` (${versionCount.toString()} versions)` : ""}`}
            >
              <IconFile />
              {versionCount > 1 && <span className="dorv-version-badge">{versionCount}</span>}
            </button>
            <button
              type="button"
              className="dorv-file-btn-el"
              onClick={() => {
                void handleSync();
              }}
              disabled={isSyncing}
              title={isSyncing ? "Syncing…" : `Sync ${filename} to Google Doc`}
              aria-label={isSyncing ? "Syncing" : `Sync ${filename} to Google Doc`}
            >
              <IconSync className={isSyncing ? "dorv-spinning" : ""} />
            </button>
            {view.mapping.isStale && (
              <span
                className="dorv-stale-badge"
                title="Doc content may be out of date with the latest PR changes"
                aria-label="Doc may be out of date"
              >
                <IconAlert />
              </span>
            )}
          </span>
        </>
      )}

      {(createError ?? syncError) && (
        <span className="dorv-file-btn-set">
          <button
            type="button"
            className="dorv-file-btn-el dorv-file-btn-retry"
            onClick={() => {
              if (createError) void handleCreate();
              else void handleSync();
            }}
            title={createError ?? syncError}
            aria-label={`Retry: ${createError ?? syncError ?? "unknown error"}`}
          >
            <IconAlert />
          </button>
        </span>
      )}
    </span>
  );
}

// ─── Injection: per-file React roots ───────────────────────────────────

/** Active React roots keyed by root DOM id. */
const activeRoots = new Map<string, Root>();

/** Clean up all injected buttons and React roots. */
function destroyAllButtons() {
  for (const [id, root] of activeRoots) {
    root.unmount();
    const el = document.getElementById(id);
    el?.remove();
  }
  activeRoots.clear();
}

/** Inject (or refresh) a button for a single file header. */
function injectFileButton(header: Element, ref: GitHubPullRequestRef, filename: string): void {
  if (hasFileButton(header)) {
    return;
  }

  const id = fileButtonRootId(filename);

  if (activeRoots.has(id)) {
    return;
  }

  const span = document.createElement("span");
  span.id = id;

  // Inject next to the "Copy to clipboard" button rather than at the end
  // of the file header. GitHub uses aria-label for the copy button.
  const copyBtn = header.querySelector('[aria-label*="Copy" i]');
  if (copyBtn?.parentElement) {
    copyBtn.parentElement.after(span);
  } else {
    header.appendChild(span);
  }

  const root = createRoot(span);
  root.render(<FileButton prRef={ref} filename={filename} />);
  // React 19 createRoot may clear container attributes — re-apply id after render.
  span.id = id;
  activeRoots.set(id, root);
}

/**
 * Inject buttons for all currently-visible markdown file headers, and set
 * up a MutationObserver to handle dynamically loaded diffs (GitHub lazy-
 * loads file content as you scroll within the Files Changed tab).
 */
function injectAllFileButtons(ref: GitHubPullRequestRef): void {
  const headers = findInjectionAnchors(document);
  for (const header of headers) {
    const filename = getFileHeaderFilename(header);
    if (!filename) continue;
    injectFileButton(header, ref, filename);
  }
}

/**
 * Observes the diff container for newly-appearing `.file-header` elements
 * and injects buttons for any markdown files that don't have one yet.
 */
function observeFileHeaders(ref: GitHubPullRequestRef): MutationObserver {
  const observer = new MutationObserver(() => {
    injectAllFileButtons(ref);
  });

  // Try known diff containers first; fall back to document body only if
  // nothing else matches.  Log the chosen target so stale selectors are
  // visible in the console (Gatekeeper suggestion).
  const diffContainer =
    document.querySelector("#files") ??
    document.querySelector(".js-diff-progressive-container") ??
    document.querySelector('[class*="diff-view"]') ??
    document.querySelector("#discussion_bucket") ??
    document.body;

  observer.observe(diffContainer, {
    childList: true,
    subtree: true
  });

  return observer;
}

let currentObserver: MutationObserver | null = null;
let currentRef: GitHubPullRequestRef | null = null;

function sameRef(a: GitHubPullRequestRef, b: GitHubPullRequestRef): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.prNumber === b.prNumber;
}

function ensureInjected() {
  const ref = parseGitHubPullRequestUrl(window.location.href);
  if (!ref) {
    destroyAllButtons();
    return;
  }

  // If the PR changed, tear down everything and start fresh
  if (currentRef && !sameRef(currentRef, ref)) {
    currentObserver?.disconnect();
    destroyAllButtons();
    currentRef = null;
  }

  injectAllFileButtons(ref);

  currentObserver ??= observeFileHeaders(ref);

  currentRef = ref;
}

// ─── Entrypoint ────────────────────────────────────────────────────────

const INJECTED_STYLE_ID = "dorv-file-btn-styles";

function injectStylesOnce(): void {
  if (document.getElementById(INJECTED_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = INJECTED_STYLE_ID;
  style.textContent = `
${tokensCss}
${animationsCss}
.dorv-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  vertical-align: middle;
}
.dorv-file-btn-set {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  outline: 2px solid rgba(249, 115, 22, 0.35);
  outline-offset: 0px;
  position: relative;
}
.dorv-file-btn-set::before {
  content: "";
  position: absolute;
  top: -6px;
  left: -6px;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--dorv-bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128'%3E%3Cpath d='M34 64 A30 30 0 0 1 94 64' fill='none' stroke='%23F97316' stroke-width='12' stroke-linecap='round'/%3E%3Cpath d='M94 64 A30 30 0 0 1 34 64' fill='none' stroke='%23F8FAFC' stroke-width='12' stroke-linecap='round'/%3E%3Cpolyline points='88,52 94,64 82,64' fill='none' stroke='%23F97316' stroke-width='12' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpolyline points='40,76 34,64 46,64' fill='none' stroke='%23F8FAFC' stroke-width='12' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-size: 10px 10px;
  background-position: center;
  background-repeat: no-repeat;
}
.dorv-file-btn-el {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1.5px solid var(--dorv-orange);
  background: var(--dorv-gh-btn-bg);
  color: var(--dorv-orange);
  cursor: pointer;
  opacity: 1;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.dorv-icon {
  display: block;
  flex-shrink: 0;
}
.dorv-file-btn-el:hover:not(:disabled) {
  background: var(--dorv-orange);
  color: var(--dorv-text-on-accent);
}
.dorv-file-btn-el:disabled {
  opacity: 0.6;
  cursor: default;
}
.dorv-file-btn-retry {
  border-color: var(--dorv-gh-error-text);
  color: var(--dorv-gh-error-text);
}
.dorv-file-btn-retry:hover:not(:disabled) {
  background: var(--dorv-gh-error-text);
  color: var(--dorv-text-on-accent);
}
.dorv-stale-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--dorv-gh-warning-text);
  background: var(--dorv-gh-stale-bg);
  border: 1.5px solid var(--dorv-gh-stale-border);
  border-radius: 50%;
  cursor: help;
}
.dorv-stale-badge .dorv-icon {
  width: 12px;
  height: 12px;
}
.dorv-state-enter {
  animation: dorv-fade-in 0.15s ease-out;
}
.dorv-version-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--dorv-orange);
  color: var(--dorv-text-on-accent);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
`;
  document.head.appendChild(style);
}

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*", "https://github.com/*/*/pull/*/*"],
  runAt: "document_idle",
  main(_ctx: ContentScriptContext) {
    void _ctx; // required by WXT, unused by this entrypoint
    injectStylesOnce();
    ensureInjected();

    document.addEventListener("turbo:load", () => {
      currentObserver?.disconnect();
      currentObserver = null;
      destroyAllButtons();
      ensureInjected();
    });
  }
});
