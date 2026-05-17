import { useState } from "react";
import { createRoot } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import type { ContentScriptContext } from "wxt/utils/content-script-context";

import {
  fetchPullRequestFiles,
  filterMarkdownFiles,
  parseGitHubPullRequestUrl
} from "../lib/github/pr-files.js";
import { buildPrSidebarModel } from "../lib/github/pr-sidebar.js";
import type { PrSidebarModel, PrSidebarMode } from "../lib/github/pr-sidebar.js";

import { fetchPullRequestMeta } from "../lib/github/fetch.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createStatusStore } from "../lib/storage/stores.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { createDocViaBackground, openSidePanelViaBackground } from "../lib/adapters/messages.js";
import type { MarkdownFileRef } from "../lib/adapters/types.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";
import animationsCss from "../lib/design/animations.css?inline";
import tokensCss from "../lib/design/tokens.css?inline";

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea);

const ROOT_ID = "dorv-pr-sidebar-root";
let currentUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
// Incremented on every render call; lets stale async renders bail before mounting.
let renderGeneration = 0;

function GithubSidebar({
  model,
  onCreate,
  onSetup
}: {
  model: PrSidebarModel;
  onCreate?: () => Promise<void>;
  onSetup?: () => Promise<void>;
}) {
  const [createError, setCreateError] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  if (model.kind === "hidden") {
    return null;
  }

  const handleCreate = () => {
    if (!onCreate) return;
    setCreateError(undefined);
    setIsCreating(true);
    onCreate().catch((err: unknown) => {
      setCreateError(String(err));
      setIsCreating(false);
    });
  };

  const handleSetup = () => {
    setCreateError(undefined);
    onSetup?.().catch((err: unknown) => {
      setCreateError(String(err));
    });
  };

  const renderSyncIcon = model.kind === "linked" && model.syncState === "syncing";

  return (
    <aside className="dorv-pr-sidebar dorv-state-enter" data-dorv-surface="github-pr-sidebar">
      <style>{styles}</style>
      <header>
        <strong>{model.title}</strong>
      </header>
      {model.kind === "needs-setup" && (
        <>
          <p className="dorv-needs-setup">{model.message}</p>
          {createError && <p className="dorv-error">{createError}</p>}
          <button type="button" onClick={handleSetup}>
            {model.setupActionLabel}
          </button>
        </>
      )}
      {model.kind === "loading" && (
        <div className="dorv-loading-stack" aria-label={model.message}>
          <div className="dorv-skeleton dorv-skeleton-title" />
          <div className="dorv-skeleton dorv-skeleton-line" />
          <div className="dorv-skeleton dorv-skeleton-short" />
        </div>
      )}
      {model.kind === "error" && <p className="dorv-error">{model.message}</p>}
      {model.kind === "no-doc" && (
        <>
          <ul>
            {model.files.map((file) => (
              <li key={file.filename}>
                <span className="dorv-file-path">{file.filename}</span>
                <small>{file.status}</small>
              </li>
            ))}
          </ul>
          {createError && <p className="dorv-error">{createError}</p>}
          <button type="button" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating..." : model.primaryActionLabel}
          </button>
        </>
      )}
      {model.kind === "linked" && (
        <>
          <a href={model.docUrl} rel="noreferrer" target="_blank">
            Open review doc
          </a>
          <p>{model.lastSyncedLabel}</p>
          <small>{model.syncState}</small>
          <button type="button" className="dorv-sync-button">
            {renderSyncIcon && (
              <img src={chrome.runtime.getURL("dorv-sync.svg")} alt="" className="dorv-sync-icon" />
            )}
            {model.syncNowLabel}
          </button>
        </>
      )}
      {model.kind === "stale" && (
        <>
          <p className="dorv-stale dorv-stale-badge">{model.staleLabel}</p>
          <a href={model.docUrl} rel="noreferrer" target="_blank">
            Open review doc
          </a>
          <p>{model.lastSyncedLabel}</p>
          <button type="button">{model.syncNowLabel}</button>
        </>
      )}
    </aside>
  );
}

function buildOnCreate(
  ctx: ContentScriptContext,
  ref: GitHubPullRequestRef,
  files: MarkdownFileRef[],
  pat: string
): () => Promise<void> {
  return async () => {
    const meta = await fetchPullRequestMeta(ref, {
      fetch: fetch.bind(window),
      token: pat
    });
    await createDocViaBackground({
      repo: `${ref.owner}/${ref.repo}`,
      prNumber: ref.prNumber,
      files,
      title: meta.title,
      author: meta.author,
      branch: meta.branch,
      headSha: meta.headSha,
      prUrl: meta.prUrl
    });
    await renderGithubSidebar(ctx);
  };
}

async function renderGithubSidebar(ctx: ContentScriptContext) {
  const generation = ++renderGeneration;

  if (currentUi) {
    currentUi.remove();
    currentUi = null;
  }

  const ref = parseGitHubPullRequestUrl(window.location.href);
  const sidebar = document.querySelector<HTMLElement>(
    "#partial-discussion-sidebar, .Layout-sidebar"
  );

  const pat = await authStore.getGitHubToken();
  const hasCredentials = !!pat;

  const files =
    ref === undefined
      ? []
      : filterMarkdownFiles(
          await fetchPullRequestFiles(ref, {
            fetch: fetch.bind(window),
            ...(pat ? { token: pat } : {})
          })
        );

  const adapter = resolveAdapter({ authStore, storageArea });
  const mapping = ref ? await adapter.getDoc(ref) : undefined;
  const status = ref
    ? await createStatusStore(storageArea).get(mapping?.repo ?? "", ref.prNumber)
    : undefined;

  if (generation !== renderGeneration) {
    return;
  }

  let mode: PrSidebarMode = "no-doc";
  if (mapping) {
    mode = mapping.isStale ? "stale" : "linked";
  }

  const model = buildPrSidebarModel({ files, mode, hasCredentials, doc: mapping, status });

  if (model.kind === "hidden") {
    return;
  }

  const onCreate =
    ref && pat && model.kind === "no-doc" ? buildOnCreate(ctx, ref, files, pat) : undefined;

  const ui = await createShadowRootUi(ctx, {
    name: ROOT_ID,
    position: "inline",
    anchor: sidebar ?? document.body,
    append: "first",
    onMount(container) {
      const root = document.createElement("div");
      root.id = ROOT_ID;
      container.append(root);
      const props =
        onCreate !== undefined
          ? { model, onCreate, onSetup: openSidePanelViaBackground }
          : { model, onSetup: openSidePanelViaBackground };
      createRoot(root).render(<GithubSidebar {...props} />);
    }
  });

  ui.mount();
  currentUi = ui;
}

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  runAt: "document_idle",
  main(ctx) {
    void renderGithubSidebar(ctx);
    document.addEventListener("turbo:load", () => {
      void renderGithubSidebar(ctx);
    });
  }
});

const styles = `
${tokensCss}
${animationsCss}
.dorv-pr-sidebar {
  background-color: var(--dorv-light-surface);
  border: 1px solid var(--dorv-border-strong);
  border-radius: var(--dorv-radius);
  color: var(--dorv-text);
  font: 13px/1.45 var(--dorv-font-sans);
  margin-bottom: 12px;
  padding: 12px;
}
.dorv-pr-sidebar header {
  margin-bottom: 8px;
}
.dorv-pr-sidebar ul {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
}
.dorv-pr-sidebar li {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 4px 0;
}
.dorv-pr-sidebar small {
  color: var(--dorv-muted);
}
.dorv-pr-sidebar a {
  color: var(--dorv-orange);
  font-weight: 500;
  text-decoration: none;
}
.dorv-pr-sidebar a:hover {
  color: var(--dorv-orange-hover);
  text-decoration: underline;
}
.dorv-pr-sidebar button {
  background: var(--dorv-orange);
  border: none;
  border-radius: var(--dorv-radius-sm);
  color: var(--dorv-text-on-accent);
  cursor: pointer;
  font-weight: 500;
  padding: 6px 10px;
  width: 100%;
  transition: background 0.15s;
}
.dorv-pr-sidebar button:hover:not(:disabled) {
  background: var(--dorv-orange-hover);
}
.dorv-pr-sidebar button:disabled {
  background: var(--dorv-light-hover);
  border: 1px solid var(--dorv-border-strong);
  color: var(--dorv-muted);
  cursor: default;
}
.dorv-needs-setup {
  color: var(--dorv-muted);
  font-size: 12px;
  margin: 0;
}
.dorv-error {
  color: var(--dorv-error);
  font-size: 12px;
  margin: 0 0 8px;
}
.dorv-stale {
  background: var(--dorv-warning-subtle);
  border: 1px solid var(--dorv-warning);
  border-radius: var(--dorv-radius-sm);
  color: var(--dorv-warning);
  margin: 0 0 8px;
  padding: 6px 8px;
}
.dorv-file-path {
  font-family: var(--dorv-font-mono);
}
.dorv-loading-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dorv-skeleton-title {
  height: 14px;
  width: 62%;
}
.dorv-skeleton-line {
  height: 12px;
  width: 86%;
}
.dorv-skeleton-short {
  height: 12px;
  width: 44%;
}
.dorv-sync-button {
  align-items: center;
  display: inline-flex;
  gap: 6px;
  justify-content: center;
}
.dorv-sync-icon {
  height: 16px;
  width: 16px;
}
`;
