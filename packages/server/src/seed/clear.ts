/**
 * Every row of one tenant, read and cleared in pages by document ID (Q28), each Session's turns too (brief 019 task
 * 5; contracts §1 "Reset ... clears all tenant rows (paged Q28, subcollections too)").
 */
import type { StoredDoc, StorePort } from "../store/port";
import { TOP_COLLECTIONS, paths } from "../store/paths";

/** Rows per page and per delete transaction. */
export const CLEAR_PAGE = 100;

async function pages(store: StorePort, uid: string, collection: string, each: (page: StoredDoc[]) => Promise<void>): Promise<void> {
  let after: string | null = null;
  for (;;) {
    const page: StoredDoc[] = await store.query(uid, {
      collection,
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: CLEAR_PAGE,
    });
    if (page.length === 0) return;
    await each(page);
    if (page.length < CLEAR_PAGE) return;
    after = page[page.length - 1]!.id;
  }
}

/** Every stored row of the tenant: the top collections, and every Session's turns. */
export async function listTenantRows(store: StorePort, uid: string): Promise<StoredDoc[]> {
  const out: StoredDoc[] = [];
  for (const collection of TOP_COLLECTIONS) {
    await pages(store, uid, paths.collection(uid, collection), async (page) => {
      out.push(...page);
      if (collection === "sessions") for (const s of page) await pages(store, uid, paths.turns(uid, s.id), async (turns) => void out.push(...turns));
    });
  }
  return out;
}

/** Deletes every row of the tenant except `keep` (paths). Not built yet. */
export async function clearTenant(_store: StorePort, _uid: string, _keep: ReadonlySet<string>): Promise<number> {
  return 0;
}
