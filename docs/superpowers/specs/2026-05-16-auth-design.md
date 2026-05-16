# Design Spec: Auth System (HUM-1204)

**Status:** Draft
**Date:** 2026-05-16
**Issue:** [HUM-1204](https://linear.app/humphreyahn/issue/HUM-1204/auth-github-pat-google-oauth-via-chromeidentity)

## 1. Goal
Provide a secure and reliable authentication layer for the `dorv` extension to access GitHub and Google Drive/Docs APIs.

## 2. Architecture

### 2.1 Centralized `AuthStore`
A dedicated storage module in `apps/extension/lib/storage/auth.ts` will manage all credentials.

#### Interface
```typescript
export interface AuthStore {
  // GitHub
  getGitHubToken(): Promise<string | undefined>;
  setGitHubToken(token: string): Promise<void>;
  clearGitHubToken(): Promise<void>;
  
  // Google
  getGoogleToken(interactive: boolean): Promise<string | undefined>;
  revokeGoogleToken(): Promise<void>;
  
  // Backend Configuration
  getBackendUrl(): Promise<string | undefined>;
  setBackendUrl(url: string): Promise<void>;
}
```

### 2.2 Storage Mapping
| Secret | Primary Storage | Key |
| --- | --- | --- |
| GitHub PAT | `chrome.storage.local` | `github_pat` |
| Google OAuth | Managed by `chrome.identity` | — |
| Backend URL | `chrome.storage.local` | `backend_url` |

## 3. Detailed Components

### 3.1 GitHub Auth
- **Validation:** When saving a PAT in the options page, call `https://api.github.com/user` with the token. Only save if the response is 200.
- **Privacy:** In the UI, show only the last 4 characters of the PAT after it is saved.

### 3.2 Google Auth
- **Flow:** Uses `chrome.identity.getAuthToken`.
- **Background Sync:** `getGoogleToken(false)` will be used by the background worker. If a 401 is encountered, it will call `chrome.identity.removeCachedAuthToken` and retry once.
- **Interactive:** `getGoogleToken(true)` will be used in the options page to trigger the OAuth consent screen.

### 3.3 Options Page UI
- **GitHub Section:** Input (type="password") + "Validate & Save" + Status message.
- **Google Section:** "Connect Google Account" button + "Connected as [email]" + "Sign Out".
- **Backend Section:** URL input + Placeholder "Set by IT" badge.

## 4. Error Handling
- **GitHub 401/403:** Background sync will catch these and mark the PR sync as `error` in `StatusStore`.
- **Google 401:** Handled by internal retry logic in `AuthStore.getGoogleToken`.

## 5. Testing Plan
- **Unit Tests:** `lib/storage/auth.test.ts` using `createChromeStorageArea` with a mock implementation.
- **Mocking:** Mock `chrome.identity.getAuthToken` and `chrome.identity.removeCachedAuthToken` to simulate token expiration and refresh.
