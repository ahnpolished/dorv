import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createDocStore, createStatusStore } from "../lib/storage/stores.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { parseDocId } from "../lib/gdoc/urls.js";
import { groupCommentsByPath } from "../lib/gdoc/grouping.js";
import type {
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncStatus,
  CommentMapping
} from "../lib/adapters/types.js";
import "./sidepanel.css";

const storageArea = createChromeStorageArea(chrome.storage.local);
const docStore = createDocStore(storageArea);
const statusStore = createStatusStore(storageArea);
const authStore = createAuthStore(storageArea);

type TabType = "github" | "gdoc" | "info";

function SidePanel() {
  const [mapping, setMapping] = useState<DocMapping | undefined>(undefined);
  const [ghComments, setGhComments] = useState<GitHubReviewComment[]>([]);
  const [gdocComments, setGdocComments] = useState<GoogleDocComment[]>([]);
  const [commentMappings, setCommentMappings] = useState<CommentMapping[]>([]);
  const [status, setStatus] = useState<SyncStatus | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabType>("github");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pushingId, setPushingId] = useState<string | undefined>(undefined);

  const loadData = async () => {
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

      const [gh, gd, cm, s] = await Promise.all([
        adapter.getGHComments(m),
        adapter.getDocComments(m),
        adapter.getCommentMappings(m),
        statusStore.get(m.repo, m.prNumber)
      ]);

      setGhComments(gh);
      setGdocComments(gd);
      setCommentMappings(cm);
      setStatus(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const groupedGhComments = useMemo(() => groupCommentsByPath(ghComments), [ghComments]);

  const unmappedGdocComments = useMemo(() => {
    return gdocComments.filter((gd) => !commentMappings.some((cm) => cm.docCommentId === gd.id));
  }, [gdocComments, commentMappings]);

  const handlePush = async (comment: GoogleDocComment) => {
    if (!mapping) return;
    setPushingId(comment.id);
    try {
      const backendUrl = await authStore.getBackendUrl();
      const adapter = resolveAdapter({ backendUrl, authStore, storageArea });
      await adapter.pushDocCommentToGH(comment, mapping);
      await loadData(); // Refresh
      alert("Comment pushed to GitHub!");
    } catch (err) {
      alert(`Push failed: ${String(err)}`);
    } finally {
      setPushingId(undefined);
    }
  };

  if (loading) return <div className="dorv-sidepanel">Loading...</div>;
  if (error) return <div className="dorv-sidepanel error">{error}</div>;

  if (!mapping) {
    return (
      <div className="dorv-sidepanel">
        <p className="dorv-eyebrow">dorv</p>
        <h1>Not Linked</h1>
        <p>This Google Doc is not linked to a GitHub PR yet.</p>
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
          className={activeTab === "github" ? "active" : ""}
          onClick={() => {
            setActiveTab("github");
          }}
        >
          GitHub
        </button>
        <button
          type="button"
          className={activeTab === "gdoc" ? "active" : ""}
          onClick={() => {
            setActiveTab("gdoc");
          }}
        >
          Google Doc
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
        {activeTab === "github" && (
          <div className="comment-list">
            {groupedGhComments.length === 0 ? (
              <p className="empty-msg">No GitHub comments yet.</p>
            ) : (
              groupedGhComments.map((group) => (
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
                      </div>
                    ))}
                  </div>
                </details>
              ))
            )}
          </div>
        )}

        {activeTab === "gdoc" && (
          <div className="comment-list">
            <h3>New GDoc Comments ({unmappedGdocComments.length.toString()})</h3>
            {unmappedGdocComments.length === 0 ? (
              <p className="empty-msg">No new comments in GDoc.</p>
            ) : (
              unmappedGdocComments.map((c) => (
                <div key={c.id} className="comment-card gdoc">
                  <div className="comment-meta">
                    <span className="author">{c.author}</span>
                  </div>
                  <div className="comment-body">{c.content}</div>
                  {c.quotedFileContent && <div className="quote">"{c.quotedFileContent}"</div>}
                  <button
                    type="button"
                    className="push-btn"
                    disabled={pushingId === c.id || !c.quotedFileContent}
                    onClick={() => {
                      void handlePush(c);
                    }}
                  >
                    {pushingId === c.id ? "Pushing..." : "Push to GitHub"}
                  </button>
                </div>
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
              <label>Target Branch</label>
              <span>{mapping.headSha.slice(0, 7)}</span>
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
