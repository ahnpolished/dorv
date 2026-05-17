import { marked } from "marked";
import type { AuthStore } from "../storage/auth.js";
import {
  createDocStore,
  createStatusStore,
  createMappingStore,
  createReplyMappingStore
} from "../storage/stores.js";
import type { StorageArea } from "../storage/area.js";
import { createGoogleDoc } from "../gdoc/drive.js";
import { generateGDocHtml } from "../gdoc/template.js";
import {
  postPRComment,
  createReviewComment,
  createReviewCommentReply
} from "../github/comments.js";
import { fetchReviewComments } from "../github/fetch.js";
import { pushGDocComment, pushGDocReply } from "../gdoc/comments.js";
import { fetchGDocComments } from "../gdoc/fetch.js";
import { findLineMatch } from "../gdoc/matching.js";
import { fetchPullRequestFiles, filterMarkdownFiles } from "../github/pr-files.js";
import type {
  CommentMapping,
  CreateDocInput,
  CreateDocResult,
  DocMapping,
  GitHubReviewComment,
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

  constructor(
    private authStore: AuthStore,
    storageArea: StorageArea
  ) {
    this.docStore = createDocStore(storageArea);
    this.statusStore = createStatusStore(storageArea);
    this.mappingStore = createMappingStore(storageArea);
    this.replyMappingStore = createReplyMappingStore(storageArea);
  }

  async getDoc(ref: PullRequestRef): Promise<DocMapping | undefined> {
    return this.docStore.get(ref.repo, ref.prNumber);
  }

  async createDoc(input: CreateDocInput): Promise<CreateDocResult> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub PAT not configured. Please set it in extension options.");
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
        const html = await marked.parse(content);
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

    // 4. Post bot comment on PR
    const botCommentBody = `🤖 **dorv** has created a linked Google Doc for review:\n\n[${docName}](${driveFile.webViewLink})`;
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

    const content = `**@${comment.user}** on ${comment.path}:${comment.line?.toString() ?? "?"} -- ${comment.body} -- [View](${comment.htmlUrl})`;
    const result = await pushGDocComment(gToken, mapping.docId, content);

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: comment.id,
      docCommentId: result.id,
      source: "github"
    };

    await this.mappingStore.upsert(commentMapping);
    return commentMapping;
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
        fetch: fetch.bind(window),
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
    const body = `> From Google Docs -- @${comment.author} -- ${comment.content}`;
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
    return commentMapping;
  }

  async syncAll(): Promise<void> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) return;

    const gToken = await this.authStore.getGoogleToken(false);

    const active = await this.docStore.listActive();
    for (const ref of active) {
      const mapping = await this.docStore.get(ref.repo, ref.prNumber);
      if (!mapping) continue;

      try {
        await this.statusStore.set({
          ...ref,
          state: "syncing",
          updatedAt: new Date().toISOString()
        });

        const comments = await fetchReviewComments(ghToken, ref.repo, ref.prNumber);

        // GH top-level comments → Doc
        for (const comment of comments.filter((c) => !c.inReplyToId)) {
          if (!(await this.mappingStore.hasByGH(comment.id))) {
            await this.pushGHCommentToDoc(comment, mapping);
          }
        }

        if (gToken) {
          // GH replies → Doc
          type GHReply = GitHubReviewComment & { inReplyToId: number };
          const ghReplies = comments.filter((c): c is GHReply => c.inReplyToId != null);
          for (const reply of ghReplies) {
            if (await this.replyMappingStore.hasByGH(reply.id)) continue;
            const parentMapping = await this.mappingStore.getByGH(reply.inReplyToId);
            if (!parentMapping) continue;
            try {
              const content = `**@${reply.user}** (reply): ${reply.body} -- [View](${reply.htmlUrl})`;
              const result = await pushGDocReply(
                gToken,
                mapping.docId,
                parentMapping.docCommentId,
                content
              );
              const replyMapping: ReplyMapping = {
                repo: mapping.repo,
                prNumber: mapping.prNumber,
                ghReplyId: reply.id,
                docReplyId: result.id,
                ghParentCommentId: reply.inReplyToId,
                docParentCommentId: parentMapping.docCommentId,
                source: "github"
              };
              await this.replyMappingStore.upsert(replyMapping);
            } catch (err) {
              console.error(`GH reply ${reply.id.toString()} sync failed:`, err);
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
                const body = `> From Google Docs -- @${reply.author} -- ${reply.content}`;
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
              }
            }
          }
        }

        mapping.lastSyncedAt = new Date().toISOString();
        await this.docStore.upsert(mapping);
        await this.statusStore.set({
          ...ref,
          state: "idle",
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        console.error(`Sync failed for ${ref.repo}#${ref.prNumber.toString()}:`, err);
        await this.statusStore.set({
          ...ref,
          state: "error",
          updatedAt: new Date().toISOString(),
          message: String(err)
        });
      }
    }
  }
}
