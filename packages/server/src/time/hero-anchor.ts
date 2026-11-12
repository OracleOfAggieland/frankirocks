/**
 * Where the hero window ends (brief 030 P1-1; brief 029 finding 3; question X-165).
 *
 * `heroWindow(today)` ends the day before the world's today, so a jump moved the window off the dates the offer was
 * found on, and after the bolt the offer was gone. Ruling (fails closed, one function): while an `insight` moment of
 * the hero rollup is live, the window ends on that moment's `occurrenceKey` (derive keys it on the window's last
 * date), so the offer, its "yes" and the tick all read the dates the moment was found on. With no live moment, the
 * window ends yesterday, as before.
 *
 * Live: pending, leased, admitted or delivered, and not past its `closeAt` in world time. The newest by due time
 * wins; derive's cooldown keeps it to one.
 */
import { type Hasher, type Moment, heroRollupId, msFromTs } from "@franki/core";
import { paths } from "../store/paths";
import type { Reader } from "../store/port";

/** Moment rows read by document ID (Q28). Past this many, no anchor is taken: the window ends yesterday. */
export const HERO_ANCHOR_SCAN_MAX = 2_000;

const LIVE: ReadonlySet<Moment["status"]> = new Set(["pending", "leased", "admitted", "delivered"]);

/** The last date of the live hero insight's window, or null when none is live. */
export async function heroAnchor(reader: Reader, uid: string, hasher: Hasher, worldNow: number): Promise<string | null> {
  const rollupId = heroRollupId(hasher);
  let best: Moment | null = null;
  let seen = 0;
  let cursor: string | null = null;
  for (;;) {
    const page: { id: string; data: Moment }[] = await reader.query<Moment>({
      collection: paths.collection(uid, "moments"),
      where: cursor === null ? [] : [{ field: "__name__", op: ">", value: cursor }],
      orderBy: { field: "__name__", dir: "asc" },
      limit: 100,
    });
    seen += page.length;
    if (seen > HERO_ANCHOR_SCAN_MAX) return null;
    for (const { data: m } of page) {
      if (m.kind !== "insight" || m.rollupId !== rollupId || !LIVE.has(m.status) || msFromTs(m.closeAt) <= worldNow || msFromTs(m.dueAt) > worldNow) continue;
      if (best === null || msFromTs(m.dueAt) > msFromTs(best.dueAt)) best = m;
    }
    if (page.length < 100) break;
    cursor = page[page.length - 1]!.id;
  }
  return best?.occurrenceKey ?? null;
}
