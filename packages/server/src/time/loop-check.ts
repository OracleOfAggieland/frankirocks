/**
 * The loop's check at `checkAt`, stored (brief 030 P1-3; spec §10 Loop; brief 022 `loopStateAfter`).
 *
 * When the tick moves a `celebrate` moment, the comparison it ran (outside the transaction, from rows) moves the loop
 * Memory's `loop.state` by the hero lane's table: `waiting` stays while the comparison waits; otherwise it becomes
 * `eligible`, `noChange` or `incomplete`. Nothing is said here: `eligible` becomes `celebrated` only through
 * `markCelebrated`, after the line has played (phase two). The loop is reread in the moment's transaction.
 */
import { type Memory, loopStateAfter, tsFromMs } from "@franki/core";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";
import type { LoopComparison } from "../routes/tool-food";

/** The loop Memory after the check, or null when nothing changes. Pure. */
export function loopAfterCheck(m: Memory, c: LoopComparison, opsNow: number): Memory | null {
  if (m.loop === null || m.status !== "active") return null;
  const state = loopStateAfter(m.loop.state, c.takeout.status);
  if (state === m.loop.state) return null;
  return { ...m, loop: { ...m.loop, state }, updatedAt: tsFromMs(opsNow) };
}

/** Writes the loop's new state in the moment's transaction. Returns true when it wrote. */
export async function storeLoopCheck(tx: Tx, uid: string, c: LoopComparison, opsNow: number): Promise<boolean> {
  const doc = await tx.get<Memory>(paths.memory(uid, c.loopId));
  if (doc === null) return false;
  const next = loopAfterCheck(doc.data, c, opsNow);
  if (next === null) return false;
  tx.update(doc.path, next);
  return true;
}
