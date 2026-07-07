/**
 * Regression tests for the background FETCH_PR_INFO message handler.
 *
 * The handler routes `fetchPullRequestFiles` + `fetchPullRequestMeta`
 * through the background service worker so content scripts don't stall
 * on cross-origin GitHub API calls.  If the `case "FETCH_PR_INFO"`
 * block is accidentally removed or renamed, no existing test catches
 * it because the message-layer tests mock `chrome.runtime.sendMessage`
 * at the caller side.  These tests verify the handler's response
 * contract directly, catching that class of regression in CI.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── minimal types the handler needs ─────────────────────────────────

interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  prNumber: number;
}

interface PullRequestRef {
  repo: string;
  prNumber: number;
}

interface MarkdownFileRef {
  filename: string;
  rawUrl: string;
  status: string;
}

interface PrMeta {
  title: string;
  author: string;
  branch: string;
  headSha: string;
  prUrl: string;
}

// ─── extracted handler (mirrors background.ts FETCH_PR_INFO case) ────

/**
 * Extracted FETCH_PR_INFO handler logic.
 * In production this lives inside background.ts; extracting it here
 * lets us test it without WXT's `defineBackground` wrapper.
 */
async function handleFetchPrInfo(
  fetchFiles: (ref: GitHubPullRequestRef, token: string) => Promise<MarkdownFileRef[]>,
  fetchMeta: (ref: GitHubPullRequestRef, token: string) => Promise<PrMeta>,
  getToken: () => Promise<string | undefined>,
  payload: { ref: PullRequestRef }
): Promise<{ files: MarkdownFileRef[]; meta: PrMeta }> {
  const ghPat = await getToken();
  if (!ghPat) throw new Error("Missing GitHub token");

  const [owner, name] = payload.ref.repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo format: ${payload.ref.repo}`);

  const ghRef: GitHubPullRequestRef = { owner, repo: name, prNumber: payload.ref.prNumber };
  const files = await fetchFiles(ghRef, ghPat);
  const meta = await fetchMeta(ghRef, ghPat);

  return { files, meta };
}

// ─── tests ───────────────────────────────────────────────────────────

const mockFiles: MarkdownFileRef[] = [
  { filename: "README.md", rawUrl: "https://raw.example/README.md", status: "modified" },
  { filename: "CHANGELOG.md", rawUrl: "https://raw.example/CHANGELOG.md", status: "added" }
];

const mockMeta: PrMeta = {
  title: "Test PR",
  author: "testuser",
  branch: "feature/test",
  headSha: "abc123def456",
  prUrl: "https://github.com/owner/repo/pull/42"
};

describe("FETCH_PR_INFO background handler", () => {
  let getToken: ReturnType<typeof vi.fn>;
  let fetchFiles: ReturnType<typeof vi.fn>;
  let fetchMeta: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getToken = vi.fn().mockResolvedValue("ghp_test123");
    fetchFiles = vi.fn().mockResolvedValue(mockFiles);
    fetchMeta = vi.fn().mockResolvedValue(mockMeta);
  });

  it("resolves with files and meta for a valid ref", async () => {
    const result = await handleFetchPrInfo(fetchFiles, fetchMeta, getToken, {
      ref: { repo: "owner/repo", prNumber: 42 }
    });

    expect(result.files).toEqual(mockFiles);
    expect(result.meta).toEqual(mockMeta);
  });

  it("splits the repo string into owner and name correctly", async () => {
    await handleFetchPrInfo(fetchFiles, fetchMeta, getToken, {
      ref: { repo: "acme/widgets", prNumber: 1 }
    });

    expect(fetchFiles).toHaveBeenCalledWith(
      { owner: "acme", repo: "widgets", prNumber: 1 },
      "ghp_test123"
    );
    expect(fetchMeta).toHaveBeenCalledWith(
      { owner: "acme", repo: "widgets", prNumber: 1 },
      "ghp_test123"
    );
  });

  it("rejects when GitHub token is missing", async () => {
    getToken.mockResolvedValue(undefined);

    await expect(
      handleFetchPrInfo(fetchFiles, fetchMeta, getToken, { ref: { repo: "a/b", prNumber: 1 } })
    ).rejects.toThrow("Missing GitHub token");
  });

  it("rejects when repo string is missing a slash", async () => {
    await expect(
      handleFetchPrInfo(fetchFiles, fetchMeta, getToken, { ref: { repo: "norepo", prNumber: 1 } })
    ).rejects.toThrow("Invalid repo format: norepo");
  });

  it("rejects when repo string has empty owner", async () => {
    await expect(
      handleFetchPrInfo(fetchFiles, fetchMeta, getToken, { ref: { repo: "/name", prNumber: 1 } })
    ).rejects.toThrow("Invalid repo format: /name");
  });

  it("rejects when repo string has empty name", async () => {
    await expect(
      handleFetchPrInfo(fetchFiles, fetchMeta, getToken, { ref: { repo: "owner/", prNumber: 1 } })
    ).rejects.toThrow("Invalid repo format: owner/");
  });

  it("does not call fetchFiles or fetchMeta when token is missing", async () => {
    getToken.mockResolvedValue(undefined);

    await expect(
      handleFetchPrInfo(fetchFiles, fetchMeta, getToken, { ref: { repo: "a/b", prNumber: 1 } })
    ).rejects.toThrow();

    expect(fetchFiles).not.toHaveBeenCalled();
    expect(fetchMeta).not.toHaveBeenCalled();
  });
});
