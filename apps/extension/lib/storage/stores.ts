import type {
  CommentMapping,
  DocMapping,
  IdentityMapping,
  NewSyncedActivity,
  PullRequestRef,
  ReplyMapping,
  SyncedActivity,
  SyncStatus
} from "../adapters/types.js";
import type { StorageArea } from "./area.js";

const activePrsKey = "active_prs";
const activityStoreKey = "activityStore:events";
const activityStoreLimit = 1000;

function prKey(prefix: string, ref: PullRequestRef): string {
  return `${prefix}:${ref.repo}#${ref.prNumber.toString()}`;
}

function ghKey(prefix: string, id: number | string): string {
  return `${prefix}:gh:${id.toString()}`;
}

function docKey(prefix: string, id: string): string {
  return `${prefix}:doc:${id}`;
}

function replyParentKey(ghParentCommentId: number | string): string {
  return `replyMappingStore:parent-gh:${ghParentCommentId.toString()}`;
}

function identityKey(googleAuthor: string): string {
  return `identityStore:google:${googleAuthor}`;
}

function activityId(activity: NewSyncedActivity): string {
  return (
    activity.id ??
    [
      activity.kind,
      activity.direction,
      activity.repo,
      activity.prNumber.toString(),
      activity.ghCommentId?.toString() ?? "no-gh",
      activity.docCommentId ?? "no-doc"
    ].join(":")
  );
}

function activitySortNewestFirst(a: SyncedActivity, b: SyncedActivity): number {
  const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return b.id.localeCompare(a.id);
}

function trimActivities(activities: SyncedActivity[]): SyncedActivity[] {
  return [...activities]
    .sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
      if (byCreatedAt !== 0) return byCreatedAt;
      return a.id.localeCompare(b.id);
    })
    .slice(-activityStoreLimit)
    .sort(activitySortNewestFirst);
}

function snippetForMapping(mapping: CommentMapping): string {
  if (mapping.source === "github") {
    return `GitHub comment ${mapping.ghCommentId.toString()} synced to GDoc comment ${mapping.docCommentId}`;
  }
  return `GDoc comment ${mapping.docCommentId} synced to GitHub comment ${mapping.ghCommentId.toString()}`;
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

      const existingByGH = await getValue<CommentMapping>(storage, ghk);
      const prMappings = await getArray<CommentMapping>(storage, prk);
      const updated = prMappings.filter(
        (m) => String(m.ghCommentId) !== String(mapping.ghCommentId)
      );
      updated.push(mapping);

      if (existingByGH && existingByGH.docCommentId !== mapping.docCommentId) {
        await storage.remove([docKey("mappingStore", existingByGH.docCommentId)]);
      }

      await storage.set({
        [ghk]: mapping,
        [dk]: mapping,
        [prk]: updated
      });
    },
    async getByGH(ghCommentId: number | string): Promise<CommentMapping | undefined> {
      const ghk = ghKey("mappingStore", ghCommentId);
      return getValue<CommentMapping>(storage, ghk);
    },
    async getByDoc(docCommentId: string): Promise<CommentMapping | undefined> {
      return getValue<CommentMapping>(storage, docKey("mappingStore", docCommentId));
    },
    async hasByGH(ghCommentId: number | string): Promise<boolean> {
      return (await this.getByGH(ghCommentId)) !== undefined;
    },
    async hasByDoc(docCommentId: string): Promise<boolean> {
      return (await this.getByDoc(docCommentId)) !== undefined;
    },
    async listByPR(repo: string, prNumber: number): Promise<CommentMapping[]> {
      return getArray<CommentMapping>(storage, prKey("mappingStore:pr", { repo, prNumber }));
    },
    async removeByGH(ghCommentId: number | string): Promise<void> {
      const mapping = await this.getByGH(ghCommentId);
      if (!mapping) return;
      const prk = prKey("mappingStore:pr", mapping);
      const prMappings = await getArray<CommentMapping>(storage, prk);
      await storage.set({
        [prk]: prMappings.filter((m) => String(m.ghCommentId) !== String(ghCommentId))
      });
      await storage.remove([
        ghKey("mappingStore", ghCommentId),
        docKey("mappingStore", mapping.docCommentId)
      ]);
    }
  };
}

export function createReplyMappingStore(storage: StorageArea) {
  return {
    async upsert(mapping: ReplyMapping): Promise<void> {
      const ghk = ghKey("replyMappingStore", mapping.ghReplyId);
      const dk = docKey("replyMappingStore", mapping.docReplyId);
      const pk = replyParentKey(mapping.ghParentCommentId);
      const existingByGH = await getValue<ReplyMapping>(storage, ghk);
      if (existingByGH && existingByGH.docReplyId !== mapping.docReplyId) {
        await storage.remove([docKey("replyMappingStore", existingByGH.docReplyId)]);
      }
      if (
        existingByGH &&
        String(existingByGH.ghParentCommentId) !== String(mapping.ghParentCommentId)
      ) {
        const oldPk = replyParentKey(existingByGH.ghParentCommentId);
        const oldParentMappings = await getArray<ReplyMapping>(storage, oldPk);
        await storage.set({
          [oldPk]: oldParentMappings.filter(
            (m) => String(m.ghReplyId) !== String(mapping.ghReplyId)
          )
        });
      }
      const parentMappings = await getArray<ReplyMapping>(storage, pk);
      const updatedParentMappings = parentMappings.filter(
        (m) => String(m.ghReplyId) !== String(mapping.ghReplyId)
      );
      updatedParentMappings.push(mapping);
      await storage.set({
        [ghk]: mapping,
        [dk]: mapping,
        [pk]: updatedParentMappings
      });
    },
    async getByGH(ghReplyId: number | string): Promise<ReplyMapping | undefined> {
      return getValue<ReplyMapping>(storage, ghKey("replyMappingStore", ghReplyId));
    },
    async getByDoc(docReplyId: string): Promise<ReplyMapping | undefined> {
      return getValue<ReplyMapping>(storage, docKey("replyMappingStore", docReplyId));
    },
    async hasByGH(ghReplyId: number | string): Promise<boolean> {
      return (await this.getByGH(ghReplyId)) !== undefined;
    },
    async hasByDoc(docReplyId: string): Promise<boolean> {
      return (await this.getByDoc(docReplyId)) !== undefined;
    },
    async listByParentGH(ghParentCommentId: number | string): Promise<ReplyMapping[]> {
      return getArray<ReplyMapping>(storage, replyParentKey(ghParentCommentId));
    },
    async removeByGH(ghReplyId: number | string): Promise<void> {
      const mapping = await this.getByGH(ghReplyId);
      if (!mapping) return;
      const pk = replyParentKey(mapping.ghParentCommentId);
      const parentMappings = await getArray<ReplyMapping>(storage, pk);
      await storage.set({
        [pk]: parentMappings.filter((m) => String(m.ghReplyId) !== String(ghReplyId))
      });
      await storage.remove([
        ghKey("replyMappingStore", ghReplyId),
        docKey("replyMappingStore", mapping.docReplyId)
      ]);
    }
  };
}

export function createIdentityStore(storage: StorageArea) {
  return {
    async upsert(mapping: IdentityMapping): Promise<void> {
      await storage.set({ [identityKey(mapping.googleAuthor)]: mapping });
    },
    async getByGoogleAuthor(googleAuthor: string): Promise<IdentityMapping | undefined> {
      return getValue<IdentityMapping>(storage, identityKey(googleAuthor));
    }
  };
}

export function createActivityStore(storage: StorageArea) {
  return {
    async append(activity: NewSyncedActivity): Promise<SyncedActivity> {
      const existing = await getArray<SyncedActivity>(storage, activityStoreKey);
      const nextActivity: SyncedActivity = {
        ...activity,
        id: activityId(activity)
      };
      const withoutDuplicate = existing.filter((item) => item.id !== nextActivity.id);
      const next = trimActivities([...withoutDuplicate, nextActivity]);
      await storage.set({ [activityStoreKey]: next });
      return nextActivity;
    },
    async listAll(): Promise<SyncedActivity[]> {
      return trimActivities(await getArray<SyncedActivity>(storage, activityStoreKey));
    },
    async listByPR(repo: string, prNumber: number): Promise<SyncedActivity[]> {
      const activities = await this.listAll();
      return activities.filter(
        (activity) => activity.repo === repo && activity.prNumber === prNumber
      );
    },
    async bootstrapFromMappings(
      repo: string,
      prNumber: number,
      mappings: CommentMapping[],
      createdAt: string
    ): Promise<SyncedActivity[]> {
      const bootstrapped: SyncedActivity[] = [];
      const existingIds = new Set((await this.listAll()).map((activity) => activity.id));
      for (const mapping of mappings) {
        if (mapping.repo !== repo || mapping.prNumber !== prNumber) continue;
        const activity: NewSyncedActivity = {
          repo,
          prNumber,
          direction: mapping.source === "github" ? "github_to_gdoc" : "gdoc_to_github",
          kind: "comment_synced",
          ghCommentId: mapping.ghCommentId,
          docCommentId: mapping.docCommentId,
          snippet: snippetForMapping(mapping),
          createdAt
        };
        if (existingIds.has(activityId(activity))) continue;
        const appended = await this.append(activity);
        existingIds.add(appended.id);
        bootstrapped.push(appended);
      }
      return bootstrapped;
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

export function createSettingsStore(storage: StorageArea) {
  const KEY = "settingsStore:autoOpenSidepanel";
  return {
    async getAutoOpenSidepanel(): Promise<boolean> {
      return (await getValue<boolean>(storage, KEY)) ?? true;
    },
    async setAutoOpenSidepanel(value: boolean): Promise<void> {
      await storage.set({ [KEY]: value });
    }
  };
}
