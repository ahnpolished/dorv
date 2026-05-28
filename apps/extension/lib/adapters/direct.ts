import type { AuthStore } from "../storage/auth.js";
import {
  createActivityStore,
  createDocStore,
  createIdentityStore,
  createStatusStore,
  createMappingStore,
  createReplyMappingStore
} from "../storage/stores.js";
import type { StorageArea } from "../storage/area.js";
import {
  createGoogleDoc,
  grantAnyoneCommentAccess,
  inferOrganizationDomain
} from "../gdoc/drive.js";
import { renderMarkdownToGDocHtml } from "../gdoc/markdown.js";
import { generateGDocHtml } from "../gdoc/template.js";
import { extractDocFromBotComment } from "../gdoc/urls.js";
import {
  postPRComment,
  createReviewComment,
  createReviewCommentReply
} from "../github/comments.js";
import {
  fetchPullRequestMeta,
  fetchReviewComments,
  fetchReviewThreads,
  fetchIssueComments
} from "../github/fetch.js";
import {
  deleteGDocComment,
  pushGDocComment,
  pushGDocReply,
  resolveGDocComment
} from "../gdoc/comments.js";
import { fetchGDocComments } from "../gdoc/fetch.js";
import { findLineMatch } from "../gdoc/matching.js";
import { fetchPullRequestFiles, filterMarkdownFiles } from "../github/pr-files.js";
import { captureExtensionException } from "../telemetry/sentry.js";
import type {
  CommentMapping,
  CreateDocInput,
  CreateDocResult,
  DocMapping,
  GitHubReviewComment,
  GitHubReviewThread,
  GoogleDocComment,
  PullRequestRef,
  ReplyMapping,
  SyncAdapter
} from "./types.js";

export class DirectAdapter implements SyncAdapter {
  private docStore;
  private statusStore;
  private mappingStore;
  private replyMappingStore;
  private identityStore;
  private activityStore;

  private activeSyncAllPromise: Promise<void> | undefined;
  private prLocks = new Map<string, Promise<void>>();

  constructor(
    private authStore: AuthStore,
    storageArea: StorageArea
  ) {
    this.docStore = createDocStore(storageArea);
    this.statusStore = createStatusStore(storageArea);
    this.mappingStore = createMappingStore(storageArea);
    this.replyMappingStore = createReplyMappingStore(storageArea);
    this.identityStore = createIdentityStore(storageArea);
    this.activityStore = createActivityStore(storageArea);
  }

  async getDoc(ref: PullRequestRef): Promise<DocMapping | undefined> {
    return this.docStore.get(ref.repo, ref.prNumber);
  }

  async createDoc(input: CreateDocInput): Promise<CreateDocResult> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub PAT not configured. Please set it in extension options.");
    }

    // Check if a dorv bot comment already links a GDoc for this PR
    const issueComments = await fetchIssueComments(ghToken, input.repo, input.prNumber);
    for (const comment of issueComments) {
      const existing = extractDocFromBotComment(comment.body);
      if (existing) {
        const mapping: DocMapping = {
          repo: input.repo,
          prNumber: input.prNumber,
          docId: existing.docId,
          docUrl: existing.docUrl,
          createdAt: new Date().toISOString(),
          lastSyncedAt: new Date().toISOString(),
          headSha: input.headSha,
          latestSha: input.headSha,
          isStale: false
        };
        await this.docStore.upsert(mapping);
        return { mapping };
      }
    }

    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google account not connected. Please sign in in extension options.");
    }

    // 1. Fetch all files content from GitHub
    const filesWithContent = await Promise.all(
      input.files.map(async (file) => {
        const resp = await fetch(file.rawUrl, {
          headers: {
            Authorization: `token ${ghToken}`
          }
        });
        if (!resp.ok) {
          throw new Error(`Failed to fetch ${file.filename}: ${resp.status.toString()}`);
        }
        const content = await resp.text();
        const html = await renderMarkdownToGDocHtml(content);
        return { filename: file.filename, html };
      })
    );

    // 2. Generate full HTML for Google Doc
    const fullHtml = generateGDocHtml({
      title: input.title,
      author: input.author,
      prUrl: input.prUrl,
      files: filesWithContent
    });

    // 3. Create Google Doc
    const docName = `PR #${input.prNumber.toString()} - ${input.title}`;
    const driveFile = await createGoogleDoc(gToken, docName, fullHtml);
    await grantAnyoneCommentAccess(gToken, driveFile.id, inferOrganizationDomain(driveFile));

    // 4. Post bot comment on PR
    const botCommentBody = `<!-- dorv-doc-id=${driveFile.id} -->\n🤖 **dorv** has created a linked Google Doc for review:\n\n[${docName}](${driveFile.webViewLink})`;
    await postPRComment(ghToken, input.repo, input.prNumber, botCommentBody);

    // 5. Persist mapping
    const mapping: DocMapping = {
      repo: input.repo,
      prNumber: input.prNumber,
      docId: driveFile.id,
      docUrl: driveFile.webViewLink,
      createdAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      headSha: input.headSha,
      latestSha: input.headSha,
      isStale: false
    };

    await this.docStore.upsert(mapping);

    return { mapping };
  }

  async getGHComments(ref: PullRequestRef): Promise<GitHubReviewComment[]> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub PAT not configured.");
    }
    return fetchReviewComments(ghToken, ref.repo, ref.prNumber);
  }

  async getDocComments(ref: PullRequestRef): Promise<GoogleDocComment[]> {
    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google account not connected.");
    }

    const mapping = await this.getDoc(ref);
    if (!mapping) {
      throw new Error("PR not linked to a Google Doc.");
    }

    return fetchGDocComments(gToken, mapping.docId);
  }

  async getCommentMappings(ref: PullRequestRef): Promise<CommentMapping[]> {
    return this.mappingStore.listByPR(ref.repo, ref.prNumber);
  }

  async pushGHCommentToDoc(
    comment: GitHubReviewComment,
    mapping: DocMapping
  ): Promise<CommentMapping> {
    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google token missing during sync");
    }

    const result = await pushGDocComment(
      gToken,
      mapping.docId,
      formatGitHubMirroredBody(comment),
      createDriveCommentContextFromComment(comment)
    );

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: comment.id,
      docCommentId: result.id,
      source: "github"
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "github_to_gdoc",
      kind: "comment_synced",
      ghCommentId: comment.id,
      docCommentId: result.id,
      path: comment.path,
      ...(comment.line != null ? { line: comment.line } : {}),
      snippet: activitySnippet(comment.body),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  private async pushGHThreadToDoc(
    thread: GitHubReviewThread,
    mapping: DocMapping
  ): Promise<CommentMapping> {
    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google token missing during sync");
    }

    const comment = thread.rootComment;
    const result = await pushGDocComment(
      gToken,
      mapping.docId,
      formatGitHubMirroredBody(comment),
      createDriveCommentContextFromThread(thread)
    );

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: comment.id,
      docCommentId: result.id,
      source: "github",
      ghThreadId: thread.id,
      ghUpdatedAt: comment.updatedAt,
      threadSnapshot: buildGitHubThreadSnapshot(thread)
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "github_to_gdoc",
      kind: "comment_synced",
      ghCommentId: comment.id,
      docCommentId: result.id,
      path: thread.path,
      line: thread.line,
      snippet: activitySnippet(comment.body),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  private async pushGHThreadRepliesToDoc(
    thread: GitHubReviewThread,
    mapping: DocMapping,
    parentMapping: CommentMapping,
    gToken: string
  ): Promise<void> {
    for (const reply of thread.replies) {
      if (await this.replyMappingStore.hasByGH(reply.id)) continue;
      if (reply.inReplyToId == null) continue;
      const result = await pushGDocReply(
        gToken,
        mapping.docId,
        parentMapping.docCommentId,
        formatGitHubMirroredBody(reply)
      );
      const replyMapping: ReplyMapping = {
        repo: mapping.repo,
        prNumber: mapping.prNumber,
        ghReplyId: reply.id,
        docReplyId: result.id,
        ghParentCommentId: reply.inReplyToId,
        docParentCommentId: parentMapping.docCommentId,
        source: "github",
        ghUpdatedAt: reply.updatedAt
      };
      await this.replyMappingStore.upsert(replyMapping);
    }
  }

  private async recreateGHThreadInDoc(
    thread: GitHubReviewThread,
    mapping: DocMapping,
    existing: CommentMapping,
    gToken: string
  ): Promise<void> {
    const previousReplyMappings = await this.replyMappingStore.listByParentGH(
      thread.rootComment.id
    );
    await deleteGDocComment(gToken, mapping.docId, existing.docCommentId);
    for (const replyMapping of previousReplyMappings) {
      await this.replyMappingStore.removeByGH(replyMapping.ghReplyId);
    }
    const recreatedMapping = await this.pushGHThreadToDoc(thread, mapping);
    await this.pushGHThreadRepliesToDoc(thread, mapping, recreatedMapping, gToken);
  }

  private async syncGHThreadLifecycle(
    thread: GitHubReviewThread,
    mapping: DocMapping,
    existing: CommentMapping,
    gToken: string
  ): Promise<"handled" | "continue"> {
    if (existing.source !== "github") return "continue";

    const snapshot = buildGitHubThreadSnapshot(thread);

    if (thread.isResolved) {
      if (!existing.resolvedAt) {
        await resolveGDocComment(gToken, mapping.docId, existing.docCommentId);
        await this.mappingStore.upsert({
          ...existing,
          ghThreadId: thread.id,
          ghUpdatedAt: thread.rootComment.updatedAt,
          threadSnapshot: snapshot,
          resolvedAt: new Date().toISOString()
        });
      }
      return "handled";
    }

    if (existing.resolvedAt) return "handled";

    if (!existing.threadSnapshot) {
      await this.mappingStore.upsert({
        ...existing,
        ghThreadId: thread.id,
        ghUpdatedAt: thread.rootComment.updatedAt,
        threadSnapshot: snapshot
      });
      return "continue";
    }

    if (existing.threadSnapshot !== snapshot) {
      await this.recreateGHThreadInDoc(thread, mapping, existing, gToken);
      return "handled";
    }

    return "continue";
  }

  async pushDocCommentToGH(
    comment: GoogleDocComment,
    mapping: DocMapping
  ): Promise<CommentMapping> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub token missing during push");
    }

    if (!comment.quotedFileContent) {
      throw new Error("Cannot push comment without highlighted text (no line match possible)");
    }

    // 1. Fetch raw PR files to match lines
    const parts = mapping.repo.split("/");
    const owner = parts[0];
    const name = parts[1];
    if (!owner || !name) {
      throw new Error(`Invalid repo format: ${mapping.repo}`);
    }

    const prFiles = await fetchPullRequestFiles(
      { owner, repo: name, prNumber: mapping.prNumber },
      {
        fetch: fetch.bind(globalThis),
        token: ghToken
      }
    );
    const mdFiles = filterMarkdownFiles(prFiles);

    // 2. Fetch contents and match
    const filesWithContent = await Promise.all(
      mdFiles.map(async (f) => {
        const resp = await fetch(f.rawUrl, { headers: { Authorization: `token ${ghToken}` } });
        return { filename: f.filename, content: await resp.text() };
      })
    );

    const matches = findLineMatch(comment.quotedFileContent, filesWithContent);
    if (matches.length === 0) {
      throw new Error("Could not find matching text in any PR files.");
    }

    // Default to first match for now
    const bestMatch = matches[0];
    if (!bestMatch) {
      throw new Error("Match array empty after check.");
    }

    // 3. Push to GH
    const body = `> From Google Docs -- ${await this.formatGDocAuthor(comment.author)} -- ${comment.content}\n\n[View in GDoc](${mapping.docUrl})`;
    const result = await createReviewComment(ghToken, mapping.repo, mapping.prNumber, {
      body,
      commit_id: mapping.headSha,
      path: bestMatch.path,
      line: bestMatch.line,
      side: "RIGHT"
    });

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: result.id,
      docCommentId: comment.id,
      source: "gdoc"
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "gdoc_to_github",
      kind: "comment_synced",
      ghCommentId: result.id,
      docCommentId: comment.id,
      path: bestMatch.path,
      line: bestMatch.line,
      snippet: activitySnippet(comment.content),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  async syncAll(): Promise<void> {
    if (this.activeSyncAllPromise) {
      await this.activeSyncAllPromise;
      return;
    }

    this.activeSyncAllPromise = this.runSyncAll();
    try {
      await this.activeSyncAllPromise;
    } finally {
      this.activeSyncAllPromise = undefined;
    }
  }

  private async syncPRWithLock(
    ref: PullRequestRef,
    ghToken: string,
    gToken: string | undefined
  ): Promise<void> {
    const lockKey = `${ref.repo}#${ref.prNumber.toString()}`;
    const existingLock = this.prLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
      return;
    }

    const syncPromise = (async () => {
      const mapping = await this.docStore.get(ref.repo, ref.prNumber);

      try {
        if (!mapping) {
          throw new Error("PR not linked to a Google Doc.");
        }

        await this.statusStore.update(ref.repo, ref.prNumber, {
          state: "syncing",
          updatedAt: new Date().toISOString()
        });

        // Stale detection: check if new commits have landed since doc creation
        if (!mapping.isStale) {
          const repoParts = mapping.repo.split("/");
          const [repoOwner, repoName] = repoParts;
          if (repoOwner && repoName) {
            try {
              const meta = await fetchPullRequestMeta(
                { owner: repoOwner, repo: repoName, prNumber: ref.prNumber },
                { fetch: fetch.bind(globalThis), token: ghToken }
              );
              if (meta.headSha !== mapping.headSha) {
                mapping.isStale = true;
                mapping.latestSha = meta.headSha;
              }
            } catch {
              // Non-fatal: stale check failure should not block sync
            }
          }
        }

        const threads = await fetchReviewThreads(ghToken, ref.repo, ref.prNumber);

        // GH top-level comments → Doc, plus first-pass lifecycle for mapped GH threads.
        for (const thread of threads) {
          const existingRootMapping = await this.mappingStore.getByGH(thread.rootComment.id);
          if (!existingRootMapping) {
            await this.pushGHThreadToDoc(thread, mapping);
            continue;
          }
          if (!gToken) continue;
          await this.syncGHThreadLifecycle(thread, mapping, existingRootMapping, gToken);
        }

        if (gToken) {
          // GH replies → Doc
          for (const thread of threads) {
            if (thread.isResolved) continue;
            const rootMapping = await this.mappingStore.getByGH(thread.rootComment.id);
            if (rootMapping?.resolvedAt) continue;
            for (const reply of thread.replies) {
              if (await this.replyMappingStore.hasByGH(reply.id)) continue;
              if (reply.inReplyToId == null) continue;
              const parentMapping = await this.mappingStore.getByGH(reply.inReplyToId);
              if (!parentMapping || parentMapping.resolvedAt) continue;
              try {
                const result = await pushGDocReply(
                  gToken,
                  mapping.docId,
                  parentMapping.docCommentId,
                  formatGitHubMirroredBody(reply)
                );
                const replyMapping: ReplyMapping = {
                  repo: mapping.repo,
                  prNumber: mapping.prNumber,
                  ghReplyId: reply.id,
                  docReplyId: result.id,
                  ghParentCommentId: reply.inReplyToId,
                  docParentCommentId: parentMapping.docCommentId,
                  source: "github",
                  ghUpdatedAt: reply.updatedAt
                };
                await this.replyMappingStore.upsert(replyMapping);
              } catch (err) {
                console.error(`GH reply ${reply.id.toString()} sync failed:`, err);
                captureExtensionException(err, {
                  extra: {
                    prNumber: mapping.prNumber,
                    repo: mapping.repo,
                    replyId: reply.id
                  },
                  surface: "background",
                  tags: { operation: "github_reply_sync" }
                });
              }
            }
          }

          // Doc replies → GH
          const docComments = await fetchGDocComments(gToken, mapping.docId);
          for (const docComment of docComments) {
            const parentMapping = await this.mappingStore.getByDoc(docComment.id);
            if (!parentMapping) continue;
            for (const reply of docComment.replies ?? []) {
              if (await this.replyMappingStore.hasByDoc(reply.id)) continue;
              try {
                const body = `> From Google Docs -- ${await this.formatGDocAuthor(reply.author)} -- ${reply.content}\n\n[View in GDoc](${mapping.docUrl})`;
                const result = await createReviewCommentReply(
                  ghToken,
                  mapping.repo,
                  mapping.prNumber,
                  parentMapping.ghCommentId,
                  body
                );
                const replyMapping: ReplyMapping = {
                  repo: mapping.repo,
                  prNumber: mapping.prNumber,
                  ghReplyId: result.id,
                  docReplyId: reply.id,
                  ghParentCommentId: parentMapping.ghCommentId,
                  docParentCommentId: docComment.id,
                  source: "gdoc"
                };
                await this.replyMappingStore.upsert(replyMapping);
              } catch (err) {
                console.error(`Doc reply ${reply.id} push failed:`, err);
                captureExtensionException(err, {
                  extra: {
                    docReplyId: reply.id,
                    prNumber: mapping.prNumber,
                    repo: mapping.repo
                  },
                  surface: "background",
                  tags: { operation: "gdoc_reply_push" }
                });
              }
            }
          }
        }

        mapping.lastSyncedAt = new Date().toISOString();
        await this.docStore.upsert(mapping);
        await this.statusStore.update(ref.repo, ref.prNumber, {
          state: "idle",
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        console.error(`Sync failed for ${lockKey}:`, err);
        captureExtensionException(err, {
          extra: { prNumber: ref.prNumber, repo: ref.repo },
          surface: "background",
          tags: { operation: "sync_all_pr" }
        });
        await this.statusStore.update(ref.repo, ref.prNumber, {
          state: "error",
          updatedAt: new Date().toISOString(),
          message: String(err)
        });
      }
    })();

    this.prLocks.set(lockKey, syncPromise);
    try {
      await syncPromise;
    } finally {
      this.prLocks.delete(lockKey);
    }
  }

  private async runSyncAll(): Promise<void> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) return;

    const gToken = await this.authStore.getGoogleToken(false);

    const active = await this.docStore.listActive();
    await Promise.all(active.map((ref) => this.syncPRWithLock(ref, ghToken, gToken)));
  }

  private async formatGDocAuthor(googleAuthor: string): Promise<string> {
    const mapping = await this.identityStore.getByGoogleAuthor(googleAuthor);
    return mapping ? `@${mapping.githubLogin}` : googleAuthor;
  }
}

function createDriveCommentContextFromComment(comment: GitHubReviewComment): {
  quotedFileContent?: { mimeType: string; value: string };
} {
  const context: {
    quotedFileContent?: { mimeType: string; value: string };
  } = {};

  const quotedLine = findQuotedLineFromComment(comment);
  if (quotedLine) {
    context.quotedFileContent = {
      mimeType: "text/plain",
      value: quotedLine
    };
  }

  return context;
}

function createDriveCommentContextFromThread(thread: GitHubReviewThread): {
  quotedFileContent?: { mimeType: string; value: string };
} {
  if (!thread.quotedLine) return {};

  return {
    quotedFileContent: {
      mimeType: "text/plain",
      value: thread.quotedLine
    }
  };
}

function formatGitHubMirroredBody(comment: GitHubReviewComment): string {
  const author = comment.user ? `@${comment.user}` : "unknown";
  const link = comment.htmlUrl ? `\n\n[View on GitHub](${comment.htmlUrl})` : "";
  return `[GitHub: ${author}]\n\n${comment.body}${link}`;
}

function activitySnippet(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function buildGitHubThreadSnapshot(thread: GitHubReviewThread): string {
  return JSON.stringify({
    root: {
      id: thread.rootComment.id,
      body: thread.rootComment.body,
      updatedAt: thread.rootComment.updatedAt
    },
    replies: thread.replies
      .map((reply) => ({
        id: reply.id,
        body: reply.body,
        inReplyToId: reply.inReplyToId,
        updatedAt: reply.updatedAt
      }))
      .sort((a, b) => a.id - b.id)
  });
}

function findQuotedLineFromComment(comment: GitHubReviewComment): string | undefined {
  if (!comment.diffHunk || comment.line == null) return undefined;

  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(comment.diffHunk);
  if (!header) return undefined;

  let oldLine = Number(header[1]);
  let newLine = Number(header[2]);
  const side = comment.side ?? "RIGHT";

  for (const line of comment.diffHunk.split("\n").slice(1)) {
    if (line.startsWith("\\ No newline")) continue;
    const marker = line[0];
    const text = line.slice(1);

    if (marker === " ") {
      if (comment.line === (side === "LEFT" ? oldLine : newLine)) return text;
      oldLine++;
      newLine++;
      continue;
    }

    if (marker === "-") {
      if (side === "LEFT" && comment.line === oldLine) return text;
      oldLine++;
      continue;
    }

    if (marker === "+") {
      if (side === "RIGHT" && comment.line === newLine) return text;
      newLine++;
    }
  }

  return undefined;
}
