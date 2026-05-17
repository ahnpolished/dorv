import type { CreateDocInput, CreateDocResult } from "./types.js";

interface BackgroundResponse<T> {
  success: boolean;
  payload?: T;
  error?: string;
}

export function createDocViaBackground(input: CreateDocInput): Promise<CreateDocResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "CREATE_DOC", payload: input },
      (response: BackgroundResponse<CreateDocResult> | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "Background message failed."));
          return;
        }

        if (!response?.success) {
          reject(new Error(response?.error ?? "Google Doc creation failed."));
          return;
        }

        if (!response.payload) {
          reject(new Error("Google Doc creation returned no result."));
          return;
        }

        resolve(response.payload);
      }
    );
  });
}
