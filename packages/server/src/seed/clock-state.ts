/**
 * The seam brief 023's `/api/seed/advance` will use (brief 019 task 6: "leave a clear seam"). It moves
 * `core/state.worldClock` and nothing else: no belief, Memory or Evidence changes with it (time can only ask), and it
 * is refused while a barrier is up (KS09). No route calls it yet.
 */
import { type ID, msFromTs, tsFromMs } from "@franki/core";
import { readCoreDocs } from "../core-docs";
import { barrierError, staleError } from "../routes/errors";
import { paths } from "../store/paths";
import type { Tx } from "../store/port";

/**
 * Sets the fixture world clock to `to` (ms). Refuses with BARRIER during a fence, and with STALE when the tenant is
 * not a clone, or when `namespace` no longer names the tenant's current clone (a reset came between).
 */
export async function setWorldClock(tx: Tx, uid: string, namespace: ID, to: number, opsNow: number): Promise<void> {
  const core = await readCoreDocs(tx, uid);
  if (core.epoch.data.barrier !== null) throw barrierError();
  const state = core.state.data;
  if (state.clockMode !== "fixture" || state.worldClock === null) throw staleError("notFixture");
  if (state.fixtureNamespace !== namespace) throw staleError("namespace");
  if (!Number.isFinite(to) || to === msFromTs(state.worldClock)) return;
  tx.update(paths.core(uid, "state"), { ...state, worldClock: tsFromMs(to), updatedAt: tsFromMs(opsNow) });
}
