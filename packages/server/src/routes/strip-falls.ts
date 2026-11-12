/**
 * The strip's money figure (brief 030 P1-4): each loop's fall in cents, from its `celebrate` moment, which the tick
 * fills at `checkAt` from the comparison over rows (`time/tick.ts`). Only a leased, admitted or delivered moment
 * counts: a skipped or cancelled one said no fall. Past the scan cap, no figure is given.
 */
import type { Moment } from "@franki/core";
import { paths } from "../store/paths";
import type { Reader } from "../store/port";

export const STRIP_MOMENT_SCAN_MAX = 2_000;

const COUNTS: ReadonlySet<Moment["status"]> = new Set(["leased", "admitted", "delivered"]);

export async function loopFalls(reader: Reader, uid: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
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
    if (seen > STRIP_MOMENT_SCAN_MAX) return new Map();
    for (const { data: m } of page) {
      const p = m.payload;
      if (p.kind !== "celebrate" || !COUNTS.has(m.status) || p.delta === null || p.delta <= 0) continue;
      out.set(p.loopId, p.delta);
    }
    if (page.length < 100) return out;
    cursor = page[page.length - 1]!.id;
  }
}
