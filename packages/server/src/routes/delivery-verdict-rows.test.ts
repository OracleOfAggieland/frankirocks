// Brief 042 item 4: delivery's own Gate verdicts that are not `say` get rows, one per candidate per Session.
import { type Ledger, type Session, tsFromMs } from "@franki/core";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { patchRecord, settle } from "../testing/fakes";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";
import { openingProactive } from "./delivery-wire";

async function gateRows(h: Awaited<ReturnType<typeof hero>>) {
  const all = await h.rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 });
  return all.filter((d) => d.data.kind === "gate").map((d) => d.data.payload as { outcome: string; momentId: string | null; sessionId: string | null; reasonCodes: string[] });
}

describe("rows for delivery's own Gate verdicts (brief 042 item 4)", () => {
  it("a crisis holds the hero offer: one held row naming the moment and the reason, once per Session", async () => {
    const h = await hero();
    await memoryTick(h.ctx);
    const { s } = await h.openLine();
    const before = await gateRows(h);
    await patchRecord<Session>(h.rig.store, UID, paths.session(UID, s.sessionId), { modifiers: { rushed: null, crisis: tsFromMs(h.rig.clock.read().opsClock.now) } });
    for (let i = 0; i < 2; i++) expect((await settle(openingProactive(h.ctx, s.stamp, 3_000), h.rig.clock, h.rig.timers)).value).toBeNull();
    const rows = (await gateRows(h)).slice(before.length);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe("held");
    expect(rows[0]!.sessionId).toBe(s.sessionId);
    expect(rows[0]!.reasonCodes).toContain("crisis");
  });

  it("the chosen line has no row until it is said", async () => {
    const h = await hero();
    await memoryTick(h.ctx);
    const { proactive } = await h.openLine();
    expect(proactive).not.toBeNull();
    expect(await gateRows(h)).toEqual([]);
  });
});
