import type {
  CommentMapping,
  CreateDocInput,
  CreateDocResult,
  GoogleDocComment,
  GoogleDocReply,
  PullRequestRef,
  ReplyMapping
} from "./types.js";
import type { MarkdownFileRef } from "./types.js";
import type { GitHubPullRequestRef } from "../github/pr-files.js";

/**
 * Converts a parsed GitHub URL ref (owner + repo kept separate) into the
 * combined "owner/repo" shape that PullRequestRef and the background
 * message handlers expect. Passing a GitHubPullRequestRef directly where a
 * PullRequestRef is expected type-checks (structural typing) but silently
 * sends the bare repo name, e.g. "dorv" instead of "ahnpolished/dorv".
 */
export function toPullRequestRef(ref: GitHubPullRequestRef): PullRequestRef {
  return { repo: `${ref.owner}/${ref.repo}`, prNumber: ref.prNumber };
}

interface BackgroundResponse<T> {
  success: boolean;
  payload?: T;
  error?: string;
}

/** Default timeout for background message round-trips (30 seconds). */
const DEFAULT_MESSAGE_TIMEOUT_MS = 30_000;

function sendBackgroundMessage<T>(
  message: Record<string, unknown>,
  fallbackError: string,
  timeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Background message "${String(message.type)}" timed out after ${(timeoutMs / 1000).toString()}s.`
        )
      );
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response: BackgroundResponse<T> | undefined) => {
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? fallbackError));
        return;
      }

      if (!response?.success) {
        reject(new Error(response?.error ?? fallbackError));
        return;
      }

      resolve(response.payload);
    });
  });
}

export async function syncNowViaBackground(): Promise<void> {
  await sendBackgroundMessage<undefined>({ type: "SYNC_NOW" }, "Manual sync failed.");
}

export async function openOptionsPageViaBackground(): Promise<void> {
  await sendBackgroundMessage<undefined>(
    { type: "OPEN_OPTIONS_PAGE" },
    "Opening options page failed."
  );
}

export async function createDocViaBackground(input: CreateDocInput): Promise<CreateDocResult> {
  const payload = await sendBackgroundMessage<CreateDocResult>(
    { type: "CREATE_DOC", payload: input },
    "Google Doc creation failed."
  );

  if (!payload) {
    throw new Error("Google Doc creation returned no result.");
  }

  return payload;
}

export async function syncPRViaBackground(ref: PullRequestRef): Promise<void> {
  await sendBackgroundMessage<undefined>({ type: "SYNC_PR", payload: ref }, "PR sync failed.");
}

export async function getDocCommentsViaBackground(
  ref: PullRequestRef
): Promise<GoogleDocComment[]> {
  const payload = await sendBackgroundMessage<GoogleDocComment[]>(
    { type: "GET_DOC_COMMENTS", payload: { ref } },
    "Fetching Google Doc comments failed."
  );

  return payload ?? [];
}

export async function pushDocCommentToGHViaBackground(input: {
  ref: PullRequestRef;
  docId: string;
  comment: GoogleDocComment;
}): Promise<CommentMapping> {
  const payload = await sendBackgroundMessage<CommentMapping>(
    { type: "PUSH_DOC_COMMENT_TO_GH", payload: input },
    "Pushing comment to GitHub failed."
  );

  if (!payload) {
    throw new Error("Pushing comment to GitHub returned no result.");
  }

  return payload;
}

export async function pushDocReplyToGHViaBackground(input: {
  ref: PullRequestRef;
  docId: string;
  comment: GoogleDocComment;
  reply: GoogleDocReply;
}): Promise<ReplyMapping> {
  console.log("[dorv:msg] sending PUSH_DOC_REPLY_TO_GH — reply.id=", input.reply.id);
  const payload = await sendBackgroundMessage<ReplyMapping>(
    { type: "PUSH_DOC_REPLY_TO_GH", payload: input },
    "Pushing reply to GitHub failed."
  );

  if (!payload) {
    throw new Error("Pushing reply to GitHub returned no result.");
  }
  console.log("[dorv:msg] PUSH_DOC_REPLY_TO_GH response — ghReplyId=", payload.ghReplyId);
  return payload;
}

export interface PrFileInfo {
  files: MarkdownFileRef[];
  meta: {
    title: string;
    author: string;
    branch: string;
    headSha: string;
    prUrl: string;
  };
}

/**
 * Fetches PR file list and metadata through the background service worker.
 * Content-script `fetch()` can stall on cross-origin API calls even with
 * `host_permissions`; the background worker has unrestricted network access
 * and handles this reliably.
 */
export async function fetchPrInfoViaBackground(ref: PullRequestRef): Promise<PrFileInfo> {
  const payload = await sendBackgroundMessage<PrFileInfo>(
    { type: "FETCH_PR_INFO", payload: { ref } },
    "Fetching PR info failed."
  );

  if (!payload) {
    throw new Error("Fetching PR info returned no result.");
  }

  return payload;
}
