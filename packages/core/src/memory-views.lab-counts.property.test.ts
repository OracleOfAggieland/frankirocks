/**
 * Lab counts are real (brief 020; contracts §6 line 749 "Lab=distinct decisions; guessLinesSpoken=guess-rooted";
 * spec §15 "Lab numbers are real"). 1,000 runs.
 *   FOR ALL store contents, each counted Lab number equals the count of the distinct rows it names: retained message
 *   Evidence (readEmails), live guesses about private things (privateGuesses), complete decisions that accepted a
 *   guess (guessLinesSpoken), complete decisions (delivered), held decisions (held), and decisions with the
 *   `blocked` reason (blocked). A ledger page read twice counts each decision once. Every number not counted is
 *   named in `limits`, so the screen shows it as not counted, never as a zero.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { docRef, eligible } from "./eligible";
import { LAB_UNCOUNTED, labView } from "./memory-views";
import { buildStore, storeCase } from "./testing/memory-store-arb";

describe("memory views: Lab counts are real", () => {
  it("equals the count of the distinct rows each number names", () => {
    fc.assert(
      fc.property(storeCase(), (k) => {
        const s = buildStore(k);
        const lab = labView(s.lab);
        const live = (id: string) => {
          const r = s.rows.find((x) => x.id === id)!;
          // A guess is stored as `alleged`, never current (spec §4), so a live guess is active or alleged (question X-167).
          return (r.memory.status === "active" || r.memory.status === "alleged") && eligible({ ref: docRef("memories", id, r.memory.rev), row: r.memory }, { ...s.ctx.ec, stage: "read" }, s.snapshot).allow;
        };
        const guesses = new Set(s.rows.filter((r) => r.memory.sourceClass === "M" && r.memory.sens !== "S0" && live(r.id)).map((r) => r.id));
        const guessIds = new Set(s.rows.filter((r) => r.memory.sourceClass === "M").map((r) => r.id));
        const distinct = (pred: (e: (typeof s.decisions)[number]["entry"]) => boolean) => new Set(s.decisions.filter((d) => pred(d.entry)).map((d) => d.id)).size;
        const payload = (e: (typeof s.decisions)[number]["entry"]) => (e.kind === "decision" ? e.payload : null);

        expect(lab.readEmails).toBe(new Set(s.evidenceRows.filter((e) => e.evidence.kind === "message" && e.evidence.status === "retained").map((e) => e.id)).size);
        expect(lab.privateGuesses).toBe(guesses.size);
        expect(lab.guessLinesSpoken).toBe(distinct((e) => e.state === "complete" && (payload(e)?.acceptedRefs ?? []).some((r) => r.type === "memory" && guessIds.has(r.id))));
        expect(lab.delivered).toBe(distinct((e) => e.state === "complete"));
        expect(lab.held).toBe(distinct((e) => e.state === "blocked"));
        expect(lab.blocked).toBe(distinct((e) => (payload(e)?.reasonCodes ?? []).includes("blocked")));
        for (const name of LAB_UNCOUNTED) {
          expect(lab[name]).toBe(0);
          expect(lab.limits).toContain(`uncounted:${name}`);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
