import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAuthStore, type GoogleProfile } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { initSentryForSurface, captureExtensionException } from "../lib/telemetry/sentry.js";
import "./options.css";

const storageArea = createChromeStorageArea(chrome.storage.local);
const authStore = createAuthStore(storageArea, createChromeStorageArea(chrome.storage.managed));

initSentryForSurface("options");

function Options() {
  const [githubPat, setGithubPat] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleProfile, setGoogleProfile] = useState<GoogleProfile | undefined>(undefined);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isManagedBackend, setIsManagedBackend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const toggleGoogle = () => {
    if (googleConnected) {
      setGoogleLoading(true);
      void authStore.revokeGoogleToken().then(() => {
        setGoogleConnected(false);
        setGoogleProfile(undefined);
        setGoogleLoading(false);
      });
    } else {
      setGoogleLoading(true);
      setNotice(undefined);
      console.log("[dorv:options] Requesting Google token (interactive)...");
      console.log("[dorv:options] Extension ID:", chrome.runtime.id);
      void authStore
        .getGoogleToken(true)
        .then(async (token) => {
          console.log("[dorv:options] getGoogleToken resolved, token present:", !!token);
          if (token) {
            console.log("[dorv:options] Token prefix:", token.slice(0, 10) + "...");
          }
          const connected = !!token;
          setGoogleConnected(connected);
          if (connected && token) {
            try {
              console.log("[dorv:options] Fetching Google profile...");
              const profile = await authStore.getGoogleProfile(token);
              console.log("[dorv:options] Profile fetched:", profile.email);
              setGoogleProfile(profile);
            } catch (profileErr) {
              console.warn("[dorv:options] Profile fetch failed:", profileErr);
              // profile scope not yet granted (re-auth needed)
            }
          } else {
            console.log(
              "[dorv:options] No token received — user may have cancelled or OAuth failed."
            );
          }
          setGoogleLoading(false);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[dorv:options] getGoogleToken rejected:", message);
          setNotice(`Google sign-in failed: ${message}`);
          setGoogleLoading(false);
        });
    }
  };

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
        if (token) {
          try {
            const profile = await authStore.getGoogleProfile(token);
            setGoogleProfile(profile);
          } catch {
            // profile fetch may fail if scope was previously drive.file only
          }
        } else {
          // No cached token — auto-trigger interactive sign-in once
          toggleGoogle();
          setLoading(false);
          return;
        }
      } catch {
        // No cached token — auto-trigger interactive sign-in
        toggleGoogle();
        setLoading(false);
        return;
      }
      setGoogleConnected(!!token);
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
      captureExtensionException(err, {
        surface: "options",
        tags: { operation: "github_pat_validation" }
      });
    } finally {
      setValidating(false);
    }
  };

  const saveBackend = () => {
    void authStore.setBackendUrl(backendUrl).then(() => {
      setNotice("Backend URL saved.");
    });
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
              Connect your Google account to sync review comments to Google Docs. The extension uses
              your Chrome profile account — make sure you are signed into Chrome with the Google
              account you want to use.
            </p>

            <p className="extension-id-hint">
              Extension ID: <code>{chrome.runtime.id}</code>
              <br />
              This ID must be listed in your Google Cloud OAuth client.
            </p>

            {chrome.runtime.getManifest().oauth2?.client_id === "GOOGLE_CLIENT_ID" && (
              <p className="compat-warning">
                ⚠️ <strong>OAuth not configured.</strong> The OAuth client ID is still the
                placeholder &quot;GOOGLE_CLIENT_ID&quot;. Copy{" "}
                <code>apps/extension/.env.example</code> to <code>apps/extension/.env</code> and set
                a real <code>GOOGLE_CLIENT_ID</code>, then rebuild. Without this, Google sign-in
                will always fail with &quot;Error 400: invalid_request&quot;.
              </p>
            )}

            {googleConnected && googleProfile ? (
              <div className="google-profile-card">
                <img
                  className="google-avatar"
                  src={googleProfile.picture}
                  alt="Google profile"
                  referrerPolicy="no-referrer"
                />
                <div className="google-profile-info">
                  <span className="google-profile-name">{googleProfile.name}</span>
                  <span className="google-profile-email">{googleProfile.email}</span>
                </div>
                <span className="google-status-badge connected">Connected</span>
              </div>
            ) : googleConnected ? (
              <div className="google-profile-card">
                <div className="google-avatar-placeholder" />
                <div className="google-profile-info">
                  <span className="google-profile-name">Google account connected</span>
                  <span className="google-profile-email">
                    Re-authenticate to show profile details (new permission needed).
                  </span>
                </div>
                <span className="google-status-badge connected">Connected</span>
              </div>
            ) : null}

            <button
              type="button"
              className={googleConnected ? "danger" : "primary"}
              onClick={() => {
                toggleGoogle();
              }}
              disabled={googleLoading}
            >
              {googleLoading
                ? "Please wait..."
                : googleConnected
                  ? "Disconnect Google Account"
                  : "Connect Google Account"}
            </button>

            {googleConnected && !googleProfile && (
              <p className="re-auth-hint">
                To see your profile details (name, email, avatar), disconnect and reconnect to grant
                the updated permissions.
              </p>
            )}
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
