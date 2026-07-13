import type { AuthStore } from "../storage/auth.js";
import {
  createActivityStore,
  createDocStore,
  createIdentityStore,
  createStatusStore,
  createMappingStore,
  createReplyMappingStore
} from "../storage/stores.js";
import { createSyncLockStore } from "../storage/sync-lock-store.js";
import type { StorageArea } from "../storage/area.js";
import {
  createGoogleDoc,
  grantAnyoneCommentAccess,
  inferOrganizationDomain
} from "../gdoc/drive.js";
import { renderMarkdownToGDocHtml } from "../gdoc/markdown.js";
import { generateGDocHtml } from "../gdoc/template.js";
import { extractDocsFromBotComment, buildDocsMarker, renderFileEntry } from "../gdoc/urls.js";
import {
  postPRComment,
  updatePRComment,
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
import {
  extractGHCommentIdFromMirroredBody,
  extractDocMarkerFromGHBody,
  buildGHSourceMarker
} from "./dedup.js";
import {
  findDocForFile,
  findDocById,
  type CommentMapping,
  type CreateDocInput,
  type CreateDocResult,
  type DocFileMapping,
  type DocMapping,
  type GitHubReviewComment,
  type GitHubReviewThread,
  type GoogleDocComment,
  type GoogleDocReply,
  type PullRequestRef,
  type ReplyMapping,
  type SyncAdapter
} from "./types.js";

/**
 * Generous TTL: sync is now user-triggered (button click), not a 2-minute
 * alarm sweep, so lock contention should be rare — this mainly guards
 * double-click / multi-tab, not a tight polling loop.
 */
const SYNC_LOCK_TTL_MS = 120_000;

interface PushOptions {
  cache?: Map<string, GoogleDocComment[]>;
  dedup?: boolean;
}

export class DirectAdapter implements SyncAdapter {
  private docStore;
  private statusStore;
  private mappingStore;
  private replyMappingStore;
  private identityStore;
  private activityStore;
  private syncLockStore;

  private activeSyncAllPromise: Promise<void> | undefined;
  private createDocChain = new Map<string, Promise<unknown>>();

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
    this.syncLockStore = createSyncLockStore(storageArea);
  }

  async getDoc(ref: PullRequestRef): Promise<DocMapping | undefined> {
    return this.docStore.get(ref.repo, ref.prNumber);
  }

  /**
   * Per-PR files each have their own "Create Google Doc" button, so two file
   * buttons clicked close together can race here: both read GitHub issue
   * comments before either has posted the bot comment, so both find no
   * existing comment and both POST, creating a duplicate instead of one
   * singleton comment being reused/edited. Chain calls per PR so they run
   * one at a time, same pattern as syncAll's activeSyncAllPromise.
   */
  async createDoc(input: CreateDocInput): Promise<CreateDocResult> {
    const key = `${input.repo}#${input.prNumber.toString()}`;
    const prior = this.createDocChain.get(key) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(() => this.createDocInternal(input));
    this.createDocChain.set(key, run);
    try {
      return await run;
    } finally {
      if (this.createDocChain.get(key) === run) {
        this.createDocChain.delete(key);
      }
    }
  }

  private async createDocInternal(input: CreateDocInput): Promise<CreateDocResult> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub PAT not configured. Please set it in extension options.");
    }

    // Check docStore first for an existing mapping (fast, survives page reloads).
    let existingDocs: DocFileMapping[] = [];
    let existingCreatedAt: string | undefined;
    const storedMapping = await this.docStore.get(input.repo, input.prNumber);
    if (storedMapping) {
      existingDocs = storedMapping.docs;
      existingCreatedAt = storedMapping.createdAt;
    }

    // Recover mapping from a dorv bot comment (survives extension uninstall,
    // where chrome.storage is cleared). Also capture the comment id so we
    // can edit-in-place instead of posting a duplicate comment.
    let existingBotCommentId: number | undefined;
    const issueComments = await fetchIssueComments(ghToken, input.repo, input.prNumber);
    for (const comment of issueComments) {
      const recovered = extractDocsFromBotComment(comment.body);
      if (recovered) {
        if (existingDocs.length === 0) {
          existingDocs = recovered;
        }
        existingBotCommentId = comment.id;
        break;
      }
    }

    // Identify files that still need a Google Doc.
    // Legacy single-doc mappings use __legacy__ as a synthetic filename;
    // they already cover the PR — don't try to create a second doc on top.
    const isLegacy =
      existingDocs.length > 0 && existingDocs.every((d) => d.filename === "__legacy__");
    const existingFilenames = new Set(existingDocs.map((d) => d.filename));
    const newFiles = isLegacy ? [] : input.files.filter((f) => !existingFilenames.has(f.filename));

    // If every requested file already has a doc, return the existing mapping as-is.
    if (newFiles.length === 0) {
      const now = new Date().toISOString();
      const mapping: DocMapping = {
        repo: input.repo,
        prNumber: input.prNumber,
        docs: existingDocs,
        createdAt: existingCreatedAt ?? now,
        lastSyncedAt: now,
        headSha: input.headSha,
        latestSha: input.headSha,
        isStale: false
      };
      await this.docStore.upsert(mapping);
      return { mapping };
    }

    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google account not connected. Please sign in in extension options.");
    }

    // One Google Doc per markdown file — GDoc tabs can't be created via API,
    // so a PR maps to a set of docs rather than one doc with multiple tabs.
    const newDocs: DocFileMapping[] = [];
    for (const file of newFiles) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 30_000);
      const resp = await fetch(file.rawUrl, {
        headers: {
          Authorization: `token ${ghToken}`
        },
        signal: controller.signal
      }).finally(() => {
        clearTimeout(timeout);
      });
      if (!resp.ok) {
        throw new Error(`Failed to fetch ${file.filename}: ${resp.status.toString()}`);
      }
      const content = await resp.text();
      const html = await renderMarkdownToGDocHtml(content);

      const fullHtml = generateGDocHtml({
        title: input.title,
        author: input.author,
        prUrl: input.prUrl,
        files: [{ filename: file.filename, html }]
      });

      const docName = `PR #${input.prNumber.toString()} - ${input.title} - ${file.filename}`;
      const driveFile = await createGoogleDoc(gToken, docName, fullHtml);
      await grantAnyoneCommentAccess(gToken, driveFile.id, inferOrganizationDomain(driveFile));

      newDocs.push({
        filename: file.filename,
        docId: driveFile.id,
        docUrl: driveFile.webViewLink,
        versions: [{ sha: input.headSha }]
      });
    }

    // Merge with any docs that already existed for this PR.
    const docs = [...existingDocs, ...newDocs];

    // Post or update a single bot comment on PR encoding the full file -> doc map
    const docList = docs.map((d) => renderFileEntry(d)).join("\n");
    const botCommentBody = `${buildDocsMarker(docs)}\n🤖 **dorv** has created linked Google Doc${
      docs.length === 1 ? "" : "s"
    } for review:\n\n${docList}`;
    if (existingBotCommentId) {
      await updatePRComment(ghToken, input.repo, existingBotCommentId, botCommentBody);
    } else {
      await postPRComment(ghToken, input.repo, input.prNumber, botCommentBody);
    }

    // Persist mapping
    const now = new Date().toISOString();
    const mapping: DocMapping = {
      repo: input.repo,
      prNumber: input.prNumber,
      docs,
      createdAt: existingCreatedAt ?? now,
      lastSyncedAt: now,
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

    const perDoc = await Promise.all(
      mapping.docs.map((doc) => fetchGDocComments(gToken, doc.docId))
    );
    return perDoc.flat();
  }

  async getCommentMappings(ref: PullRequestRef): Promise<CommentMapping[]> {
    return this.mappingStore.listByPR(ref.repo, ref.prNumber);
  }

  /**
   * Resolves the doc a file belongs to. Falls back to the sole doc in the
   * set when there's exactly one — this keeps legacy single-doc PRs (whose
   * bot-comment marker predates per-file tracking and records a synthetic
   * `"__legacy__"` filename) routable without a real migration.
   */
  private resolveTargetDoc(mapping: DocMapping, filename: string): DocFileMapping | undefined {
    const exact = findDocForFile(mapping, filename);
    if (exact) return exact;
    if (mapping.docs.length === 1) return mapping.docs[0];
    return undefined;
  }

  private async fetchDocCommentsCached(
    gToken: string,
    docId: string,
    cache?: Map<string, GoogleDocComment[]>
  ): Promise<GoogleDocComment[]> {
    if (cache?.has(docId)) {
      return cache.get(docId) ?? [];
    }
    const comments = await fetchGDocComments(gToken, docId);
    cache?.set(docId, comments);
    return comments;
  }

  async pushGHCommentToDoc(
    comment: GitHubReviewComment,
    mapping: DocMapping
  ): Promise<CommentMapping> {
    // Fast path: local mapping already records this comment as synced.
    const existingLocal = await this.mappingStore.getByGH(comment.id);
    if (existingLocal) return existingLocal;

    const gToken = await this.authStore.getGoogleToken(false);
    if (!gToken) {
      throw new Error("Google token missing during sync");
    }

    const targetDoc = this.resolveTargetDoc(mapping, comment.path);
    if (!targetDoc) {
      throw new Error(`No linked Google Doc found for file "${comment.path}"`);
    }

    // No local mapping: verify against the doc's actual comments before
    // pushing, so a local write failure after a prior successful push can't
    // cause a duplicate (this is the fix for the 1000-duplicate-comment P0).
    const remoteComments = await fetchGDocComments(gToken, targetDoc.docId);
    const existingRemote = remoteComments.find(
      (c) => extractGHCommentIdFromMirroredBody(c.content) === comment.id
    );

    const docCommentId = existingRemote
      ? existingRemote.id
      : (
          await pushGDocComment(
            gToken,
            targetDoc.docId,
            formatGitHubMirroredBody(comment),
            createDriveCommentContextFromComment(comment)
          )
        ).id;

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: comment.id,
      docCommentId,
      docId: targetDoc.docId,
      source: "github"
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "github_to_gdoc",
      kind: "comment_synced",
      ghCommentId: comment.id,
      docCommentId,
      path: comment.path,
      ...(comment.line != null ? { line: comment.line } : {}),
      snippet: activitySnippet(comment.body),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  private async pushGHThreadToDocCore(
    thread: GitHubReviewThread,
    mapping: DocMapping,
    gToken: string,
    options: PushOptions = {}
  ): Promise<CommentMapping | undefined> {
    const { cache, dedup = true } = options;

    const targetDoc = this.resolveTargetDoc(mapping, thread.path);
    if (!targetDoc) {
      console.warn(
        `dorv: no linked Google Doc for file "${thread.path}"; skipping GH thread ${thread.id}`
      );
      return undefined;
    }

    let existingRemote: GoogleDocComment | undefined;
    if (dedup) {
      const remoteComments = await this.fetchDocCommentsCached(gToken, targetDoc.docId, cache);
      existingRemote = remoteComments.find(
        (c) => extractGHCommentIdFromMirroredBody(c.content) === thread.rootComment.id
      );
    }

    const docCommentId = existingRemote
      ? existingRemote.id
      : (
          await pushGDocComment(
            gToken,
            targetDoc.docId,
            formatGitHubMirroredBody(thread.rootComment),
            createDriveCommentContextFromThread(thread)
          )
        ).id;

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId: thread.rootComment.id,
      docCommentId,
      docId: targetDoc.docId,
      source: "github",
      ghThreadId: thread.id,
      ghUpdatedAt: thread.rootComment.updatedAt,
      threadSnapshot: buildGitHubThreadSnapshot(thread)
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "github_to_gdoc",
      kind: "comment_synced",
      ghCommentId: thread.rootComment.id,
      docCommentId,
      path: thread.path,
      line: thread.line,
      snippet: activitySnippet(thread.rootComment.body),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  private async pushSingleGHReplyToDoc(
    reply: GitHubReviewComment,
    parentMapping: CommentMapping,
    mapping: DocMapping,
    gToken: string,
    options: PushOptions = {}
  ): Promise<void> {
    if (reply.inReplyToId == null) return;
    const { cache, dedup = true } = options;

    let existingRemoteReply: GoogleDocReply | undefined;
    if (dedup) {
      const remoteComments = await this.fetchDocCommentsCached(gToken, parentMapping.docId, cache);
      const parentRemote = remoteComments.find((c) => c.id === parentMapping.docCommentId);
      existingRemoteReply = parentRemote?.replies?.find(
        (r) => extractGHCommentIdFromMirroredBody(r.content) === reply.id
      );
    }

    const docReplyId = existingRemoteReply
      ? existingRemoteReply.id
      : (
          await pushGDocReply(
            gToken,
            parentMapping.docId,
            parentMapping.docCommentId,
            formatGitHubMirroredBody(reply)
          )
        ).id;

    const replyMapping: ReplyMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghReplyId: reply.id,
      docReplyId,
      ghParentCommentId: reply.inReplyToId,
      docParentCommentId: parentMapping.docCommentId,
      docId: parentMapping.docId,
      source: "github",
      ghUpdatedAt: reply.updatedAt
    };
    await this.replyMappingStore.upsert(replyMapping);
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
      // Force push, no remote-dedup fetch: this only runs right after
      // recreateGHThreadInDoc deleted the prior mirrored thread, so there is
      // nothing to dedup against.
      await this.pushSingleGHReplyToDoc(reply, parentMapping, mapping, gToken, { dedup: false });
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
    await deleteGDocComment(gToken, existing.docId, existing.docCommentId);
    for (const replyMapping of previousReplyMappings) {
      await this.replyMappingStore.removeByGH(replyMapping.ghReplyId);
    }
    const recreatedMapping = await this.pushGHThreadToDocCore(thread, mapping, gToken, {
      dedup: false
    });
    if (!recreatedMapping) return;
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
        await resolveGDocComment(gToken, existing.docId, existing.docCommentId);
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
    mapping: DocMapping,
    docId: string
  ): Promise<CommentMapping> {
    // Fast path: local mapping already records this comment as synced.
    const existingLocal = await this.mappingStore.getByDoc(comment.id);
    if (existingLocal) return existingLocal;

    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) {
      throw new Error("GitHub token missing during push");
    }

    const targetDoc = findDocById(mapping, docId) ?? this.resolveTargetDoc(mapping, "");
    if (!targetDoc) {
      throw new Error(`No linked file found for Google Doc ${docId}`);
    }

    if (!comment.quotedFileContent) {
      throw new Error("Cannot push comment without highlighted text (no line match possible)");
    }

    const parts = mapping.repo.split("/");
    const owner = parts[0];
    const name = parts[1];
    if (!owner || !name) {
      throw new Error(`Invalid repo format: ${mapping.repo}`);
    }

    // Comments are now doc-scoped (one doc == one file): only fetch and
    // search the single file this doc corresponds to, instead of every
    // markdown file in the PR.
    const prFiles = await fetchPullRequestFiles(
      { owner, repo: name, prNumber: mapping.prNumber },
      {
        fetch: fetch.bind(globalThis),
        token: ghToken
      }
    );
    const mdFiles = filterMarkdownFiles(prFiles);
    const fileRef = mdFiles.find((f) => f.filename === targetDoc.filename);
    if (!fileRef) {
      throw new Error(`File "${targetDoc.filename}" not found among the PR's markdown files.`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 30_000);
    const fileResp = await fetch(fileRef.rawUrl, {
      headers: { Authorization: `token ${ghToken}` },
      signal: controller.signal
    }).finally(() => {
      clearTimeout(timeout);
    });
    const content = await fileResp.text();

    const matches = findLineMatch(comment.quotedFileContent, [
      { filename: targetDoc.filename, content }
    ]);
    if (matches.length === 0) {
      throw new Error("Could not find matching text in the linked file.");
    }

    const bestMatch = matches[0];
    if (!bestMatch) {
      throw new Error("Match array empty after check.");
    }

    // Remote dedup: this is a standalone call (no already-fetched thread
    // list to reuse), so fetch fresh and check whether a GH comment already
    // carries this doc comment's marker before creating a new one.
    const threads = await fetchReviewThreads(ghToken, mapping.repo, mapping.prNumber);
    const existingGhId = findExistingGHIdForDocComment(threads, comment.id);

    const ghCommentId =
      existingGhId ??
      (
        await createReviewComment(ghToken, mapping.repo, mapping.prNumber, {
          body: await this.formatDocCommentBodyForGH(comment, targetDoc.docUrl),
          commit_id: mapping.headSha,
          path: bestMatch.path,
          line: bestMatch.line,
          side: "RIGHT"
        })
      ).id;

    const commentMapping: CommentMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghCommentId,
      docCommentId: comment.id,
      docId: targetDoc.docId,
      source: "gdoc"
    };

    await this.mappingStore.upsert(commentMapping);
    await this.activityStore.append({
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      direction: "gdoc_to_github",
      kind: "comment_synced",
      ghCommentId,
      docCommentId: comment.id,
      path: bestMatch.path,
      line: bestMatch.line,
      snippet: activitySnippet(comment.content),
      createdAt: new Date().toISOString()
    });
    return commentMapping;
  }

  private async pushSingleDocReplyToGH(
    reply: GoogleDocReply,
    parentMapping: CommentMapping,
    mapping: DocMapping,
    ghToken: string,
    ghMarkerIndex: Map<string, number>
  ): Promise<void> {
    const targetDoc =
      findDocById(mapping, parentMapping.docId) ?? this.resolveTargetDoc(mapping, "");
    const docUrl = targetDoc?.docUrl ?? "";

    const existingGhId = ghMarkerIndex.get(reply.id);
    const ghReplyId =
      existingGhId ??
      (
        await createReviewCommentReply(
          ghToken,
          mapping.repo,
          mapping.prNumber,
          parentMapping.ghCommentId,
          await this.formatDocReplyBodyForGH(reply, docUrl)
        )
      ).id;

    const replyMapping: ReplyMapping = {
      repo: mapping.repo,
      prNumber: mapping.prNumber,
      ghReplyId,
      docReplyId: reply.id,
      ghParentCommentId: parentMapping.ghCommentId,
      docParentCommentId: parentMapping.docCommentId,
      docId: parentMapping.docId,
      source: "gdoc"
    };
    await this.replyMappingStore.upsert(replyMapping);
  }

  /** Manual "sync everything" sweep — no longer alarm-driven, kept for a bulk action. */
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

  private async runSyncAll(): Promise<void> {
    const active = await this.docStore.listActive();
    await Promise.all(active.map((ref) => this.syncPR(ref)));
  }

  /** Primary entry point: sync one PR on demand (button click), not an alarm sweep. */
  async syncPR(ref: PullRequestRef): Promise<void> {
    const ghToken = await this.authStore.getGitHubToken();
    if (!ghToken) return;
    const gToken = await this.authStore.getGoogleToken(false);

    const acquired = await this.syncLockStore.acquire(ref, SYNC_LOCK_TTL_MS);
    if (!acquired) return; // another sync is already in flight

    try {
      await this.runPRSync(ref, ghToken, gToken);
    } finally {
      await this.syncLockStore.release(ref);
    }
  }

  private async runPRSync(
    ref: PullRequestRef,
    ghToken: string,
    gToken: string | undefined
  ): Promise<void> {
    const lockKey = `${ref.repo}#${ref.prNumber.toString()}`;
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
      const docCommentsCache = new Map<string, GoogleDocComment[]>();

      // GH top-level comments → Doc, plus first-pass lifecycle for mapped GH threads.
      for (const thread of threads) {
        // Skip comments pushed from GDoc — they were already synced and should
        // not be mirrored back to GDoc (infinite loop protection).
        if (thread.rootComment.body.startsWith("> From Google Docs -- ")) {
          continue;
        }

        const existingRootMapping = await this.mappingStore.getByGH(thread.rootComment.id);
        if (!existingRootMapping) {
          if (!gToken) continue;
          await this.pushGHThreadToDocCore(thread, mapping, gToken, { cache: docCommentsCache });
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
            let parentMapping = await this.mappingStore.getByGH(reply.inReplyToId);
            if (!parentMapping) {
              // Parent is a reply, not a root comment — resolve via replyMappingStore.
              const parentReplyMap = await this.replyMappingStore.getByGH(reply.inReplyToId);
              if (parentReplyMap) {
                parentMapping = {
                  docCommentId: parentReplyMap.docParentCommentId,
                  docId: parentReplyMap.docId,
                  repo: mapping.repo,
                  prNumber: mapping.prNumber,
                  source: parentReplyMap.source,
                  ghCommentId: parentReplyMap.ghParentCommentId
                };
              }
            }
            if (!parentMapping || parentMapping.resolvedAt) continue;
            try {
              await this.pushSingleGHReplyToDoc(reply, parentMapping, mapping, gToken, {
                cache: docCommentsCache
              });
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

        // Doc replies → GH. Built once from the already-fetched thread list
        // so we don't issue a redundant GH fetch per doc reply.
        const ghMarkerIndex = buildGHMarkerIndex(threads);
        for (const doc of mapping.docs) {
          const docComments = await this.fetchDocCommentsCached(
            gToken,
            doc.docId,
            docCommentsCache
          );
          for (const docComment of docComments) {
            const parentMapping = await this.mappingStore.getByDoc(docComment.id);
            if (!parentMapping) continue;
            for (const reply of docComment.replies ?? []) {
              if (await this.replyMappingStore.hasByDoc(reply.id)) continue;
              try {
                await this.pushSingleDocReplyToGH(
                  reply,
                  parentMapping,
                  mapping,
                  ghToken,
                  ghMarkerIndex
                );
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
  }

  private async formatGDocAuthor(googleAuthor: string): Promise<string> {
    const mapping = await this.identityStore.getByGoogleAuthor(googleAuthor);
    return mapping ? `@${mapping.githubLogin}` : googleAuthor;
  }

  private async formatDocCommentBodyForGH(
    comment: GoogleDocComment,
    docUrl: string
  ): Promise<string> {
    const author = await this.formatGDocAuthor(comment.author);
    return `> From Google Docs -- ${author} -- ${comment.content}\n\n[View in GDoc](${docUrl}?disco=${comment.id})\n\n${buildGHSourceMarker(comment.id)}`;
  }

  private async formatDocReplyBodyForGH(reply: GoogleDocReply, docUrl: string): Promise<string> {
    const author = await this.formatGDocAuthor(reply.author);
    return `> From Google Docs -- ${author} -- ${reply.content}\n\n[View in GDoc](${docUrl}?disco=${reply.id})\n\n${buildGHSourceMarker(reply.id)}`;
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

/** Maps a doc comment/reply id -> the GH comment id that already carries its `dorv-src` marker. */
function buildGHMarkerIndex(threads: GitHubReviewThread[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const thread of threads) {
    const rootMarker = extractDocMarkerFromGHBody(thread.rootComment.body);
    if (rootMarker) index.set(rootMarker, thread.rootComment.id);
    for (const reply of thread.replies) {
      const replyMarker = extractDocMarkerFromGHBody(reply.body);
      if (replyMarker) index.set(replyMarker, reply.id);
    }
  }
  return index;
}

function findExistingGHIdForDocComment(
  threads: GitHubReviewThread[],
  docCommentId: string
): number | undefined {
  return buildGHMarkerIndex(threads).get(docCommentId);
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
