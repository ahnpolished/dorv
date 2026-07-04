import type {
  CommentMapping,
  CreateDocInput,
  CreateDocResult,
  GoogleDocComment,
  PullRequestRef
} from "./types.js";

interface BackgroundResponse<T> {
  success: boolean;
  payload?: T;
  error?: string;
}

function sendBackgroundMessage<T>(
  message: Record<string, unknown>,
  fallbackError: string
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse<T> | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
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
