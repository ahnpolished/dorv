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

export interface DocFileVersion {
  sha: string;
  revId?: string;
}

export interface DocFileMapping {
  filename: string;
  docId: string;
  docUrl: string;
  versions?: DocFileVersion[];
}

export interface DocMapping extends PullRequestRef {
  docs: DocFileMapping[];
  createdAt: string;
  lastSyncedAt: string;
  headSha: string;
  latestSha: string;
  isStale: boolean;
}

export interface CommentMapping extends PullRequestRef {
  ghCommentId: number;
  docCommentId: string;
  docId: string;
  source: SyncSource;
  ghThreadId?: string;
  ghUpdatedAt?: string;
  threadSnapshot?: string;
  resolvedAt?: string;
}

export interface ReplyMapping extends PullRequestRef {
  ghReplyId: number;
  docReplyId: string;
  ghParentCommentId: number;
  docParentCommentId: string;
  docId: string;
  source: SyncSource;
  ghUpdatedAt?: string;
}

export type SyncedActivityDirection = "github_to_gdoc" | "gdoc_to_github";
export type SyncedActivityKind = "comment_synced" | "reply_synced" | "thread_resolved";

export interface SyncedActivity extends PullRequestRef {
  id: string;
  direction: SyncedActivityDirection;
  kind: SyncedActivityKind;
  ghCommentId?: number;
  docCommentId?: string;
  path?: string;
  line?: number;
  snippet: string;
  createdAt: string;
}

export type NewSyncedActivity = Omit<SyncedActivity, "id"> & { id?: string };

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
  resolved: boolean;
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

export function findDocForFile(mapping: DocMapping, filename: string): DocFileMapping | undefined {
  if (!Array.isArray(mapping.docs)) return undefined;
  return mapping.docs.find((d) => d.filename === filename);
}

export function findDocById(mapping: DocMapping, docId: string): DocFileMapping | undefined {
  if (!Array.isArray(mapping.docs)) return undefined;
  return mapping.docs.find((d) => d.docId === docId);
}

export interface SyncAdapter {
  getDoc(ref: PullRequestRef): Promise<DocMapping | undefined>;
  createDoc(input: CreateDocInput): Promise<CreateDocResult>;
  getGHComments(ref: PullRequestRef): Promise<GitHubReviewComment[]>;
  getDocComments(ref: PullRequestRef): Promise<GoogleDocComment[]>;
  getCommentMappings(ref: PullRequestRef): Promise<CommentMapping[]>;
  pushGHCommentToDoc(comment: GitHubReviewComment, mapping: DocMapping): Promise<CommentMapping>;
  /**
   * `docId` identifies which doc in `mapping.docs` this comment came from
   * (`GoogleDocComment` itself doesn't carry that — the caller knows which
   * doc's comment sidebar it read the comment from).
   */
  pushDocCommentToGH(
    comment: GoogleDocComment,
    mapping: DocMapping,
    docId: string
  ): Promise<CommentMapping>;
  /** Syncs a single PR on demand (button-triggered). Primary entry point as of v0.3.0. */
  syncPR(ref: PullRequestRef): Promise<void>;
  syncAll(): Promise<void>;
}
