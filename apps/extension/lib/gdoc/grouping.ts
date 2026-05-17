import type { GitHubReviewComment } from "../adapters/types.js";

export interface CommentGroup {
  path: string;
  comments: GitHubReviewComment[];
}

export function groupCommentsByPath(comments: GitHubReviewComment[]): CommentGroup[] {
  const groups: Record<string, GitHubReviewComment[]> = {};

  for (const comment of comments) {
    groups[comment.path] ??= [];
    const group = groups[comment.path];
    if (group) {
      group.push(comment);
    }
  }

  return Object.entries(groups)
    .map(([path, comments]) => ({
      path,
      comments: comments.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
