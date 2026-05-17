import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { createDocStore, createStatusStore } from "../lib/storage/stores.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createAuthStore } from "../lib/storage/auth.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { parseDocId } from "../lib/gdoc/urls.js";
import { groupCommentsByPath } from "../lib/gdoc/grouping.js";
import { buildOnboardingStep } from "../lib/onboarding/model.js";
import {
  parseGitHubPullRequestUrl,
  fetchPullRequestFiles,
  filterMarkdownFiles
} from "../lib/github/pr-files.js";
import { fetchPullRequestMeta } from "../lib/github/fetch.js";
import { createDocViaBackground, syncNowViaBackground } from "../lib/adapters/messages.js";
import type { AuthStore } from "../lib/storage/auth.js";
import type {
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncStatus,
  CommentMapping,
  MarkdownFileRef
} from "../lib/adapters/types.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";
import "./sidepanel.css";

const storageArea = createChromeStorageArea(chrome.storage.local);
const docStore = createDocStore(storageArea);
const statusStore = createStatusStore(storageArea);
const authStore = createAuthStore(storageArea);

type TabKind = "loading" | "gdoc" | "github-pr" | "neutral";
type TabType = "github" | "gdoc" | "info";
type OnboardingView = "checking" | "github" | "google" | "done" | "complete";

interface OnboardingFlowProps {
  initialStep: "github" | "google";
  authStore: AuthStore;
  onComplete: () => void;
}

function OnboardingFlow({ initialStep, authStore, onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<"github" | "google" | "done">(initialStep);
  const [pat, setPat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [animKey, setAnimKey] = useState(0);

  const advance = (nextStep: "github" | "google" | "done") => {
    setAnimKey((k) => k + 1);
    setError(undefined);
    setStep(nextStep);
  };

  const handleSavePat = async () => {
    const trimmed = pat.trim();
    if (!trimmed) {
      setError("Enter a GitHub personal access token.");
      return;
    }
    setSaving(true);
    try {
      await authStore.setGitHubToken(trimmed);
      advance("google");
    } catch {
      setError("Could not save token. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleAuth = async () => {
    setSaving(true);
    try {
      await authStore.getGoogleToken(true);
      advance("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dorv-sidepanel onboarding">
      <p className="dorv-eyebrow">dorv</p>

      {step === "github" && (
        <div key={animKey} className="onboarding-step fade-in">
          <div className="step-indicator">Step 1 of 2</div>
          <h1>Connect GitHub</h1>
          <p className="onboarding-desc">
            Paste a GitHub PAT that can read PR markdown and write PR comments. Org repos may need
            an org-approved fine-grained token.
          </p>
          <input
            className="pat-input"
            type="password"
            placeholder="ghp_..."
            value={pat}
            onChange={(e) => {
              setPat(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSavePat();
            }}
            autoFocus
          />
          {error && <p className="onboarding-error">{error}</p>}
          <button
            type="button"
            className="onboarding-btn"
            disabled={saving}
            onClick={() => void handleSavePat()}
          >
            {saving ? "Saving..." : "Continue"}
          </button>
        </div>
      )}

      {step === "google" && (
        <div key={animKey} className="onboarding-step fade-in">
          <div className="step-indicator">Step 2 of 2</div>
          <h1>Connect Google</h1>
          <p className="onboarding-desc">
            Sign in with the Google account that has access to your review Google Docs.
          </p>
          {error && <p className="onboarding-error">{error}</p>}
          <button
            type="button"
            className="onboarding-btn"
            disabled={saving}
            onClick={() => void handleGoogleAuth()}
          >
            {saving ? "Signing in..." : "Sign in with Google"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div key={animKey} className="onboarding-step fade-in">
          <div className="done-icon">✓</div>
          <h1>You&apos;re set</h1>
          <p className="onboarding-desc">
            Open a Google Doc linked to a GitHub PR and dorv will sync review comments
            automatically.
          </p>
          <button type="button" className="onboarding-btn" onClick={onComplete}>
            Get started
          </button>
        </div>
      )}
    </div>
  );
}

function SidePanel() {
  const [onboarding, setOnboarding] = useState<OnboardingView>("checking");
  const [tabKind, setTabKind] = useState<TabKind>("loading");
  const [prRef, setPrRef] = useState<GitHubPullRequestRef | undefined>(undefined);
  const [prFiles, setPrFiles] = useState<MarkdownFileRef[]>([]);
  const [mapping, setMapping] = useState<DocMapping | undefined>(undefined);
  const [ghComments, setGhComments] = useState<GitHubReviewComment[]>([]);
  const [gdocComments, setGdocComments] = useState<GoogleDocComment[]>([]);
  const [commentMappings, setCommentMappings] = useState<CommentMapping[]>([]);
  const [status, setStatus] = useState<SyncStatus | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<TabType>("github");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pushingId, setPushingId] = useState<string | undefined>(undefined);
  const [pushingAll, setPushingAll] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const checkAuth = async () => {
      const [pat, googleToken] = await Promise.all([
        authStore.getGitHubToken(),
        authStore.getGoogleToken(false)
      ]);
      const step = buildOnboardingStep(!!pat, !!googleToken);
      if (step === null) {
        setOnboarding("complete");
      } else {
        setOnboarding(step.step);
      }
    };
    void checkAuth();
  }, []);

  const loadSyncData = async (m: DocMapping) => {
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
  };

  const loadData = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.url) {
        setTabKind("neutral");
        setLoading(false);
        return;
      }

      const docId = parseDocId(tab.url);
      if (docId) {
        setTabKind("gdoc");
        const m = await docStore.getByDocId(docId);
        if (m) {
          setMapping(m);
          await loadSyncData(m);
        }
        setLoading(false);
        return;
      }

      const ref = parseGitHubPullRequestUrl(tab.url);
      if (ref) {
        setTabKind("github-pr");
        setPrRef(ref);
        const pat = await authStore.getGitHubToken();
        const adapter = resolveAdapter({ authStore, storageArea });
        const m = await adapter.getDoc({
          repo: `${ref.owner}/${ref.repo}`,
          prNumber: ref.prNumber
        });
        if (m) {
          setMapping(m);
          await loadSyncData(m);
        } else {
          const files = filterMarkdownFiles(
            await fetchPullRequestFiles(ref, {
              fetch: fetch.bind(window),
              ...(pat ? { token: pat } : {})
            })
          );
          setPrFiles(files);
        }
        setLoading(false);
        return;
      }

      setTabKind("neutral");
      setLoading(false);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  useEffect(() => {
    if (onboarding === "complete") {
      void loadData();
    }
  }, [onboarding]);

  const handleCreateDoc = async () => {
    if (!prRef) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const pat = await authStore.getGitHubToken();
      if (!pat) throw new Error("GitHub token not set.");
      const meta = await fetchPullRequestMeta(prRef, {
        fetch: fetch.bind(window),
        token: pat
      });
      const result = await createDocViaBackground({
        repo: `${prRef.owner}/${prRef.repo}`,
        prNumber: prRef.prNumber,
        title: meta.title,
        author: meta.author,
        branch: meta.branch,
        headSha: meta.headSha,
        prUrl: meta.prUrl,
        files: prFiles
      });
      setMapping(result.mapping);
      await loadSyncData(result.mapping);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const groupedGhComments = useMemo(() => groupCommentsByPath(ghComments), [ghComments]);

  const unmappedGdocComments = useMemo(() => {
    return gdocComments.filter((gd) => !commentMappings.some((cm) => cm.docCommentId === gd.id));
  }, [gdocComments, commentMappings]);

  const handlePush = async (comment: GoogleDocComment) => {
    if (!mapping) return;
    setPushingId(comment.id);
    try {
      await pushDocComment(comment);
      await loadData();
      alert("Comment pushed to GitHub!");
    } catch (err) {
      alert(`Push failed: ${String(err)}`);
    } finally {
      setPushingId(undefined);
    }
  };

  const pushDocComment = async (comment: GoogleDocComment) => {
    if (!mapping) return;
    const backendUrl = await authStore.getBackendUrl();
    const adapter = resolveAdapter({ backendUrl, authStore, storageArea });
    await adapter.pushDocCommentToGH(comment, mapping);
  };

  const handlePushAll = async () => {
    const pushable = unmappedGdocComments.filter((comment) => comment.quotedFileContent);
    if (pushable.length === 0) return;

    setPushingAll(true);
    let pushed = 0;
    const failures: string[] = [];
    try {
      for (const comment of pushable) {
        setPushingId(comment.id);
        try {
          await pushDocComment(comment);
          pushed += 1;
        } catch (err) {
          failures.push(`${comment.author}: ${String(err)}`);
        }
      }
      await loadData();
      if (failures.length > 0) {
        alert(`Pushed ${pushed.toString()} comments. ${failures.length.toString()} failed.`);
      } else {
        alert(`Pushed ${pushed.toString()} comments to GitHub.`);
      }
    } finally {
      setPushingId(undefined);
      setPushingAll(false);
    }
  };

  const handleManualSync = async () => {
    setSyncingNow(true);
    try {
      await syncNowViaBackground();
      await loadData();
    } catch (err) {
      alert(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingNow(false);
    }
  };

  if (onboarding === "checking") return <div className="dorv-sidepanel">Loading...</div>;

  if (onboarding === "github" || onboarding === "google") {
    return (
      <OnboardingFlow
        initialStep={onboarding}
        authStore={authStore}
        onComplete={() => {
          setOnboarding("complete");
        }}
      />
    );
  }

  if (loading) return <div className="dorv-sidepanel">Loading...</div>;
  if (error) return <div className="dorv-sidepanel error">{error}</div>;

  if (tabKind === "neutral") {
    return (
      <div className="dorv-sidepanel">
        <p className="dorv-eyebrow">dorv</p>
        <p className="neutral-msg">Open a GitHub PR or linked Google Doc to get started.</p>
      </div>
    );
  }

  if (tabKind === "github-pr" && !mapping) {
    return (
      <div className="dorv-sidepanel">
        <p className="dorv-eyebrow">dorv</p>
        {prFiles.length === 0 ? (
          <p className="neutral-msg">No markdown files found in this PR.</p>
        ) : (
          <>
            <h1>Create Review Doc</h1>
            <ul className="file-list">
              {prFiles.map((f) => (
                <li key={f.filename} className="file-list-item">
                  {f.filename}
                </li>
              ))}
            </ul>
            {createError && <p className="onboarding-error">{createError}</p>}
            <button
              type="button"
              className="onboarding-btn"
              disabled={creating}
              onClick={() => void handleCreateDoc()}
            >
              {creating
                ? "Creating..."
                : `Create Google Doc (${prFiles.length.toString()} ${prFiles.length === 1 ? "file" : "files"})`}
            </button>
          </>
        )}
      </div>
    );
  }

  if (!mapping) {
    return (
      <div className="dorv-sidepanel">
        <p className="dorv-eyebrow">dorv</p>
        <p className="neutral-msg">Open a GitHub PR or linked Google Doc to get started.</p>
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
          <button
            type="button"
            className="sync-now-btn"
            disabled={syncingNow}
            onClick={() => void handleManualSync()}
          >
            {syncingNow ? "Syncing..." : "Sync now"}
          </button>
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
            {unmappedGdocComments.some((c) => c.quotedFileContent) && (
              <button
                type="button"
                className="push-btn"
                disabled={pushingAll}
                onClick={() => void handlePushAll()}
              >
                {pushingAll ? "Pushing..." : "Push all"}
              </button>
            )}
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
