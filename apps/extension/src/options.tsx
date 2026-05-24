import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { createSettingsStore } from "../lib/storage/stores.js";
import { initSentryForSurface } from "../lib/telemetry/sentry.js";
import { isSidePanelSupported } from "../lib/compat.js";
import "./options.css";

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea, createChromeStorageArea(chrome.storage.managed));
const settingsStore = createSettingsStore(storageArea);

initSentryForSurface("options");

function Options() {
  const [githubPat, setGithubPat] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [isManagedBackend, setIsManagedBackend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [autoOpen, setAutoOpen] = useState(true);
  const sidePanelSupported = isSidePanelSupported();
  // const browserKind = detectBrowserKind();

  useEffect(() => {
    async function load() {
      const pat = await authStore.getGitHubToken();
      setGithubPat(pat ? `****${pat.slice(-4)}` : "");

      const isManaged = await authStore.isManagedBackendUrl();
      setIsManagedBackend(isManaged);

      const url = await authStore.getBackendUrl();
      setBackendUrl(url ?? "");

      let token: string | undefined;
      try {
        token = await authStore.getGoogleToken(false);
      } catch {
        // No cached token — show disconnected state
      }
      setGoogleConnected(!!token);
      setAutoOpen(await settingsStore.getAutoOpenSidepanel());
      setLoading(false);
    }
    void load();
  }, []);

  const validateAndSaveGithub = async () => {
    setNotice(undefined);
    if (!githubPat) {
      await authStore.clearGitHubToken();
      setNotice("GitHub PAT cleared.");
      return;
    }

    if (githubPat.startsWith("****")) {
      return;
    }

    setValidating(true);
    try {
      const resp = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${githubPat}` }
      });

      if (resp.ok) {
        await authStore.setGitHubToken(githubPat);
        setGithubPat(`****${githubPat.slice(-4)}`);
        setNotice("GitHub PAT validated and saved.");
      } else {
        setNotice(`Validation failed: ${resp.status.toString()} ${resp.statusText}`);
      }
    } catch (err) {
      setNotice(`Validation error: ${String(err)}`);
    } finally {
      setValidating(false);
    }
  };

  const saveBackend = () => {
    void authStore.setBackendUrl(backendUrl).then(() => {
      setNotice("Backend URL saved.");
    });
  };

  const toggleGoogle = () => {
    if (googleConnected) {
      void authStore.revokeGoogleToken().then(() => {
        setGoogleConnected(false);
      });
    } else {
      void authStore.getGoogleToken(true).then((token) => {
        setGoogleConnected(!!token);
      });
    }
  };

  if (loading)
    return (
      <div className="options-shell dorv-state-enter">
        <div className="options-container">
          <div className="dorv-skeleton options-skeleton-title" />
          <div className="dorv-skeleton options-skeleton-line" />
          <div className="dorv-skeleton options-skeleton-card" />
        </div>
      </div>
    );

  return (
    <div className="options-shell dorv-state-enter">
      <div className="options-container">
        <header className="options-header">
          <img src="/dorv.svg" alt="" className="options-logo" />
          <div>
            <p className="eyebrow">dorv</p>
            <h1>Extension Settings</h1>
            <p className="options-subtitle">Sync GitHub review threads with Google Docs.</p>
          </div>
        </header>

        {!sidePanelSupported && (
          <div className="compat-warning dorv-state-enter" role="alert">
            <strong>Browser compatibility notice:</strong> The side panel is not supported in your
            current browser. dorv works best in Chrome 114+ or Edge 114+. Comment sync will continue
            to function, but the side panel UI will not be available.
          </div>
        )}

        {notice && <p className="save-confirmation dorv-state-enter">{notice}</p>}

        <main>
          <section>
            <h2>GitHub Authentication</h2>
            <p className="description">
              Provide a GitHub PAT that can read PR markdown and write PR comments. Org repos may
              require an org-owned, approved fine-grained token.
            </p>
            <div className="input-group">
              <input
                type="password"
                value={githubPat}
                placeholder="ghp_..."
                onChange={(e) => {
                  setGithubPat(e.target.value);
                }}
                disabled={validating}
              />
              <button
                type="button"
                onClick={() => {
                  void validateAndSaveGithub();
                }}
                disabled={validating}
              >
                {validating ? "Validating..." : "Validate & Save"}
              </button>
            </div>
          </section>

          <section>
            <h2>Google Authentication</h2>
            <p className="description">
              Connect your Google account to sync review comments to Google Docs.
            </p>
            <button
              type="button"
              className={googleConnected ? "secondary" : "primary"}
              onClick={() => {
                toggleGoogle();
              }}
            >
              {googleConnected ? "Sign Out from Google" : "Connect Google Account"}
            </button>
          </section>

          <section>
            <h2>Behaviour</h2>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={autoOpen}
                onChange={(e) => {
                  const value = e.target.checked;
                  setAutoOpen(value);
                  void settingsStore.setAutoOpenSidepanel(value);
                }}
              />
              <span>Automatically open sidepanel on linked reviews (Chrome only)</span>
            </label>
          </section>

          <section>
            <h2>Advanced</h2>
            <p className="description">Custom backend URL (DirectAdapter is used if empty).</p>
            <div className="input-group">
              <input
                type="text"
                value={backendUrl}
                placeholder="https://api.dorv.dev"
                onChange={(e) => {
                  setBackendUrl(e.target.value);
                }}
                disabled={isManagedBackend}
              />
              {isManagedBackend && <span className="badge-it">Set by IT</span>}
            </div>
            {!isManagedBackend && (
              <button
                type="button"
                onClick={() => {
                  saveBackend();
                }}
              >
                Save Backend URL
              </button>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>
  );
}
