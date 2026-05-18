# @dorv/extension

Chrome extension (WXT + React) that syncs GitHub PR review comments with Google Docs.

## Development

```bash
# Install deps (from monorepo root)
pnpm install

# Dev server — builds to .output/chrome-mv3-dev/
pnpm --filter @dorv/extension dev

# Production build
pnpm --filter @dorv/extension build

# Produce distributable zip
pnpm --filter @dorv/extension zip
```

`GOOGLE_CLIENT_ID` is read at build time for the OAuth manifest entry. Copy `.env.example` to `.env` and fill in your value before building.

## Load unpacked (local development)

1. Run `pnpm --filter @dorv/extension dev` — builds to `.output/chrome-mv3-dev/`.
2. Open **chrome://extensions**, enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**, select `.output/chrome-mv3-dev/` inside this directory.
4. The **dorv** extension appears in the toolbar. Pin it for easy access.

After code changes WXT auto-reloads the extension; no manual reload needed.

## Options setup

Open the extension options (right-click the extension icon → **Options**, or visit `chrome-extension://<id>/options.html`):

1. **GitHub PAT** — paste a token that can read PR markdown and write PR comments, click **Validate & Save**. For GitHub Organization repositories, see [GitHub authentication](../../docs/GITHUB_AUTH.md).
2. **Google Account** — click **Connect Google Account** and approve the OAuth consent screen (`documents` + `drive.file` scopes only).
3. **Backend URL** — leave blank to use DirectAdapter (PAT + `chrome.identity`, no server). Set to your backend endpoint to switch to BackendAdapter (future).

## Enterprise / admin deployment

Admins can pre-configure `backend_url` via Chrome managed storage so end-users cannot change it. The options page shows a **Set by IT** badge and disables the field when a managed value is present.

### Managed storage policy schema

```json
{
  "backend_url": {
    "Value": "https://api.dorv.yourcompany.com"
  }
}
```

### Force-install via Google Admin

1. **Admin console → Devices → Chrome → Apps & extensions → Users & browsers**.
2. Click **+** → **Add from Chrome Web Store** (or upload the zip for unlisted distribution).
3. Set install policy to **Force install**.
4. Under **Policy for extensions**, paste the JSON above to push `backend_url`.

Users get the extension automatically on managed Chrome profiles; the Backend URL field is locked.

### Packaging for distribution

```bash
pnpm --filter @dorv/extension zip
# Output: .output/dorvextension-<version>-chrome.zip
```

Upload to the Chrome Web Store developer dashboard or distribute via Google Admin for unlisted installs.

## Release automation

The `Release` GitHub Actions workflow builds the extension zip, submits it to Chrome Web Store, and creates the matching GitHub tag/release.

Required repository secrets:

| Secret | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID embedded in the extension manifest at build time |
| `CWS_CLIENT_ID` | OAuth client ID for the Chrome Web Store API project |
| `CWS_CLIENT_SECRET` | OAuth client secret for the Chrome Web Store API project |
| `CWS_REFRESH_TOKEN` | Refresh token with `https://www.googleapis.com/auth/chromewebstore` scope |
| `CWS_PUBLISHER_ID` | Chrome Web Store publisher ID |
| `CWS_EXTENSION_ID` | Chrome Web Store item ID |

To release:

1. Update `apps/extension/package.json` with the new version.
2. Merge the release-ready PR to `main`.
3. Run **Actions → Release → Run workflow**.
4. Leave `version` blank to use `apps/extension/package.json`, or enter an explicit SemVer value.
5. Keep `publish_to_chrome` enabled for a real Chrome Web Store submission; disable it to create only the GitHub release artifact.
