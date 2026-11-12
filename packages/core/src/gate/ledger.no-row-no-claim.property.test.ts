/**
 * No row, no claim (brief 024; spec §6 "'Why did you bring that up?' reads the ledger ... No row, no claim"). 1,000
 * runs.
 *   FOR ALL ledgers (any valid entries of every kind, with Gate rows whose IDs come from a small pool) and any ID,
 *   the "why" reader answers only when a complete `said` Gate row names that ID, and then from that row: its entry
 *   ID, outcome and reason codes. With no such row it returns null.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Ledger } from "../schema/records";
import { arbitraryFor } from "../testing/arbitrary";
import { sampleLedgerGate, testId } from "../testing/samples";
import { GATE_OUTCOMES } from "./reasons";
import { whyBroughtUp } from "./ledger";

const POOL = [testId("p1"), testId("p2"), testId("p3")];
const pick = fc.constantFrom(...POOL);

/** Gate rows with pooled IDs, any outcome and state, so "said" rows naming the asked ID are common. */
const gateEntry = fc
  .record({
    state: fc.constantFrom("pending", "complete", "failed", "blocked" as const),
    outcome: fc.constantFrom(...GATE_OUTCOMES),
    candidateId: pick,
    noteIds: fc.subarray(POOL, { maxLength: 2 }),
    momentId: fc.option(pick, { nil: null }),
    refId: fc.option(pick, { nil: null }),
    at: fc.constantFrom("2026-11-12T17:00:00.000Z", "2026-11-12T17:00:01.000Z"),
    reasonCodes: fc.subarray(["ok", "asked", "mustSay"] as const, { minLength: 1 }),
  })
  .map((g) => {
    const base = sampleLedgerGate({
      outcome: g.outcome,
      candidateId: g.candidateId,
      noteIds: g.noteIds,
      momentId: g.momentId,
      refs: g.refId === null ? [] : [{ type: "memory", id: g.refId, rev: 1 }],
      reasonCodes: [...g.reasonCodes],
    });
    return { ...base, state: g.state, at: g.at } as Ledger;
  });
const entry: fc.Arbitrary<Ledger> = fc.oneof(arbitraryFor(Ledger) as fc.Arbitrary<Ledger>, gateEntry, gateEntry);
const rows = fc.uniqueArray(fc.tuple(fc.constantFrom(...POOL.map((_, i) => testId(`row${i}`)), testId("row9")), entry).map(([id, e]) => ({ id, entry: e })), { maxLength: 6, selector: (r) => r.id });

describe("ledger: no row, no claim", () => {
  it("answers \"why\" only from a said row naming the ID", () => {
    fc.assert(
      fc.property(rows, fc.oneof(pick, fc.constant(testId("unseen")), fc.constant("")), (ledger, id) => {
        const a = whyBroughtUp(id, ledger);
        const backing = ledger.filter(
          (r) =>
            r.entry.kind === "gate" &&
            r.entry.state === "complete" &&
            r.entry.payload.outcome === "said" &&
            (r.entry.payload.candidateId === id || r.entry.payload.momentId === id || r.entry.payload.noteIds.includes(id) || r.entry.payload.refs.some((f) => f.id === id)),
        );
        if (backing.length === 0) {
          expect(a).toBeNull();
          return;
        }
        expect(a).not.toBeNull();
        const row = backing.find((r) => r.id === a!.entryId);
        expect(row).toBeDefined();
        expect(a!.outcome).toBe("said");
        if (row!.entry.kind === "gate") expect(a!.reasonCodes).toEqual(row!.entry.payload.reasonCodes);
      }),
      { numRuns: 1000 },
    );
  });
});
