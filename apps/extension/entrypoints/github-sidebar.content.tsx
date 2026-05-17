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
import { createDocViaBackground } from "../lib/adapters/messages.js";
import type { MarkdownFileRef } from "../lib/adapters/types.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea);

const ROOT_ID = "dorv-pr-sidebar-root";
let currentUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;

function GithubSidebar({
  model,
  onCreate
}: {
  model: PrSidebarModel;
  onCreate?: () => Promise<void>;
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

  return (
    <aside className="dorv-pr-sidebar" data-dorv-surface="github-pr-sidebar">
      <style>{styles}</style>
      <header>
        <strong>{model.title}</strong>
      </header>
      {model.kind === "needs-setup" && <p className="dorv-needs-setup">{model.message}</p>}
      {model.kind === "loading" && <p>{model.message}</p>}
      {model.kind === "error" && <p className="dorv-error">{model.message}</p>}
      {model.kind === "no-doc" && (
        <>
          <ul>
            {model.files.map((file) => (
              <li key={file.filename}>
                <span>{file.filename}</span>
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
          <button type="button">{model.syncNowLabel}</button>
        </>
      )}
      {model.kind === "stale" && (
        <>
          <p className="dorv-stale">{model.staleLabel}</p>
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
      const props = onCreate !== undefined ? { model, onCreate } : { model };
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
.dorv-pr-sidebar {
  background-color: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #1f2328;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
  color: #57606a;
}
.dorv-pr-sidebar a {
  color: #0969da;
  font-weight: 600;
  text-decoration: none;
}
.dorv-pr-sidebar button {
  background: #f6f8fa;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: #1f2328;
  cursor: pointer;
  font-weight: 600;
  padding: 6px 10px;
  width: 100%;
}
.dorv-pr-sidebar button:disabled {
  color: #8c959f;
  cursor: default;
}
.dorv-needs-setup {
  color: #57606a;
  font-size: 12px;
  margin: 0;
}
.dorv-error {
  color: #cf222e;
  font-size: 12px;
  margin: 0 0 8px;
}
.dorv-stale {
  background: #fff8c5;
  border: 1px solid #d4a72c;
  border-radius: 6px;
  margin: 0 0 8px;
  padding: 6px 8px;
}
@media (prefers-color-scheme: dark) {
  .dorv-pr-sidebar {
    background-color: #161b22;
    border-color: #30363d;
    color: #e6edf3;
  }
  .dorv-pr-sidebar small {
    color: #8b949e;
  }
  .dorv-pr-sidebar a {
    color: #58a6ff;
  }
  .dorv-pr-sidebar button {
    background: #21262d;
    border-color: #30363d;
    color: #e6edf3;
  }
  .dorv-stale {
    background: #2d2a16;
    border-color: #9e6a03;
    color: #e3b341;
  }
}
`;
