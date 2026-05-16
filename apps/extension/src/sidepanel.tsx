import { createRoot } from "react-dom/client";

import "./sidepanel.css";

function SidePanel() {
  return (
    <main className="dorv-sidepanel">
      <p className="dorv-eyebrow">dorv</p>
      <h1>Google Docs review sync</h1>
      <p>Open a linked review doc to see GitHub comment sync status.</p>
    </main>
  );
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing side panel root element");
}

createRoot(root).render(<SidePanel />);
