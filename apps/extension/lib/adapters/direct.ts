import type {
  CommentMapping,
  CreateDocResult,
  DocMapping,
  GitHubReviewComment,
  GoogleDocComment,
  SyncAdapter
} from "./types.js";

export class DirectAdapter implements SyncAdapter {
  getDoc(): Promise<DocMapping | undefined> {
    return Promise.resolve(undefined);
  }

  createDoc(): Promise<CreateDocResult> {
    return Promise.reject(new Error("DirectAdapter.createDoc is implemented in HUM-1196"));
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

  pushGHCommentToDoc(): Promise<CommentMapping> {
    return Promise.reject(new Error("DirectAdapter.pushGHCommentToDoc is implemented in HUM-1197"));
  }

  pushDocCommentToGH(): Promise<CommentMapping> {
    return Promise.reject(new Error("DirectAdapter.pushDocCommentToGH is implemented in HUM-1198"));
  }

  syncAll(): Promise<void> {
    return Promise.resolve();
  }
}
