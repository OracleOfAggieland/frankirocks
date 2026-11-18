import { type Ledger, tsFromMs } from "@franki/core";
import { paths } from "../store/paths";
import type { StorePort } from "../store/port";

/** A forget drains every matching row. The regular expiry pass handles one bounded page per tick. */
export async function clearPrivateRows(store: StorePort, uid: string, kind: "phoneReport" | "webSearch", cutoff?: number) {
  const pageSize = 100;
  let count: number;
  do {
    count = await store.transaction(uid, async (tx) => {
      const rows = await tx.query<Ledger>({
        collection: paths.collection(uid, "ledger"),
        where: [{ field: "kind", op: "==", value: kind }, ...(cutoff === undefined ? [] : [{ field: "at", op: "<=" as const, value: tsFromMs(cutoff) }])],
        orderBy: { field: "at", dir: "desc" }, limit: pageSize,
      });
      for (const row of rows) tx.delete(row.path);
      return rows.length;
    });
  } while (cutoff === undefined && count === pageSize);
}
