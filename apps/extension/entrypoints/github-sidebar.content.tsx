import { createRoot } from "react-dom/client";
import { defineContentScript } from "wxt/utils/define-content-script";

const ROOT_ID = "dorv-pr-sidebar-root";

function GithubSidebar() {
  return (
    <aside data-dorv-surface="github-pr-sidebar">
      <strong>dorv</strong>
      <span> Markdown review sync ready.</span>
    </aside>
  );
}

function mountGithubSidebar() {
  if (document.getElementById(ROOT_ID) !== null) {
    return;
  }

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

  createRoot(root).render(<GithubSidebar />);
}

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  runAt: "document_idle",
  main() {
    mountGithubSidebar();
    document.addEventListener("turbo:load", mountGithubSidebar);
  }
});
