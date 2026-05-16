import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import "./options.css";

const authStore = createAuthStore(createChromeStorageArea(chrome.storage.local));

function Options() {
  const [githubPat, setGithubPat] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    async function load() {
      const pat = await authStore.getGitHubToken();
      setGithubPat(pat ? `****${pat.slice(-4)}` : "");

      const url = await authStore.getBackendUrl();
      setBackendUrl(url ?? "");

      const token = await authStore.getGoogleToken(false);
      setGoogleConnected(!!token);
      setLoading(false);
    }
    void load();
  }, []);

  const validateAndSaveGithub = async () => {
    if (!githubPat) {
      await authStore.clearGitHubToken();
      alert("GitHub PAT cleared.");
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
        alert("GitHub PAT validated and saved!");
      } else {
        alert(`Validation failed: ${resp.status.toString()} ${resp.statusText}`);
      }
    } catch (err) {
      alert(`Validation error: ${String(err)}`);
    } finally {
      setValidating(false);
    }
  };

  const saveBackend = () => {
    void authStore.setBackendUrl(backendUrl).then(() => {
      alert("Backend URL saved!");
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

  if (loading) return <div className="options-container">Loading...</div>;

  return (
    <div className="options-container">
      <header>
        <p className="eyebrow">dorv</p>
        <h1>Extension Settings</h1>
      </header>

      <main>
        <section>
          <h2>GitHub Authentication</h2>
          <p className="description">
            Provide a Personal Access Token (PAT) with <code>repo</code> scope to sync PR comments.
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
            />
            <span className="badge-it">Set by IT (Placeholder)</span>
          </div>
          <button
            type="button"
            onClick={() => {
              saveBackend();
            }}
          >
            Save Backend URL
          </button>
        </section>
      </main>
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
