import { describe, expect, it } from "vitest";

import {
  buildPrSidebarState,
  filterMarkdownFiles,
  parseGitHubPullRequestUrl
} from "../apps/extension/lib/github/pr-files.js";
import type { GitHubPullFile } from "../apps/extension/lib/github/pr-files.js";

const files: GitHubPullFile[] = [
  {
    filename: "docs/rfc.md",
    status: "modified",
    raw_url: "https://raw.githubusercontent.com/a/dorv/docs/rfc.md"
  },
  {
    filename: "docs/spec.mdx",
    status: "added",
    raw_url: "https://raw.githubusercontent.com/a/dorv/docs/spec.mdx"
  },
  {
    filename: "docs/old.markdown",
    status: "removed",
    raw_url: "https://raw.githubusercontent.com/a/dorv/docs/old.markdown"
  },
  {
    filename: "src/app.ts",
    status: "modified",
    raw_url: "https://raw.githubusercontent.com/a/dorv/src/app.ts"
  },
  {
    filename: "docs/new-name.md",
    previous_filename: "docs/old-name.md",
    status: "renamed",
    raw_url: "https://raw.githubusercontent.com/a/dorv/docs/new-name.md"
  }
];

describe("HUM-1195 GitHub PR markdown file detection", () => {
  it("parses GitHub pull request URLs", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/ahnpolished/dorv/pull/42/files")).toEqual({
      owner: "ahnpolished",
      repo: "dorv",
      prNumber: 42
    });

    expect(
      parseGitHubPullRequestUrl("https://github.com/ahnpolished/dorv/issues/42")
    ).toBeUndefined();
  });

  it("keeps non-removed markdown files and preserves renamed file metadata", () => {
    expect(filterMarkdownFiles(files)).toEqual([
      {
        filename: "docs/rfc.md",
        rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/rfc.md",
        status: "modified"
      },
      {
        filename: "docs/spec.mdx",
        rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/spec.mdx",
        status: "added"
      },
      {
        filename: "docs/new-name.md",
        previousFilename: "docs/old-name.md",
        rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/new-name.md",
        status: "renamed"
      }
    ]);
  });

  it("hides the sidebar when no markdown files are present", () => {
    expect(buildPrSidebarState([])).toEqual({ visible: false, files: [], buttonLabel: "" });
  });

  it("shows markdown file list and count-specific create button", () => {
    expect(buildPrSidebarState(filterMarkdownFiles(files))).toEqual({
      visible: true,
      files: [
        {
          filename: "docs/rfc.md",
          rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/rfc.md",
          status: "modified"
        },
        {
          filename: "docs/spec.mdx",
          rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/spec.mdx",
          status: "added"
        },
        {
          filename: "docs/new-name.md",
          previousFilename: "docs/old-name.md",
          rawUrl: "https://raw.githubusercontent.com/a/dorv/docs/new-name.md",
          status: "renamed"
        }
      ],
      buttonLabel: "Create Google Doc (3 files)"
    });
  });
});
