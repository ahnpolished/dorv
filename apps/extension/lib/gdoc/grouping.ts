import type { GitHubReviewComment } from "../adapters/types.js";

export interface CommentThread {
  root: GitHubReviewComment;
  replies: GitHubReviewComment[];
}

export interface CommentGroup {
  path: string;
  threads: CommentThread[];
}

export function groupCommentsByPath(comments: GitHubReviewComment[]): CommentGroup[] {
  const roots: GitHubReviewComment[] = [];
  const replyMap = new Map<number, GitHubReviewComment[]>();

  for (const c of comments) {
    if (c.inReplyToId == null) {
      roots.push(c);
    } else {
      const list = replyMap.get(c.inReplyToId) ?? [];
      list.push(c);
      replyMap.set(c.inReplyToId, list);
    }
  }

  const groupMap: Record<string, CommentThread[]> = {};
  for (const root of roots) {
    groupMap[root.path] ??= [];
    const replies = (replyMap.get(root.id) ?? []).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    (groupMap[root.path] ??= []).push({ root, replies });
  }

  return Object.entries(groupMap)
    .map(([path, threads]) => ({
      path,
      threads: threads.sort((a, b) => (a.root.line ?? 0) - (b.root.line ?? 0))
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
