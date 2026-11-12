// Brief 042 property 3, "No row, no claim; no match, no row": for any transcript and any note, a said row exists only
// if the transcript matches the note by the matcher's rules, and never twice for one response. Seed recorded in brief
// 042's Outcome.
import type { Ledger } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { noteMatch } from "../ledger/said";
import { paths } from "../store/paths";
import { UID, hero } from "../testing/hero-offer";
import { memoryTick } from "../time/tick";

const FILLER = ["okay", "so", "anyway", "takeout", "dinner", "groceries", "meetings", "nights", "sure", "list"];

describe("property: no row, no claim; no match, no row (brief 042)", () => {
  it("1,000 runs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.constant<"line">("line"),
            fc.array(fc.constantFrom(...FILLER), { minLength: 1, maxLength: 12 }).map((w) => ({ words: w })),
            fc.array(fc.nat(40), { minLength: 1, maxLength: 30 }).map((ix) => ({ pick: ix })),
          ),
          { minLength: 1, maxLength: 3 },
        ),
        async (heardList) => {
          const h = await hero();
          await memoryTick(h.ctx);
          const { proactive } = await h.openLine();
          const p = proactive!;
          const receipt = h.played(p, "resp_line_1");
          await receipt("admitted");
          await receipt("playbackStarted");
          const lineWords = p.whisper.text.split(/\s+/);
          let anyMatch = false;
          for (const x of heardList) {
            const text = x === "line" ? p.whisper.text : "words" in x ? x.words.join(" ") : x.pick.map((i) => lineWords[i % lineWords.length]).join(" ");
            const m = noteMatch({ receipt: { kind: "transcript", responseId: "resp_line_1", momentIds: p.permit.momentIds, noteIds: p.permit.noteIds, text }, note: { noteId: p.whisper.noteId, text: p.whisper.text, momentId: p.permit.momentIds[0]! } });
            // A repeated transcript for one response writes nothing new (the receipt route): the first one is heard.
            if (x === heardList[0] && m !== "none") anyMatch = true;
            await receipt("transcript", text);
          }
          const rows = (await h.rig.store.query<Ledger>(UID, { collection: paths.collection(UID, "ledger"), where: [], orderBy: { field: "__name__", dir: "asc" }, limit: 100 })).filter(
            (d) => d.data.kind === "gate" && (d.data.payload as { outcome: string }).outcome === "said",
          );
          expect(rows).toHaveLength(anyMatch ? 1 : 0);
        },
      ),
      { numRuns: 1000, seed: 42_053 },
    );
  }, 600_000);
});
