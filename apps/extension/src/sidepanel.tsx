import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createDocStore, createStatusStore, createActivityStore } from "../lib/storage/stores.js";
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
import { initSentryForSurface, captureExtensionException } from "../lib/telemetry/sentry.js";
import type { AuthStore } from "../lib/storage/auth.js";
import type {
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncStatus,
  CommentMapping,
  MarkdownFileRef,
  SyncedActivity
} from "../lib/adapters/types.js";
import type { GitHubPullRequestRef } from "../lib/github/pr-files.js";
import "./sidepanel.css";

function IconButton({
  icon,
  label,
  href,
  disabled,
  testId
}: {
  icon: string;
  label: string;
  href?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <a
      href={disabled ? undefined : href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="dorv-icon-btn"
      aria-disabled={disabled ? "true" : undefined}
      data-testid={testId}
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
    <div className={`dorv-skeleton-stack ${variant}`} data-testid="dorv-skeleton">
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
const activityStore = createActivityStore(storageArea);
const queryClient = createSidepanelQueryClient();

initSentryForSurface("sidepanel");

type TabKind = "loading" | "gdoc" | "github-pr" | "neutral";
type TabType = "github" | "gdoc" | "activities";
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
    <div className="dorv-sidepanel onboarding" data-testid="dorv-onboarding">
      <p className="dorv-eyebrow">dorv</p>

      {step === "github" && (
        <div key={animKey} className="onboarding-step fade-in">
          <div className="step-indicator">Step 1 of 2</div>
          <h1>Connect GitHub</h1>
          <p className="onboarding-desc">
            Paste a GitHub personal access token so dorv can read PR files and post review comments.
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
            data-testid="dorv-pat-input"
          />
          <details className="pat-scope-details">
            <summary className="pat-scope-summary">Required scopes</summary>
            <div className="pat-scope-body">
              <p className="pat-scope-kind">Classic PAT</p>
              <ul className="pat-scope-list">
                <li>
                  <code>repo</code> — full repo access (private repos)
                </li>
                <li>
                  <code>public_repo</code> — public repos only
                </li>
              </ul>
              <p className="pat-scope-kind">Fine-grained PAT</p>
              <ul className="pat-scope-list">
                <li>Pull requests — Read and write</li>
                <li>Contents — Read-only</li>
              </ul>
              <a
                className="pat-scope-link"
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                Create a token on GitHub →
              </a>
            </div>
          </details>
          {error && (
            <p className="onboarding-error" data-testid="dorv-onboarding-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="onboarding-btn"
            disabled={saving}
            onClick={() => void handleSavePat()}
            data-testid="dorv-onboarding-continue"
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
          {error && (
            <p className="onboarding-error" data-testid="dorv-onboarding-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="onboarding-btn"
            disabled={saving}
            onClick={() => void handleGoogleAuth()}
            data-testid="dorv-onboarding-google"
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
          <button
            type="button"
            className="onboarding-btn"
            onClick={onComplete}
            data-testid="dorv-onboarding-get-started"
          >
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
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [pastDocs, setPastDocs] = useState<DocMapping[]>([]);
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [activities, setActivities] = useState<SyncedActivity[]>([]);

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
        queryFn: () => adapter.getGHComments(m),
        staleTime: 0
      }),
      queryClient.fetchQuery({
        queryKey: gdKey,
        queryFn: () => adapter.getDocComments(m),
        staleTime: 0
      }),
      queryClient.fetchQuery({
        queryKey: cmKey,
        queryFn: () => adapter.getCommentMappings(m),
        staleTime: 0
      }),
      queryClient.fetchQuery({
        queryKey: statusKey,
        queryFn: () => statusStore.get(m.repo, m.prNumber),
        staleTime: 0
      })
    ]);
    setGhComments(gh);
    setGdocComments(gd);
    setCommentMappings(cm);
    setStatus(s);
    const prActivities = await activityStore.listByPR(m.repo, m.prNumber);
    setActivities(prActivities);
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
        const cached = queryClient.getQueryData<DocMapping | null>(docKey);
        const m =
          cached ??
          (await queryClient.fetchQuery({
            queryKey: docKey,
            queryFn: () =>
              adapter
                .getDoc({
                  repo: `${ref.owner}/${ref.repo}`,
                  prNumber: ref.prNumber
                })
                .then((d) => d ?? null)
          }));
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

  // Auto-refresh: while the sidepanel is open and a doc is loaded, sync every 30s.
  // lastSyncAt in the dep array restarts the timer whenever Sync now is clicked.
  useEffect(() => {
    if (!mapping) return;
    const captured = mapping;
    const id = setInterval(() => {
      void syncNowViaBackground()
        .then(() => loadSyncData(captured))
        .catch((err: unknown) => {
          console.debug("[dorv] auto-refresh error:", err);
          captureExtensionException(err, {
            surface: "sidepanel",
            tags: { operation: "auto_refresh" }
          });
        });
    }, 30_000);
    return () => {
      clearInterval(id);
    };
  }, [mapping?.docId, lastSyncAt]);

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
      captureExtensionException(err, {
        surface: "sidepanel",
        tags: { operation: "create_doc" }
      });
    } finally {
      setCreating(false);
    }
  };

  const groupedGhComments = useMemo(() => groupCommentsByPath(ghComments), [ghComments]);

  const toggleThread = (rootId: number) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });
  };

  const unmappedGdocComments = useMemo(() => {
    return gdocComments.filter(
      (gd) =>
        !commentMappings.some((cm) => cm.docCommentId === gd.id) &&
        !gd.content.startsWith("[GitHub: ")
    );
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
      captureExtensionException(err, {
        surface: "sidepanel",
        tags: { operation: "push_comment" }
      });
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
      setLastSyncAt(Date.now());
    } catch (err) {
      alert(`Sync failed: ${String(err)}`);
      captureExtensionException(err, {
        surface: "sidepanel",
        tags: { operation: "manual_sync" }
      });
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
      <div className="dorv-sidepanel" data-testid="dorv-checking">
        <SkeletonRows variant="compact" />
      </div>
    );

  if (onboarding === "github" || onboarding === "google") {
    return (
      <div className="dorv-sidepanel" data-testid="dorv-onboarding-container">
        <OnboardingFlow
          initialStep={onboarding}
          authStore={authStore}
          onComplete={() => {
            setOnboarding("complete");
          }}
        />
      </div>
    );
  }

  if (loading)
    return (
      <div className="dorv-sidepanel" data-testid="dorv-loading">
        <SkeletonRows />
      </div>
    );
  if (error)
    return (
      <div className="dorv-sidepanel error" data-testid="dorv-error">
        {error}
      </div>
    );

  if (tabKind === "neutral") {
    return (
      <div className="dorv-sidepanel" data-testid="dorv-neutral">
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
          <p className="neutral-msg" data-testid="dorv-neutral-msg">
            Open a GitHub PR or linked Google Doc to get started.
          </p>
        ) : (
          <>
            <h2 className="past-docs-heading" data-testid="dorv-past-docs-heading">
              Recent reviews
            </h2>
            <ul className="past-docs-list" data-testid="dorv-past-docs-list">
              {pastDocs.map((doc) => (
                <li
                  key={doc.docId}
                  className="past-docs-item"
                  data-testid={`dorv-past-doc-${doc.docId}`}
                >
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
      <div className="dorv-sidepanel" data-testid="dorv-unlinked-pr">
        <p className="dorv-eyebrow">dorv</p>
        {prFiles.length === 0 ? (
          <p className="neutral-msg" data-testid="dorv-no-md-files">
            No markdown files found in this PR.
          </p>
        ) : (
          <>
            <h1 data-testid="dorv-create-doc-title">Create Review Doc</h1>
            <ul className="file-list" data-testid="dorv-file-list">
              {prFiles.map((f) => (
                <li
                  key={f.filename}
                  className="file-list-item"
                  data-testid={`dorv-file-item-${f.filename}`}
                >
                  {f.filename}
                </li>
              ))}
            </ul>
            {createError && (
              <p className="onboarding-error" data-testid="dorv-create-error">
                {createError}
              </p>
            )}
            <button
              type="button"
              className="onboarding-btn"
              disabled={creating}
              onClick={() => void handleCreateDoc()}
              data-testid="dorv-create-doc-btn"
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
      <div className="dorv-sidepanel" data-testid="dorv-no-mapping">
        <p className="dorv-eyebrow">dorv</p>
        <p className="neutral-msg">Open a GitHub PR or linked Google Doc to get started.</p>
      </div>
    );
  }

  return (
    <main className="dorv-sidepanel" data-testid="dorv-main-panel">
      {!compat.compatible && compat.warning && (
        <div className="dorv-compat-warning" role="alert">
          <strong>Compatibility notice</strong>
          <p>{compat.warning}</p>
        </div>
      )}
      <header className="dorv-header" data-testid="dorv-header">
        <div className="dorv-header-title">
          <p className="dorv-eyebrow">dorv</p>
          <h1>Review Sync</h1>
        </div>
        <div className="dorv-header-actions">
          <IconButton
            icon="ti-brand-github"
            label="Open GitHub PR"
            href={`https://github.com/${mapping.repo}/pull/${mapping.prNumber.toString()}`}
            testId="dorv-open-pr-btn"
          />
          <IconButton
            icon="ti-file-description"
            label="Open Google Doc"
            href={mapping.docUrl}
            disabled={!mapping.docUrl}
            testId="dorv-open-doc-btn"
          />
          <button
            type="button"
            className="dorv-close-btn"
            aria-label="Close panel"
            onClick={() => void closeSidePanelViaBackground()}
            data-testid="dorv-close-panel-btn"
          >
            ›
          </button>
          <button
            type="button"
            className="sync-now-btn"
            disabled={syncingNow}
            onClick={() => void handleManualSync()}
            data-testid="dorv-sync-now-btn"
          >
            <i
              className={`ti ti-refresh${syncingNow ? " dorv-spinning" : ""}`}
              aria-hidden="true"
              data-testid="dorv-refresh-icon"
            />
            {syncingNow ? " Syncing…" : " Sync now"}
          </button>
        </div>
      </header>
      <div className="status-bar" data-testid="dorv-status-bar">
        <span className={`status-dot ${status?.state ?? "idle"}`} data-testid="dorv-status-dot" />
        <span>
          {status?.state === "syncing"
            ? "Syncing..."
            : `Last synced: ${new Date(mapping.lastSyncedAt).toLocaleTimeString()}`}
        </span>
      </div>

      <div className="tabs" data-testid="dorv-tabs">
        <button
          type="button"
          className={activeTab === "github" ? "active" : ""}
          onClick={() => {
            setActiveTab("github");
          }}
          data-testid="dorv-tab-github"
        >
          GitHub
        </button>
        <button
          type="button"
          className={activeTab === "gdoc" ? "active" : ""}
          onClick={() => {
            setActiveTab("gdoc");
          }}
          data-testid="dorv-tab-gdoc"
        >
          Google Doc
        </button>
        <button
          type="button"
          className={activeTab === "activities" ? "active" : ""}
          onClick={() => {
            setActiveTab("activities");
          }}
          data-testid="dorv-tab-activities"
        >
          Activities
        </button>
      </div>

      <div className="tab-content">
        {activeTab === "github" && (
          <div className="comment-list" data-testid="dorv-gh-comments">
            {groupedGhComments.length === 0 ? (
              <p className="empty-msg" data-testid="dorv-gh-empty">
                No GitHub comments yet.
              </p>
            ) : (
              groupedGhComments.map((group) => (
                <details
                  key={group.path}
                  open
                  className="file-section"
                  data-testid={`dorv-gh-file-section-${group.path}`}
                >
                  <summary>{group.path}</summary>
                  <div className="comments">
                    {group.threads.map((thread) => (
                      <div
                        key={thread.root.id}
                        className="comment-card dorv-comment-enter"
                        data-testid={`dorv-gh-comment-${String(thread.root.id)}`}
                      >
                        <div className="comment-meta">
                          <span className="author">@{thread.root.user}</span>
                          <span className="line">L{thread.root.line?.toString() ?? "?"}</span>
                          <IconButton
                            icon="ti-anchor"
                            label="Open GitHub comment"
                            href={thread.root.htmlUrl}
                            disabled={!thread.root.htmlUrl}
                          />
                        </div>
                        <div className="comment-body">{thread.root.body}</div>
                        {thread.replies.length > 0 && (
                          <>
                            <button
                              type="button"
                              className="thread-toggle"
                              onClick={() => {
                                toggleThread(thread.root.id);
                              }}
                              data-testid={`dorv-thread-toggle-${String(thread.root.id)}`}
                            >
                              <i
                                className={`ti ${expandedThreads.has(thread.root.id) ? "ti-chevron-down" : "ti-chevron-right"}`}
                                aria-hidden="true"
                              />
                              {thread.replies.length}{" "}
                              {thread.replies.length === 1 ? "reply" : "replies"}
                            </button>
                            {expandedThreads.has(thread.root.id) && (
                              <div className="thread-replies">
                                {thread.replies.map((reply) => (
                                  <div
                                    key={reply.id}
                                    className="reply-card"
                                    data-testid={`dorv-gh-reply-${String(reply.id)}`}
                                  >
                                    <div className="comment-meta">
                                      <span className="author">@{reply.user}</span>
                                      <IconButton
                                        icon="ti-anchor"
                                        label="Open GitHub comment"
                                        href={reply.htmlUrl}
                                        disabled={!reply.htmlUrl}
                                      />
                                    </div>
                                    <div className="comment-body">{reply.body}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              ))
            )}
          </div>
        )}

        {activeTab === "gdoc" && (
          <div className="comment-list" data-testid="dorv-gdoc-comments">
            <h3 data-testid="dorv-gdoc-heading">
              New GDoc Comments ({unmappedGdocComments.length.toString()})
            </h3>
            {unmappedGdocComments.some((c) => c.quotedFileContent) && (
              <button
                type="button"
                className="push-btn"
                disabled={pushingAll}
                onClick={() => void handlePushAll()}
                data-testid="dorv-push-all-btn"
              >
                {pushingAll ? "Pushing..." : "Push all"}
              </button>
            )}
            {unmappedGdocComments.length === 0 ? (
              <p className="empty-msg" data-testid="dorv-gdoc-empty">
                No new comments in GDoc.
              </p>
            ) : (
              unmappedGdocComments.map((c) => (
                <div
                  key={c.id}
                  className="comment-card gdoc dorv-comment-enter"
                  data-testid={`dorv-gdoc-comment-${c.id}`}
                >
                  <div className="comment-meta">
                    <span className="author">{c.author}</span>
                    <IconButton
                      icon="ti-anchor"
                      label="Open Google Doc comment"
                      href={mapping.docUrl}
                      disabled={!mapping.docUrl}
                    />
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
                    data-testid={`dorv-push-btn-${c.id}`}
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

        {activeTab === "activities" && (
          <div className="activities-feed" data-testid="dorv-activities">
            {activities.length === 0 ? (
              <p className="empty-msg" data-testid="dorv-activities-empty">
                No synced activities yet.
              </p>
            ) : (
              activities.map((act) => (
                <div
                  key={act.id}
                  className="activity-card dorv-comment-enter"
                  data-testid={`dorv-activity-${act.id}`}
                >
                  <div className="activity-header">
                    <span
                      className={`activity-direction ${act.direction === "github_to_gdoc" ? "dir-gh-gdoc" : "dir-gdoc-gh"}`}
                    >
                      {act.direction === "github_to_gdoc" ? "GH → GDoc" : "GDoc → GH"}
                    </span>
                    <span className="activity-time">
                      {new Date(act.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="activity-snippet">{act.snippet}</div>
                  {act.path && (
                    <div className="activity-location">
                      {act.path}
                      {act.line !== undefined && <span> L{act.line.toString()}</span>}
                    </div>
                  )}
                </div>
              ))
            )}
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
