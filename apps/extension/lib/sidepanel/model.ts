import type { DocMapping } from "../adapters/types.js";
import { createDocStore } from "../storage/stores.js";

export async function buildPastDocsList(
  docStore: ReturnType<typeof createDocStore>
): Promise<DocMapping[]> {
  const refs = await docStore.listActive();
  const mappings = await Promise.all(refs.map((r) => docStore.get(r.repo, r.prNumber)));
  return mappings.filter((m): m is DocMapping => m !== undefined);
}
