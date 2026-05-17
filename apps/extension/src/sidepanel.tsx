import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createDocStore, createStatusStore } from "../lib/storage/stores.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { parseDocId } from "../lib/gdoc/urls.js";
import { groupCommentsByPath } from "../lib/gdoc/grouping.js";
import type { DocMapping, GitHubReviewComment, SyncStatus } from "../lib/adapters/types.js";
import "./sidepanel.css";

const storageArea = createChromeStorageArea(chrome.storage.local);
const docStore = createDocStore(storageArea);
const statusStore = createStatusStore(storageArea);
const authStore = createAuthStore(storageArea);

function SidePanel() {
  const [mapping, setMapping] = useState<DocMapping | undefined>(undefined);
  const [comments, setComments] = useState<GitHubReviewComment[]>([]);
  const [status, setStatus] = useState<SyncStatus | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"comments" | "info">("comments");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const load = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        if (!activeTab?.url) {
          setLoading(false);
          return;
        }

        const docId = parseDocId(activeTab.url);
        if (!docId) {
          setLoading(false);
          return;
        }

        const m = await docStore.getByDocId(docId);
        if (!m) {
          setLoading(false);
          return;
        }

        setMapping(m);

        const backendUrl = await authStore.getBackendUrl();
        const adapter = resolveAdapter({ backendUrl, authStore, storageArea });

        const [ghComments, s] = await Promise.all([
          adapter.getGHComments(m),
          statusStore.get(m.repo, m.prNumber)
        ]);

        setComments(ghComments);
        setStatus(s);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const groupedComments = useMemo(() => groupCommentsByPath(comments), [comments]);

  if (loading) return <div className="dorv-sidepanel">Loading...</div>;

  if (error) return <div className="dorv-sidepanel error">{error}</div>;

  if (!mapping) {
    return (
      <div className="dorv-sidepanel">
        <p className="dorv-eyebrow">dorv</p>
        <h1>Not Linked</h1>
        <p>This Google Doc is not linked to a GitHub PR yet. Link it from the GitHub PR Sidebar.</p>
      </div>
    );
  }

  return (
    <main className="dorv-sidepanel">
      <header>
        <p className="dorv-eyebrow">dorv</p>
        <h1>Review Sync</h1>
        <div className="status-bar">
          <span className={`status-dot ${status?.state ?? "idle"}`} />
          <span>
            {status?.state === "syncing"
              ? "Syncing..."
              : `Last synced: ${new Date(mapping.lastSyncedAt).toLocaleTimeString()}`}
          </span>
        </div>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={activeTab === "comments" ? "active" : ""}
          onClick={() => {
            setActiveTab("comments");
          }}
        >
          Comments ({comments.length.toString()})
        </button>
        <button
          type="button"
          className={activeTab === "info" ? "active" : ""}
          onClick={() => {
            setActiveTab("info");
          }}
        >
          PR Info
        </button>
      </div>

      <div className="tab-content">
        {activeTab === "comments" && (
          <div className="comment-list">
            {groupedComments.length === 0 ? (
              <p className="empty-msg">No GitHub comments found yet.</p>
            ) : (
              groupedComments.map((group) => (
                <details key={group.path} open className="file-section">
                  <summary>{group.path}</summary>
                  <div className="comments">
                    {group.comments.map((c) => (
                      <div key={c.id} className="comment-card">
                        <div className="comment-meta">
                          <span className="author">@{c.user}</span>
                          <span className="line">L{c.line?.toString() ?? "?"}</span>
                        </div>
                        <div className="comment-body">{c.body}</div>
                        <a
                          href={c.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="view-link"
                        >
                          View on GitHub
                        </a>
                      </div>
                    ))}
                  </div>
                </details>
              ))
            )}
          </div>
        )}

        {activeTab === "info" && (
          <div className="pr-info">
            <div className="info-row">
              <label>Repository</label>
              <span>{mapping.repo}</span>
            </div>
            <div className="info-row">
              <label>Pull Request</label>
              <span>#{mapping.prNumber.toString()}</span>
            </div>
            <div className="info-row">
              <label>Sync ID</label>
              <span className="small">{mapping.docId}</span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <SidePanel />
    </React.StrictMode>
  );
}
