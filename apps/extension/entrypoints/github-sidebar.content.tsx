import { createRoot } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";

import {
  buildPrSidebarState,
  fetchPullRequestFiles,
  filterMarkdownFiles,
  parseGitHubPullRequestUrl
} from "../lib/github/pr-files.js";
import type { PrSidebarState } from "../lib/github/pr-files.js";

const ROOT_ID = "dorv-pr-sidebar-root";

function GithubSidebar({ state }: { state: PrSidebarState }) {
  if (!state.visible) {
    return null;
  }

  return (
    <aside data-dorv-surface="github-pr-sidebar">
      <strong>dorv</strong>
      <ul>
        {state.files.map((file) => (
          <li key={file.filename}>
            <span>{file.filename}</span>
            <small>{file.status}</small>
          </li>
        ))}
      </ul>
      <button type="button">{state.buttonLabel}</button>
    </aside>
  );
}

async function renderGithubSidebar() {
  const ref = parseGitHubPullRequestUrl(window.location.href);
  const state = buildPrSidebarState(
    ref === undefined ? [] : filterMarkdownFiles(await fetchPullRequestFiles(ref, { fetch }))
  );

  const existingRoot = document.getElementById(ROOT_ID);
  if (!state.visible) {
    existingRoot?.remove();
    return;
  }

  existingRoot?.remove();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.style.marginTop = "8px";

  const sidebar = document.querySelector<HTMLElement>(
    "#partial-discussion-sidebar, .Layout-sidebar"
  );
  if (sidebar === null) {
    document.body.append(root);
  } else {
    sidebar.prepend(root);
  }

  createRoot(root).render(<GithubSidebar state={state} />);
}

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  runAt: "document_idle",
  main() {
    void renderGithubSidebar();
    document.addEventListener("turbo:load", () => {
      void renderGithubSidebar();
    });
  }
});
