/**
 * eligible's clause 5, the read's context (R25.3; design CQ 162; brief 014, S6). A stored row's own policyRev is
 * not compared, but the context must still be at the Snapshot's current epoch and policyRev. Each case holds the
 * row at the current epoch, so only the context can deny it.
 */
import { describe, expect, it } from "vitest";
import { type Dependent, eligible } from "./eligible";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");

function setup() {
  const m = sampleMemory();
  const x: Dependent = { ref: memRef(MID), row: m };
  const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, sampleEvidence()]] });
  return { x, s, c: sampleEC(), docs: sampleCoreDocs() };
}

describe("eligible: the read's context", () => {
  it("allows the setup as given, so each denial below comes from the context", () => {
    const { x, c, s } = setup();
    expect(eligible(x, c, s)).toEqual({ allow: true, reason: "ok" });
  });

  it("denies a context behind the Snapshot's policyRev", () => {
    const { x, c, s, docs } = setup();
    expect(eligible(x, c, { ...s, epoch: { ...docs.epoch, policyRev: docs.epoch.policyRev + 1 } })).toEqual({ allow: false, reason: "freshness" });
  });

  it("denies a context ahead of the Snapshot's policyRev", () => {
    const { x, c, s } = setup();
    expect(eligible(x, { ...c, policyRev: c.policyRev + 1 }, s)).toEqual({ allow: false, reason: "freshness" });
  });

  it("denies a context and row at an epoch the Snapshot has moved past", () => {
    const { x, c, s, docs } = setup();
    expect(c.epoch).toBe(docs.epoch.epoch);
    expect(eligible(x, c, { ...s, epoch: { ...docs.epoch, epoch: docs.epoch.epoch + 1 } })).toEqual({ allow: false, reason: "freshness" });
  });
});
