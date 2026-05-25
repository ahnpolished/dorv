export type SyncSource = "github" | "gdoc";

export interface PullRequestRef {
  repo: string;
  prNumber: number;
}

export interface MarkdownFileRef {
  filename: string;
  rawUrl: string;
  status: string;
  previousFilename?: string;
}

export interface DocMapping extends PullRequestRef {
  docId: string;
  docUrl: string;
  createdAt: string;
  lastSyncedAt: string;
  headSha: string;
  latestSha: string;
  isStale: boolean;
}

export interface CommentMapping extends PullRequestRef {
  ghCommentId: number;
  docCommentId: string;
  source: SyncSource;
}

export interface ReplyMapping extends PullRequestRef {
  ghReplyId: number;
  docReplyId: string;
  ghParentCommentId: number;
  docParentCommentId: string;
  source: SyncSource;
}

export interface IdentityMapping {
  googleAuthor: string;
  githubLogin: string;
}

export interface GitHubReviewComment {
  id: number;
  body: string;
  path: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  diffHunk?: string;
  inReplyToId?: number;
  createdAt: string;
  updatedAt: string;
  user: string;
  htmlUrl: string;
}

export interface GitHubReviewThread {
  id: string;
  path: string;
  line: number;
  side: "RIGHT";
  diffHunk?: string;
  quotedLine?: string;
  isResolved: boolean;
  rootComment: GitHubReviewComment;
  replies: GitHubReviewComment[];
}

export interface GoogleDocReply {
  id: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface GoogleDocComment {
  id: string;
  content: string;
  quotedFileContent?: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  replies?: GoogleDocReply[];
}

export interface CreateDocInput extends PullRequestRef {
  title: string;
  author: string;
  branch: string;
  headSha: string;
  prUrl: string;
  files: MarkdownFileRef[];
}

export interface CreateDocResult {
  mapping: DocMapping;
}

export type SyncState = "idle" | "syncing" | "error";

export interface SyncStatus extends PullRequestRef {
  state: SyncState;
  updatedAt: string;
  message?: string;
}

export interface SyncAdapter {
  getDoc(ref: PullRequestRef): Promise<DocMapping | undefined>;
  createDoc(input: CreateDocInput): Promise<CreateDocResult>;
  getGHComments(ref: PullRequestRef): Promise<GitHubReviewComment[]>;
  getDocComments(ref: PullRequestRef): Promise<GoogleDocComment[]>;
  getCommentMappings(ref: PullRequestRef): Promise<CommentMapping[]>;
  pushGHCommentToDoc(comment: GitHubReviewComment, mapping: DocMapping): Promise<CommentMapping>;
  pushDocCommentToGH(comment: GoogleDocComment, mapping: DocMapping): Promise<CommentMapping>;
  syncAll(): Promise<void>;
}
