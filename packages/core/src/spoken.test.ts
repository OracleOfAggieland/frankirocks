import { describe, expect, it } from "vitest";
import type { Memory } from "./schema/records";
import { spokenGrade } from "./spoken";
import { memRef, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");

function grade(memory: Partial<Memory> = {}, stage: "speech" | "read" = "read") {
  const m = sampleMemory(memory);
  const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, sampleEvidence()]] });
  return spokenGrade({ ref: memRef(MID), row: m }, sampleEC({ stage }), s);
}

describe("spokenGrade", () => {
  it("passes an active, open, S0 or S1, U/C/O Memory", () => {
    for (const sens of ["S0", "S1"] as const) {
      for (const sourceClass of ["U", "C", "O"] as const) expect(grade({ sens, sourceClass })).toEqual({ allow: true, reason: "ok" });
    }
  });

  it("evaluates eligibility at stage project, whatever stage the caller passes", () => {
    expect(grade({ sourceClass: "T" }, "read").reason).toBe("authority");
  });

  it("fails S2", () => expect(grade({ sens: "S2" })).toEqual({ allow: false, reason: "sensitivity" }));
  it("fails never_outbound flow", () => expect(grade({ flow: "never_outbound" }).reason).toBe("flow"));
  it.each(["history", "alleged", "scheduled", "wrong", "retracted"] as const)("fails status %s", (status) => {
    expect(grade({ status }).allow).toBe(false);
  });
  it.each(["T", "M"] as const)("fails class %s", (sourceClass) => expect(grade({ sourceClass }).allow).toBe(false));
  it("carries an eligibility denial through", () => expect(grade({ dirty: true }).reason).toBe("dirty"));

  it("denies Evidence rows and invalid input", () => {
    const e = sampleEvidence();
    const s = sampleSnapshot({ evidence: [[EID, e]] });
    expect(spokenGrade({ ref: { collection: "evidence", id: EID, parentId: null, rev: 1 }, row: e }, sampleEC(), s).allow).toBe(false);
    expect(spokenGrade(null as never, sampleEC(), s)).toEqual({ allow: false, reason: "ineligible" });
  });
});
