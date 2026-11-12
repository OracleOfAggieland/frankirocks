/**
 * Brief 030 part A: the Lab reads the Gate's rows. Each held, steered, declined or blocked Gate row counts once by
 * its ID under its own number, beside the decision rows; `said` rows count toward none of these.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { LAB_UNCOUNTED, labView } from "./memory-views";
import type { Ledger } from "./schema/records";
import { buildStore, storeCase } from "./testing/memory-store-arb";

const gateRow = (outcome: "held" | "steered" | "declined" | "blocked" | "said", uid: string): Ledger =>
  ({
    v: 1,
    uid,
    rev: 1,
    kind: "gate",
    state: "complete",
    payload: { outcome, candidateId: "c".repeat(43), refs: [], noteIds: [], momentId: null, sessionId: null, turnId: "t".repeat(43), verdict: "hold", form: null, render: null, carveOut: null, reasonCodes: [], audience: "private", permitKind: null, match: null },
  }) as unknown as Ledger;

describe("the Lab counts the Gate's rows", () => {
  it("held, steered, declined and blocked rows each count once; said rows and other owners' rows don't", () => {
    const [k] = fc.sample(storeCase(), { numRuns: 1, seed: 7 });
    const s = buildStore(k!);
    const base = labView(s.lab);
    const uid = s.lab.ec.uid;
    const gates = [
      { id: "g-held", entry: gateRow("held", uid) },
      { id: "g-held", entry: gateRow("held", uid) },
      { id: "g-steered", entry: gateRow("steered", uid) },
      { id: "g-declined-1", entry: gateRow("declined", uid) },
      { id: "g-declined-2", entry: gateRow("declined", uid) },
      { id: "g-blocked", entry: gateRow("blocked", uid) },
      { id: "g-said", entry: gateRow("said", uid) },
      { id: "g-other", entry: gateRow("held", "someone-else") },
    ];
    const lab = labView({ ...s.lab, gates });
    expect(lab.held).toBe(base.held + 1);
    expect(lab.steered).toBe(1);
    expect(lab.declined).toBe(2);
    expect(lab.blocked).toBe(base.blocked + 1);
    expect(lab.delivered).toBe(base.delivered);
    expect(LAB_UNCOUNTED).not.toContain("steered");
    expect(LAB_UNCOUNTED).not.toContain("declined");
    expect(lab.limits).not.toContain("uncounted:steered");
  });
});
