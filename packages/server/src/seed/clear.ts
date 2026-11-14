/**
 * Every row of one tenant, read and cleared in pages by document ID (Q28), each Session's turns too (brief 019 task
 * 5; contracts §1 "Reset ... clears all tenant rows (paged Q28, subcollections too)").
 */
import type { Block, CoreEpoch, Evidence, ID } from "@franki/core";
import { staleError } from "../routes/errors";
import type { StoredDoc, StorePort, Tx } from "../store/port";
import { TOP_COLLECTIONS, paths } from "../store/paths";

/**
 * Brief 038 finding 8: inside each write transaction of a reset, the barrier must still carry that reset's operation
 * ID. A reset that ran past its deadline and was taken over answers STALE at its next write and writes nothing more.
 * With no `opId` (a load outside a reset, in tests) nothing is checked.
 */
export async function assertBarrier(tx: Tx, uid: string, opId: ID | undefined): Promise<void> {
  if (opId === undefined) return;
  const epoch = await tx.get<CoreEpoch>(paths.core(uid, "epoch"));
  if (epoch?.data.barrier?.opId !== opId) throw staleError("barrier");
}

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

/**
 * Deletes every row of the tenant except the core documents and the paths in `keep`, one page per transaction.
 * Each Session's turns go before the Session. Returns the number of rows deleted. With `opId`, each transaction
 * first checks that the reset `opId` still holds the barrier (brief 038 finding 8).
 */
/**
 * The provider keys of the rows a kept connector read (a connected Google account, a bank). Review D6: a forget's
 * block on one of them outlives "Start over", because the connection does, and without it the next read would fetch
 * and store the forgotten message again.
 */
async function connectorProviderKeys(store: StorePort, uid: string): Promise<Set<string>> {
  const keys = new Set<string>();
  await pages(store, uid, paths.collection(uid, "evidence"), async (page) => {
    for (const r of page) {
      const e = r.data as Partial<Evidence>;
      if (e.connectorId != null && typeof e.providerKey === "string") keys.add(e.providerKey);
    }
  });
  return keys;
}

export async function clearTenant(store: StorePort, uid: string, keep: ReadonlySet<string>, opId?: ID): Promise<number> {
  let deleted = 0;
  const connectorKeys = await connectorProviderKeys(store, uid);
  const keptBlock = (r: StoredDoc) => {
    if (!r.path.includes("/blocks/")) return false;
    const b = r.data as Partial<Block>;
    return b.kind === "provider" && typeof b.providerKey === "string" && connectorKeys.has(b.providerKey);
  };
  const drop = async (page: StoredDoc[]) => {
    const gone = page.filter((r) => !keep.has(r.path) && !keptBlock(r));
    if (gone.length === 0) return;
    await store.transaction(uid, async (tx) => {
      await assertBarrier(tx, uid, opId);
      for (const r of gone) tx.delete(r.path);
    });
    deleted += gone.length;
  };
  for (const collection of TOP_COLLECTIONS) {
    if (collection === "core") continue;
    // Brief 046 ruling 9: "start over" keeps a connected bank. The reset's last transaction resets each connector's
    // cursor and coverage instead (`resetBankCursors`), so the token is never orphaned.
    if (collection === "connectors") continue;
    await pages(store, uid, paths.collection(uid, collection), async (page) => {
      if (collection === "sessions") for (const s of page) await pages(store, uid, paths.turns(uid, s.id), drop);
      await drop(page);
    });
  }
  return deleted;
}
