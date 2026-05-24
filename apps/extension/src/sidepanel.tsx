import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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
import {
  createDocViaBackground,
  syncNowViaBackground,
  closeSidePanelViaBackground
} from "../lib/adapters/messages.js";
import { checkSidePanelCompat, detectBrowserKind } from "../lib/compat.js";
import { buildPastDocsList } from "../lib/sidepanel/model.js";
import {
  createSidepanelQueryClient,
  hydrateSidepanelCache,
  persistSidepanelCacheSnapshot,
  sidepanelQueryKeys
} from "../lib/sidepanel/query-cache.js";
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

function IconButton({
  icon,
  label,
  href,
  disabled
}: {
  icon: string;
  label: string;
  href?: string;
  disabled?: boolean;
}) {
  return (
    <a
      href={disabled ? undefined : href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="dorv-icon-btn"
      aria-disabled={disabled ? "true" : undefined}
      onClick={
        disabled
          ? (e) => {
              e.preventDefault();
            }
          : undefined
      }
    >
      <i className={`ti ${icon}`} aria-hidden="true" />
    </a>
  );
}

function SkeletonRows({ variant = "default" }: { variant?: "default" | "compact" }) {
  return (
    <div className={`dorv-skeleton-stack ${variant}`}>
      <div className="dorv-skeleton skeleton-title" />
      <div className="dorv-skeleton skeleton-line" />
      <div className="dorv-skeleton skeleton-short" />
      {variant === "default" && <div className="dorv-skeleton skeleton-line" />}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="push-success-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path className="dorv-check-path" d="M4 10.5 8.1 14 16 6" />
    </svg>
  );
}

const storageArea = createChromeStorageArea(chrome.storage.local);
const docStore = createDocStore(storageArea);
const statusStore = createStatusStore(storageArea);
const authStore = createAuthStore(storageArea);
const queryClient = createSidepanelQueryClient();

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
  const [isPlaywright, setIsPlaywright] = useState(false);

  useEffect(() => {
    // Disable autofocus in E2E tests to avoid annoying jumps and potential flakiness
    void storageArea.get(["is_playwright"]).then((vals) => {
      if (vals.is_playwright === true) {
        setIsPlaywright(true);
      }
    });
  }, []);

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
            autoFocus={!isPlaywright}
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
  const queryClient = useQueryClient();
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
  const [pushedId, setPushedId] = useState<string | undefined>(undefined);
  const [pushingAll, setPushingAll] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [pastDocs, setPastDocs] = useState<DocMapping[]>([]);

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
    await hydrateSidepanelCache(storageArea, queryClient, m);
    const backendUrl = await authStore.getBackendUrl();
    const adapter = resolveAdapter({ backendUrl, authStore, storageArea });
    const ghKey = sidepanelQueryKeys.ghComments(m);
    const gdKey = sidepanelQueryKeys.gdocComments(m.docId);
    const cmKey = sidepanelQueryKeys.commentMappings(m);
    const statusKey = sidepanelQueryKeys.status(m);

    const cachedGh = queryClient.getQueryData<GitHubReviewComment[]>(ghKey);
    const cachedGd = queryClient.getQueryData<GoogleDocComment[]>(gdKey);
    const cachedCm = queryClient.getQueryData<CommentMapping[]>(cmKey);
    const cachedStatus = queryClient.getQueryData<SyncStatus>(statusKey);
    if (cachedGh) setGhComments(cachedGh);
    if (cachedGd) setGdocComments(cachedGd);
    if (cachedCm) setCommentMappings(cachedCm);
    if (cachedStatus) setStatus(cachedStatus);

    const [gh, gd, cm, s] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ghKey,
        queryFn: () => adapter.getGHComments(m)
      }),
      queryClient.fetchQuery({
        queryKey: gdKey,
        queryFn: () => adapter.getDocComments(m)
      }),
      queryClient.fetchQuery({
        queryKey: cmKey,
        queryFn: () => adapter.getCommentMappings(m)
      }),
      queryClient.fetchQuery({
        queryKey: statusKey,
        queryFn: () => statusStore.get(m.repo, m.prNumber)
      })
    ]);
    setGhComments(gh);
    setGdocComments(gd);
    setCommentMappings(cm);
    setStatus(s);
    await persistSidepanelCacheSnapshot(storageArea, queryClient, m);
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
        const docKey = sidepanelQueryKeys.doc(
          `${ref.owner}/${ref.repo}#${ref.prNumber.toString()}`
        );
        const m = await queryClient.fetchQuery({
          queryKey: docKey,
          queryFn: () =>
            adapter.getDoc({
              repo: `${ref.owner}/${ref.repo}`,
              prNumber: ref.prNumber
            })
        });
        if (m) {
          setMapping(m);
          await loadSyncData(m);
        } else {
          const files = await queryClient.fetchQuery({
            queryKey: sidepanelQueryKeys.prFiles(`${ref.owner}/${ref.repo}`, ref.prNumber),
            queryFn: async () =>
              filterMarkdownFiles(
                await fetchPullRequestFiles(ref, {
                  fetch: fetch.bind(window),
                  ...(pat ? { token: pat } : {})
                })
              )
          });
          setPrFiles(files);
        }
        setLoading(false);
        return;
      }

      const docs = await queryClient.fetchQuery({
        queryKey: sidepanelQueryKeys.activePrs(),
        queryFn: () => buildPastDocsList(docStore)
      });
      setPastDocs(docs);
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

  // Fast poll: while the sidepanel is open and a doc is loaded, sync every 5s
  // instead of waiting for the 1-minute background alarm.
  useEffect(() => {
    if (!mapping) return;
    const captured = mapping;
    const id = setInterval(() => {
      void syncNowViaBackground()
        .then(() => loadSyncData(captured))
        .catch((err: unknown) => {
          console.debug("[dorv] fast poll error:", err);
        });
    }, 5_000);
    return () => {
      clearInterval(id);
    };
  }, [mapping?.docId]); // loadSyncData is stable; docId change restarts the interval

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
      await queryClient.invalidateQueries({
        queryKey: ["pr", result.mapping.repo, result.mapping.prNumber]
      });
      await queryClient.invalidateQueries({ queryKey: sidepanelQueryKeys.activePrs() });
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
      queryClient.setQueryData<GoogleDocComment[]>(
        sidepanelQueryKeys.gdocComments(mapping.docId),
        (current) => current?.filter((item) => item.id !== comment.id) ?? []
      );
      setPushedId(comment.id);
      window.setTimeout(() => {
        setPushedId(undefined);
      }, 1500);
      await invalidateSyncQueries(mapping);
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
    if (!mapping) return;
    const currentMapping = mapping;
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
          queryClient.setQueryData<GoogleDocComment[]>(
            sidepanelQueryKeys.gdocComments(currentMapping.docId),
            (current) => current?.filter((item) => item.id !== comment.id) ?? []
          );
          pushed += 1;
        } catch (err) {
          failures.push(`${comment.author}: ${String(err)}`);
        }
      }
      await invalidateSyncQueries(currentMapping);
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
      if (mapping) await invalidateSyncQueries(mapping);
      await loadData();
    } catch (err) {
      alert(`Sync failed: ${String(err)}`);
    } finally {
      setSyncingNow(false);
    }
  };

  const compat = checkSidePanelCompat(
    typeof chrome !== "undefined" ? chrome.sidePanel : undefined,
    detectBrowserKind()
  );

  const invalidateSyncQueries = async (m: DocMapping) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sidepanelQueryKeys.ghComments(m) }),
      queryClient.invalidateQueries({ queryKey: sidepanelQueryKeys.gdocComments(m.docId) }),
      queryClient.invalidateQueries({ queryKey: sidepanelQueryKeys.commentMappings(m) }),
      queryClient.invalidateQueries({ queryKey: sidepanelQueryKeys.status(m) })
    ]);
  };

  if (onboarding === "checking")
    return (
      <div className="dorv-sidepanel">
        <SkeletonRows variant="compact" />
      </div>
    );

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

  if (loading)
    return (
      <div className="dorv-sidepanel">
        <SkeletonRows />
      </div>
    );
  if (error) return <div className="dorv-sidepanel error">{error}</div>;

  if (tabKind === "neutral") {
    return (
      <div className="dorv-sidepanel">
        {!compat.compatible && compat.warning && (
          <div className="dorv-compat-warning" role="alert">
            <strong>Compatibility notice</strong>
            <p>{compat.warning}</p>
          </div>
        )}
        <div className="dorv-neutral-header">
          <p className="dorv-eyebrow">dorv</p>
          <button
            type="button"
            className="dorv-close-btn"
            aria-label="Close panel"
            onClick={() => void closeSidePanelViaBackground()}
          >
            ›
          </button>
        </div>
        {pastDocs.length === 0 ? (
          <p className="neutral-msg">Open a GitHub PR or linked Google Doc to get started.</p>
        ) : (
          <>
            <h2 className="past-docs-heading">Recent reviews</h2>
            <ul className="past-docs-list">
              {pastDocs.map((doc) => (
                <li key={doc.docId} className="past-docs-item">
                  <div className="past-docs-repo">
                    <a
                      href={`https://github.com/${doc.repo}/pull/${doc.prNumber.toString()}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {doc.repo}#{doc.prNumber.toString()}
                    </a>
                  </div>
                  <a href={doc.docUrl} target="_blank" rel="noreferrer" className="past-docs-link">
                    Open Doc
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
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
      {!compat.compatible && compat.warning && (
        <div className="dorv-compat-warning" role="alert">
          <strong>Compatibility notice</strong>
          <p>{compat.warning}</p>
        </div>
      )}
      <header className="dorv-header">
        <div className="dorv-header-title">
          <p className="dorv-eyebrow">dorv</p>
          <h1>Review Sync</h1>
        </div>
        <div className="dorv-header-actions">
          <IconButton
            icon="ti-brand-github"
            label="Open GitHub PR"
            href={`https://github.com/${mapping.repo}/pull/${mapping.prNumber.toString()}`}
          />
          <IconButton
            icon="ti-file-description"
            label="Open Google Doc"
            href={mapping.docUrl}
            disabled={!mapping.docUrl}
          />
          <button
            type="button"
            className="dorv-close-btn"
            aria-label="Close panel"
            onClick={() => void closeSidePanelViaBackground()}
          >
            ›
          </button>
          <button
            type="button"
            className="sync-now-btn"
            disabled={syncingNow}
            onClick={() => void handleManualSync()}
          >
            <i
              className={`ti ti-refresh${syncingNow ? " dorv-spinning" : ""}`}
              aria-hidden="true"
            />
            {syncingNow ? " Syncing…" : " Sync now"}
          </button>
        </div>
      </header>
      <div className="status-bar">
        <span className={`status-dot ${status?.state ?? "idle"}`} />
        <span>
          {status?.state === "syncing"
            ? "Syncing..."
            : `Last synced: ${new Date(mapping.lastSyncedAt).toLocaleTimeString()}`}
        </span>
      </div>

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
                      <div key={c.id} className="comment-card dorv-comment-enter">
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
                <div key={c.id} className="comment-card gdoc dorv-comment-enter">
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
                    {pushedId === c.id && <CheckIcon />}
                    {pushedId === c.id
                      ? "Pushed"
                      : pushingId === c.id
                        ? "Pushing..."
                        : "Push to GitHub"}
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
      <QueryClientProvider client={queryClient}>
        <SidePanel />
      </QueryClientProvider>
    </React.StrictMode>
  );
}
