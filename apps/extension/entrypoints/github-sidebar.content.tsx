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
import type { PrSidebarModel } from "../lib/github/pr-sidebar.js";

const ROOT_ID = "dorv-pr-sidebar-root";

function GithubSidebar({ model }: { model: PrSidebarModel }) {
  if (model.kind === "hidden") {
    return null;
  }

  return (
    <aside className="dorv-pr-sidebar" data-dorv-surface="github-pr-sidebar">
      <style>{styles}</style>
      <header>
        <strong>{model.title}</strong>
      </header>
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
          <button type="button">{model.primaryActionLabel}</button>
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

async function renderGithubSidebar(ctx: ContentScriptContext) {
  const ref = parseGitHubPullRequestUrl(window.location.href);
  const sidebar = document.querySelector<HTMLElement>(
    "#partial-discussion-sidebar, .Layout-sidebar"
  );

  const files =
    ref === undefined ? [] : filterMarkdownFiles(await fetchPullRequestFiles(ref, { fetch }));
  const model = buildPrSidebarModel({ files, mode: "no-doc" });
  const existingRoot = document.getElementById(ROOT_ID);

  if (model.kind === "hidden") {
    existingRoot?.remove();
    return;
  }

  existingRoot?.remove();

  const ui = await createShadowRootUi(ctx, {
    name: ROOT_ID,
    position: "inline",
    anchor: sidebar ?? document.body,
    append: "first",
    onMount(container) {
      const root = document.createElement("div");
      root.id = ROOT_ID;
      container.append(root);
      createRoot(root).render(<GithubSidebar model={model} />);
    }
  });

  ui.mount();
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
  }
  .dorv-error {
    color: #cf222e;
  }
  .dorv-stale {
    background: #fff8c5;
    border: 1px solid #d4a72c;
    border-radius: 6px;
    margin: 0 0 8px;
    padding: 6px 8px;
  }
`;
