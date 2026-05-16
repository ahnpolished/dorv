import { marked } from "marked";
import type { AuthStore } from "../storage/auth.js";
import { createDocStore, createStatusStore, createMappingStore } from "../storage/stores.js";
import type { StorageArea } from "../storage/area.js";
import { createGoogleDoc } from "../gdoc/drive.js";
import { generateGDocHtml } from "../gdoc/template.js";
import { postPRComment } from "../github/comments.js";
import { fetchReviewComments } from "../github/fetch.js";
import { pushGDocComment } from "../gdoc/comments.js";
import type {
  CommentMapping,
  CreateDocInput,
  CreateDocResult,
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  PullRequestRef,
  SyncAdapter
} from "./types.js";

export class DirectAdapter implements SyncAdapter {
  private docStore;
  private statusStore;
  private mappingStore;

  constructor(
    private authStore: AuthStore,
    storageArea: StorageArea
  ) {
    this.docStore = createDocStore(storageArea);
    this.statusStore = createStatusStore(storageArea);
    this.mappingStore = createMappingStore(storageArea);
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

  getGHComments(): Promise<GitHubReviewComment[]> {
    return Promise.resolve([]);
  }

  getDocComments(): Promise<GoogleDocComment[]> {
    return Promise.resolve([]);
  }

  getCommentMappings(): Promise<CommentMapping[]> {
    return Promise.resolve([]);
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

  pushDocCommentToGH(): Promise<CommentMapping> {
    return Promise.reject(new Error("DirectAdapter.pushDocCommentToGH is implemented in HUM-1198"));
  }

  async syncAll(): Promise<void> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) return;

    const active = await this.docStore.listActive();
    for (const ref of active) {
      const mapping = await this.docStore.get(ref.repo, ref.prNumber);
      if (mapping) {
        try {
          await this.statusStore.set({
            ...ref,
            state: "syncing",
            updatedAt: new Date().toISOString()
          });

          const comments = await fetchReviewComments(ghToken, ref.repo, ref.prNumber);
          const newComments = comments.filter((c) => !c.inReplyToId);

          for (const comment of newComments) {
            if (!(await this.mappingStore.hasByGH(comment.id))) {
              await this.pushGHCommentToDoc(comment, mapping);
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
}
