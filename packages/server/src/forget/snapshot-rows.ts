/**
 * The owner's forget blocks and overlays for a production Snapshot (review 028, finding 3; contracts §4 clause
 * 10b; brief 021). Without them `forgetDenies` denies nothing outside tests. Read by Q28 pages of document ID (no
 * new index: ruling F-9). Past the caps the result is not complete, and a Snapshot built from it is not complete
 * either, so `eligible` denies every read (fails closed) rather than miss a block.
 */
import type { Block, DocRef, Overlay, SnapshotRow } from "@franki/core";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

type Reader = Pick<Tx, "query" | "get">;

/** The Snapshot holds at most 128 blocks (contracts §4 Snapshot `blocks`). */
export const SNAPSHOT_BLOCKS_MAX = 128;
/** Overlays carried as Snapshot rows (the Snapshot holds 4,096 rows in all). */
export const SNAPSHOT_OVERLAYS_MAX = 1_024;
const PAGE = 100;

export interface ForgetRows {
  blocks: Block[];
  refs: DocRef[];
  rows: SnapshotRow[];
  complete: boolean;
}

async function readUpTo<T>(reader: Reader, collection: string, max: number): Promise<{ docs: { id: string; data: T }[]; complete: boolean }> {
  const docs: { id: string; data: T }[] = [];
  let after: string | null = null;
  for (;;) {
    const page: { id: string; data: T }[] = await reader.query<T>({
      collection,
      where: after === null ? [] : [{ field: "__name__", op: ">", value: after }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: PAGE,
    });
    for (const d of page) {
      if (docs.length >= max) return { docs, complete: false };
      docs.push(d);
    }
    if (page.length < PAGE) return { docs, complete: true };
    after = page[page.length - 1]!.id;
  }
}

export async function forgetRowsFor(reader: Reader, uid: string): Promise<ForgetRows> {
  const [blocks, overlays] = await Promise.all([
    readUpTo<Block>(reader, paths.collection(uid, "blocks"), SNAPSHOT_BLOCKS_MAX),
    readUpTo<Overlay>(reader, paths.collection(uid, "overlays"), SNAPSHOT_OVERLAYS_MAX),
  ]);
  return {
    blocks: blocks.docs.map((d) => d.data),
    refs: overlays.docs.map((d): DocRef => ({ collection: "overlays", id: d.id, parentId: null, rev: d.data.rev })),
    rows: overlays.docs.map((d) => d.data),
    complete: blocks.complete && overlays.complete,
  };
}
