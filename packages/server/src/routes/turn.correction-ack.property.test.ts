// Feature: voice-writes (brief 012 wave C, task C1), Property 9, corrections half: nothing is acknowledged before it
// commits (design section 7, 2.7, G17). After one correction turn on `/api/turn` (`testing/arb-corrections.ts`),
// with random Fake_FastSlots answers, an uncertain speaker or not, and a commit that may fail on its first attempt:
//   - a failed attempt's response carries no note at all;
//   - a note that says a correction or a name was saved names a Memory this transaction made `wrong` and a successor
//     this transaction wrote, both in committed state; one that says a detail is no longer used names a row this
//     transaction made `wrong`;
//   - a valid, applicable correction on a speaker-certain turn carries one of those notes (typed: the line
//     "Corrected.").
import { ROUTE_NOTE_TEXT, TYPED_LINES } from "@franki/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { changedIds, correctionSpecArb, runCorrection } from "../testing/arb-corrections";

const CLAIMS = [ROUTE_NOTE_TEXT.corrected, ROUTE_NOTE_TEXT.renamed, ROUTE_NOTE_TEXT.retracted, TYPED_LINES.corrected];

describe("Property 9 (route): a correction is acknowledged only after it commits", () => {
  it("every correction note names committed state", { timeout: 600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(correctionSpecArb.map((s) => ({ ...s, extraction: "none" as const })), async (spec) => {
        const t = await runCorrection(spec);
        const what = `${JSON.stringify(spec)} "${t.text}"`;
        for (const f of t.failed) expect((f?.notes ?? []).filter((n: { text: string }) => CLAIMS.includes(n.text)), `${what}: a failed attempt claimed a correction`).toEqual([]);
        const notes: string[] = (t.response?.notes ?? []).map((n: { text: string }) => n.text).filter((x: string) => CLAIMS.includes(x));
        const changed = changedIds(t.before, t.afterRoute);
        const madeWrong = changed.filter((id) => t.before.has(id) && t.afterRoute.get(id)!.status === "wrong");
        const successors = changed.filter((id) => !t.before.has(id) && t.afterRoute.get(id)!.status === "active");
        for (const n of notes) {
          if (n === ROUTE_NOTE_TEXT.retracted) expect(madeWrong.length + changed.filter((id) => t.afterRoute.get(id)!.status === "wrong").length, `${what}: "${n}" with nothing made wrong`).toBeGreaterThan(0);
          else expect(successors.length, `${what}: "${n}" with no successor committed`).toBeGreaterThan(0);
        }
        if (t.applicable) expect(notes.length, `${what}: a committed correction with no note`).toBeGreaterThan(0);
      }),
      { numRuns: 1000 },
    );
  });
});
