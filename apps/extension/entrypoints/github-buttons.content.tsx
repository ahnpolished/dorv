import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentScriptContext } from "wxt/utils/content-script-context";

import {
  fetchPullRequestFiles,
  filterMarkdownFiles,
  parseGitHubPullRequestUrl
} from "../lib/github/pr-files.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";
import { fetchPullRequestMeta } from "../lib/github/fetch.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createStatusStore } from "../lib/storage/stores.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";
import {
  createDocViaBackground,
  openOptionsPageViaBackground,
  syncPRViaBackground
} from "../lib/adapters/messages.js";
import {
  fileButtonRootId,
  findInjectionAnchors,
  getFileHeaderFilename,
  hasFileButton
} from "../lib/github/button-injection.js";
import type { DocMapping, SyncStatus } from "../lib/adapters/types.js";
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
    console.log("[dorv] handleCreate called for", filename);
    setCreateError(undefined);
    setIsCreating(true);
    try {
      console.log("[dorv] getting github token...");
      const pat = await authStore.getGitHubToken();
      console.log("[dorv] token present:", !!pat);
      if (!pat) throw new Error("Missing GitHub token");
      const repo = `${ref.owner}/${ref.repo}`;

      const allFiles = filterMarkdownFiles(
        await fetchPullRequestFiles(ref, {
          fetch: fetch,
          token: pat
        })
      );
      const file = allFiles.find((f) => f.filename === filename);
      if (!file) throw new Error(`File "${filename}" not found in PR`);

      const meta = await fetchPullRequestMeta(ref, {
        fetch: fetch,
        token: pat
      });
      const result = await createDocViaBackground({
        repo,
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
      console.error("[dorv] handleCreate failed:", err);
      setCreateError(err instanceof Error ? err.message : String(err));
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
        <button
          type="button"
          className="dorv-file-btn-el dorv-file-btn-subtle"
          onClick={handleOpenOptions}
          title="Set up dorv"
        >
          📄
        </button>
      )}

      {view.kind === "no-doc" && (
        <button
          type="button"
          className="dorv-file-btn-el dorv-file-btn-create"
          onClick={() => {
            void handleCreate();
          }}
          disabled={isCreating}
          title={`Create Google Doc for ${filename}`}
        >
          {isCreating ? "⏳" : "📄"}
        </button>
      )}

      {view.kind === "linked" && (
        <span className="dorv-file-linked">
          <button
            type="button"
            className="dorv-file-btn-el dorv-file-btn-open"
            onClick={handleOpenDoc}
            title={`Open Google Doc for ${filename}`}
          >
            📄
          </button>
          <button
            type="button"
            className="dorv-file-btn-el dorv-file-btn-sync"
            onClick={() => {
              void handleSync();
            }}
            disabled={isSyncing}
            title={`Sync ${filename} to Google Doc`}
          >
            {isSyncing ? "⏳" : "🔄"}
          </button>
        </span>
      )}

      {(createError ?? syncError) && (
        <span className="dorv-file-error" title={createError ?? syncError}>
          ⚠️
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
  header.appendChild(span);

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
.dorv-file-btn-el {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--dorv-radius-sm);
  cursor: pointer;
  font-size: var(--dorv-text-xs);
  font-family: var(--dorv-font-sans);
  line-height: 1;
  padding: 1px 4px;
  opacity: 0.5;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
.dorv-file-btn-el:hover:not(:disabled) {
  opacity: 1;
  background: var(--dorv-light-hover);
  border-color: var(--dorv-border-strong);
}
.dorv-file-btn-el:disabled {
  opacity: 0.3;
  cursor: default;
}
.dorv-file-btn-create {
  color: var(--dorv-orange);
}
.dorv-file-btn-open {
  color: var(--dorv-text);
}
.dorv-file-btn-sync {
  color: var(--dorv-success);
}
.dorv-file-btn-subtle {
  color: var(--dorv-muted);
}
.dorv-file-linked {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.dorv-file-error {
  font-size: var(--dorv-text-xs);
  cursor: help;
}
.dorv-state-enter {
  animation: dorv-fade-in 0.15s ease-out;
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
