// Brief 042 item 5: a said row from what was heard. Spec §6, "no ledger row, no claim".
import type { Ledger } from "@franki/core";
import { describe, expect, it } from "vitest";
import { paths } from "../store/paths";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";

async function line() {
  const h = await hero();
  await memoryTick(h.ctx);
  const { proactive } = await h.openLine();
  const receipt = h.played(proactive!, "resp_line_1");
  await receipt("admitted");
  await receipt("playbackStarted");
  const said = async () =>
    (await h.rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 }))
      .filter((d) => d.data.kind === "gate" && (d.data.payload as { outcome: string }).outcome === "said")
      .map((d) => d.data.payload as { turnId: string; noteIds: string[]; match: string; momentId: string });
  return { h, p: proactive!, receipt, said };
}

describe("said rows from the receipt route (brief 042 item 5)", () => {
  it("a matching transcript writes one said row for the note, on the line's turn", async () => {
    const t = await line();
    await t.receipt("transcript", t.p.whisper.text);
    const rows = await t.said();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ turnId: t.p.turnId, noteIds: [t.p.whisper.noteId], momentId: t.p.permit.momentIds[0] });
    expect(rows[0]!.match).not.toBe("none");
  });

  it("a second receipt for the same response writes none", async () => {
    const t = await line();
    await t.receipt("transcript", t.p.whisper.text);
    await t.receipt("transcript", t.p.whisper.text);
    expect(await t.said()).toHaveLength(1);
  });

  it("a transcript without the note's words writes none", async () => {
    const t = await line();
    await t.receipt("transcript", "Sorry, I lost my train of thought there.");
    expect(await t.said()).toEqual([]);
  });

  it("an unadmitted line writes none, whatever was heard", async () => {
    const h = await hero();
    await memoryTick(h.ctx);
    const { proactive } = await h.openLine();
    await h.played(proactive!, "resp_line_1")("transcript", proactive!.whisper.text);
    const rows = (await h.rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter((d) => d.data.kind === "gate");
    expect(rows).toEqual([]);
  });
});
