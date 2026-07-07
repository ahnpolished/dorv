import { defineBackground } from "wxt/utils/define-background";
import { createAuthStore } from "../lib/storage/auth.js";
import { createChromeStorageArea } from "../lib/storage/area.js";
import { resolveAdapter } from "../lib/adapters/resolve.js";
import { captureExtensionException, initSentryForSurface } from "../lib/telemetry/sentry.js";
import { createStatusStore } from "../lib/storage/stores.js";
import type { CreateDocInput, GoogleDocComment, PullRequestRef } from "../lib/adapters/types.js";
import { fetchPullRequestFiles, filterMarkdownFiles } from "../lib/github/pr-files.js";
import { fetchPullRequestMeta } from "../lib/github/fetch.js";

interface ChromeMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

export default defineBackground(() => {
  initSentryForSurface("background");
  const storageArea = createChromeStorageArea(chrome.storage.local);
  const authStore = createAuthStore(storageArea, createChromeStorageArea(chrome.storage.managed));
  const statusStore = createStatusStore(storageArea);

  // Auto-open the options page on extension update so the developer sees
  // the Google auth button after pulling new code. Skipped on install
  // (fresh profiles, including CI) to avoid interfering with test page
  // navigations — Chrome v130+ redirects extension pages in Playwright.
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "update") {
      void chrome.runtime.openOptionsPage();
    }
  });

  chrome.runtime.onMessage.addListener((message: ChromeMessage, _sender, sendResponse) => {
    const run = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const payload = message.payload;

        switch (message.type) {
          case "CREATE_DOC": {
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            const result = await adapter.createDoc(payload as CreateDocInput);
            sendResponse({ success: true, payload: result });
            break;
          }
          case "SYNC_NOW": {
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            await adapter.syncAll();
            sendResponse({ success: true });
            break;
          }
          case "SYNC_PR": {
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            await adapter.syncPR(payload as PullRequestRef);
            sendResponse({ success: true });
            break;
          }
          case "PUSH_DOC_COMMENT_TO_GH": {
            const { ref, docId, comment } = payload as {
              ref: PullRequestRef;
              docId: string;
              comment: GoogleDocComment;
            };
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            const mapping = await adapter.getDoc(ref);
            if (!mapping) {
              sendResponse({ success: false, error: "PR is not linked to a Google Doc." });
              break;
            }
            const result = await adapter.pushDocCommentToGH(comment, mapping, docId);
            sendResponse({ success: true, payload: result });
            break;
          }
          case "GET_DOC_COMMENTS": {
            // Content scripts can't call chrome.identity directly (not exposed
            // to the content-script execution context), so fetching Google Doc
            // comments — needed to resolve a sidebar card's full comment
            // (including quotedFileContent for line-matching) — must be
            // proxied through here rather than done in-page.
            const { ref } = payload as { ref: PullRequestRef };
            const backendUrl = await authStore.getBackendUrl();
            const adapter = resolveAdapter({
              backendUrl,
              authStore,
              storageArea
            });
            const comments = await adapter.getDocComments(ref);
            sendResponse({ success: true, payload: comments });
            break;
          }
          case "GET_SYNC_STATUS": {
            const p = payload as PullRequestRef;
            const status = await statusStore.get(p.repo, p.prNumber);
            sendResponse({ success: true, payload: status });
            break;
          }
          case "OPEN_OPTIONS_PAGE": {
            // Only available in the service worker / extension-page contexts,
            // not content scripts — this handler is why callers must go
            // through openOptionsPageViaBackground() instead of calling it directly.
            await chrome.runtime.openOptionsPage();
            sendResponse({ success: true });
            break;
          }
          case "FETCH_PR_INFO": {
            const { ref: fetchRef } = payload as { ref: PullRequestRef };
            const ghPat = await authStore.getGitHubToken();
            if (!ghPat) {
              sendResponse({ success: false, error: "Missing GitHub token" });
              break;
            }
            const [owner, name] = fetchRef.repo.split("/");
            if (!owner || !name) {
              sendResponse({ success: false, error: `Invalid repo format: ${fetchRef.repo}` });
              break;
            }
            const ghRef = { owner, repo: name, prNumber: fetchRef.prNumber };
            const files = filterMarkdownFiles(
              await fetchPullRequestFiles(ghRef, {
                fetch: fetch.bind(globalThis),
                token: ghPat
              })
            );
            const meta = await fetchPullRequestMeta(ghRef, {
              fetch: globalThis.fetch.bind(globalThis),
              token: ghPat
            });
            sendResponse({
              success: true,
              payload: {
                files,
                meta: {
                  title: meta.title,
                  author: meta.author,
                  branch: meta.branch,
                  headSha: meta.headSha,
                  prUrl: meta.prUrl
                }
              }
            });
            break;
          }
          default:
            sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (err) {
        console.error("Message handler failed:", err);
        captureExtensionException(err, {
          extra: { messageType: message.type },
          surface: "background",
          tags: { operation: "runtime_message" }
        });
        sendResponse({ success: false, error: String(err) });
      }
    };

    void run();
    return true;
  });
});
