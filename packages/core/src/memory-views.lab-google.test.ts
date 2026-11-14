// Brief 049 ruling 22: the Lab counts the sample visit's mail, never a connected Google account's.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { labView } from "./memory-views";
import { buildStore, storeCase } from "./testing/memory-store-arb";
import { sampleEvidence } from "./testing/samples";

describe("the Lab's mail count leaves out a connected Google account's mail", () => {
  it("adding real Gmail rows changes no count", () => {
    const [k] = fc.sample(storeCase(), { numRuns: 1, seed: 11 });
    const s = buildStore(k!);
    const base = labView(s.lab);
    const uid = s.lab.ec.uid;
    const real = [1, 2, 3].map((n) => ({ id: `gmail-row-${n}`, evidence: { ...sampleEvidence({ kind: "message", status: "retained" }), uid, source: "gmail" as const, connectorId: "c".repeat(43) } }));
    const lab = labView({ ...s.lab, evidence: [...s.lab.evidence, ...real] });
    expect(lab).toEqual(base);
    // A fixture message with no connector still counts.
    const fixture = { id: "fixture-row", evidence: { ...sampleEvidence({ kind: "message", status: "retained" }), uid } };
    expect(labView({ ...s.lab, evidence: [...s.lab.evidence, fixture] }).readEmails).toBe(base.readEmails + 1);
  });
});
