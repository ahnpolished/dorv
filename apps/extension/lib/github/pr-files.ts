import type { MarkdownFileRef } from "../adapters/types.js";

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface GitHubPullFile {
  filename: string;
  status: string;
  raw_url: string;
  previous_filename?: string;
}

export interface PrSidebarState {
  visible: boolean;
  files: MarkdownFileRef[];
  buttonLabel: string;
}

export interface GitHubFileClientOptions {
  /**
   * The fetch function to use. If using window.fetch, it MUST be bound to window:
   * fetch: fetch.bind(window)
   */
  fetch: typeof fetch;
  token?: string;
}

const markdownFilePattern = /\.(md|mdx|markdown)$/i;

export function parseGitHubPullRequestUrl(url: string): GitHubPullRequestRef | undefined {
  const parsed = new URL(url);
  if (parsed.hostname !== "github.com") {
    return undefined;
  }

  const [owner, repo, resource, prNumber] = parsed.pathname.split("/").filter(Boolean);
  if (owner === undefined || repo === undefined || resource !== "pull" || prNumber === undefined) {
    return undefined;
  }

  const parsedPrNumber = Number.parseInt(prNumber, 10);
  if (Number.isNaN(parsedPrNumber)) {
    return undefined;
  }

  return { owner, repo, prNumber: parsedPrNumber };
}

export function filterMarkdownFiles(files: GitHubPullFile[]): MarkdownFileRef[] {
  return files
    .filter((file) => file.status !== "removed" && markdownFilePattern.test(file.filename))
    .map((file) => {
      const mapped: MarkdownFileRef = {
        filename: file.filename,
        rawUrl: file.raw_url,
        status: file.status
      };

      if (file.previous_filename !== undefined) {
        mapped.previousFilename = file.previous_filename;
      }

      return mapped;
    });
}

export function buildPrSidebarState(files: MarkdownFileRef[]): PrSidebarState {
  if (files.length === 0) {
    return { visible: false, files: [], buttonLabel: "" };
  }

  return {
    visible: true,
    files,
    buttonLabel: `Create Google Doc (${files.length.toString()} ${files.length === 1 ? "file" : "files"})`
  };
}

export async function fetchPullRequestFiles(
  ref: GitHubPullRequestRef,
  options: GitHubFileClientOptions
): Promise<GitHubPullFile[]> {
  const response = await options.fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.prNumber.toString()}/files`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(options.token === undefined || options.token === ""
          ? {}
          : { Authorization: `Bearer ${options.token}` })
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch PR files: ${response.status.toString()}`);
  }

  return (await response.json()) as GitHubPullFile[];
}
