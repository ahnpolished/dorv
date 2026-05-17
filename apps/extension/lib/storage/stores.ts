import type {
  CommentMapping,
  DocMapping,
  PullRequestRef,
  ReplyMapping,
  SyncStatus
} from "../adapters/types.js";
import type { StorageArea } from "./area.js";

const activePrsKey = "active_prs";

function prKey(prefix: string, ref: PullRequestRef): string {
  return `${prefix}:${ref.repo}#${ref.prNumber.toString()}`;
}

function ghKey(prefix: string, id: number): string {
  return `${prefix}:gh:${id.toString()}`;
}

function docKey(prefix: string, id: string): string {
  return `${prefix}:doc:${id}`;
}

async function getValue<T>(storage: StorageArea, key: string): Promise<T | undefined> {
  const values = await storage.get([key]);
  return values[key] as T | undefined;
}

async function getArray<T>(storage: StorageArea, key: string): Promise<T[]> {
  return (await getValue<T[]>(storage, key)) ?? [];
}

async function addActivePr(storage: StorageArea, ref: PullRequestRef): Promise<void> {
  const active = await getArray<PullRequestRef>(storage, activePrsKey);
  if (active.some((item) => item.repo === ref.repo && item.prNumber === ref.prNumber)) {
    return;
  }

  await storage.set({ [activePrsKey]: [...active, { repo: ref.repo, prNumber: ref.prNumber }] });
}

export function createDocStore(storage: StorageArea) {
  return {
    async get(repo: string, prNumber: number): Promise<DocMapping | undefined> {
      return getValue<DocMapping>(storage, prKey("docStore", { repo, prNumber }));
    },
    async upsert(mapping: DocMapping): Promise<void> {
      await storage.set({ [prKey("docStore", mapping)]: mapping });
      await addActivePr(storage, mapping);
    },
    async listActive(): Promise<PullRequestRef[]> {
      return getArray<PullRequestRef>(storage, activePrsKey);
    },
    async getByDocId(docId: string): Promise<DocMapping | undefined> {
      const active = await this.listActive();
      for (const ref of active) {
        const mapping = await this.get(ref.repo, ref.prNumber);
        if (mapping?.docId === docId) return mapping;
      }
      return undefined;
    }
  };
}

export function createMappingStore(storage: StorageArea) {
  return {
    async upsert(mapping: CommentMapping): Promise<void> {
      const ghk = ghKey("mappingStore", mapping.ghCommentId);
      const dk = docKey("mappingStore", mapping.docCommentId);
      const prk = prKey("mappingStore:pr", mapping);
      
      const prMappings = await getArray<CommentMapping>(storage, prk);
      const updated = prMappings.filter(m => m.ghCommentId !== mapping.ghCommentId);
      updated.push(mapping);

      await storage.set({
        [ghk]: mapping,
        [dk]: mapping,
        [prk]: updated
      });
    },
    async getByGH(ghCommentId: number): Promise<CommentMapping | undefined> {
      return getValue<CommentMapping>(storage, ghKey("mappingStore", ghCommentId));
    },
    async getByDoc(docCommentId: string): Promise<CommentMapping | undefined> {
      return getValue<CommentMapping>(storage, docKey("mappingStore", docCommentId));
    },
    async hasByGH(ghCommentId: number): Promise<boolean> {
      return (await this.getByGH(ghCommentId)) !== undefined;
    },
    async hasByDoc(docCommentId: string): Promise<boolean> {
      return (await this.getByDoc(docCommentId)) !== undefined;
    },
    async listByPR(repo: string, prNumber: number): Promise<CommentMapping[]> {
      return getArray<CommentMapping>(storage, prKey("mappingStore:pr", { repo, prNumber }));
    }
  };
}

export function createReplyMappingStore(storage: StorageArea) {
  return {
    async upsert(mapping: ReplyMapping): Promise<void> {
      await storage.set({
        [ghKey("replyMappingStore", mapping.ghReplyId)]: mapping,
        [docKey("replyMappingStore", mapping.docReplyId)]: mapping
      });
    },
    async getByGH(ghReplyId: number): Promise<ReplyMapping | undefined> {
      return getValue<ReplyMapping>(storage, ghKey("replyMappingStore", ghReplyId));
    },
    async getByDoc(docReplyId: string): Promise<ReplyMapping | undefined> {
      return getValue<ReplyMapping>(storage, docKey("replyMappingStore", docReplyId));
    }
  };
}

export function createStatusStore(storage: StorageArea) {
  return {
    async get(repo: string, prNumber: number): Promise<SyncStatus | undefined> {
      return getValue<SyncStatus>(storage, prKey("statusStore", { repo, prNumber }));
    },
    async set(status: SyncStatus): Promise<void> {
      await storage.set({ [prKey("statusStore", status)]: status });
    }
  };
}
