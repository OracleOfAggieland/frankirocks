/** The Gate's ledger rows, the "why" reader and the decision defaults read (brief 024). */
import { describe, expect, it } from "vitest";
import { Ledger } from "../schema/records";
import { validate } from "../schema/v";
import { sampleLedgerDecision, sampleLedgerDecisionWithAdmission, sampleLedgerGate, testId } from "../testing/samples";
import { decisionFields, gateOutcome, gateRowPayload, saidRowPayload, whyBroughtUp, answerFrom } from "./ledger";
import type { GateResult } from "./types";

const r = (o: Partial<GateResult>): GateResult => ({ verdict: "say", form: "item", render: "free", carveOut: null, mustSay: null, fixedLine: null, reasons: ["ok"], ...o });
const at = { candidateId: testId("cand"), refs: [], noteIds: [testId("note")], momentId: null, sessionId: testId("s"), turnId: testId("t"), audience: "private" as const, permitKind: null };

describe("gate ledger rows", () => {
  it("maps each verdict to its outcome, and writes nothing for a say until the transcript", () => {
    expect(gateOutcome(r({}))).toBeNull();
    expect(gateOutcome(r({ verdict: "card" }))).toBe("steered");
    expect(gateOutcome(r({ verdict: "silent", form: "use", reasons: ["useOnly"] }))).toBe("steered");
    expect(gateOutcome(r({ verdict: "hold", reasons: ["sensitivity"] }))).toBe("held");
    expect(gateOutcome(r({ verdict: "silent", reasons: ["quiet"] }))).toBe("declined");
    expect(gateOutcome(r({ verdict: "silent", reasons: ["rulesUnavailable"] }))).toBe("blocked");
    expect(gateRowPayload(r({}), at)).toBeNull();
  });

  it("stores IDs and codes only, and the rows validate", () => {
    const held = gateRowPayload(r({ verdict: "hold", form: null, render: null, reasons: ["ceiling", "sensitivity"] }), at)!;
    expect(held).toMatchObject({ outcome: "held", reasonCodes: ["ceiling", "sensitivity"], match: null });
    const said = saidRowPayload(r({}), at, "idTagged")!;
    expect(said).toMatchObject({ outcome: "said", match: "idTagged" });
    expect(saidRowPayload(r({}), at, "none")).toBeNull();
    for (const payload of [held, said]) expect(validate(Ledger, { ...sampleLedgerGate(), payload }).ok).toBe(true);
    // No words: a free-text field is refused by the closed schema.
    expect(validate(Ledger, { ...sampleLedgerGate(), payload: { ...said, text: "Your mom's biopsy" } }).ok).toBe(false);
  });

  it("answers \"why did you bring that up\" from the said row, and nothing without one", () => {
    const rows = [
      { id: testId("e1"), entry: sampleLedgerGate({ outcome: "held", reasonCodes: ["sensitivity"] }) },
      { id: testId("e2"), entry: sampleLedgerGate({ reasonCodes: ["ok", "mustSay"] }) },
    ];
    expect(whyBroughtUp(testId("note"), rows)).toMatchObject({ entryId: testId("e2"), reasonCodes: ["ok", "mustSay"] });
    expect(whyBroughtUp(testId("mem"), rows)?.entryId).toBe(testId("e2"));
    expect(whyBroughtUp(testId("other"), rows)).toBeNull();
    expect(whyBroughtUp(testId("note"), [rows[0]!])).toBeNull();
    expect(answerFrom(testId("note"), [rows[0]!], ["held"])?.reasonCodes).toEqual(["sensitivity"]);
  });
});

describe("decision admission fields", () => {
  it("reads a decision written before the fields with nulls, and a new one as stored", () => {
    const old = sampleLedgerDecision();
    expect(validate(Ledger, old).ok).toBe(true);
    if (old.kind !== "decision") throw new Error("sample");
    expect(decisionFields(old.payload)).toMatchObject({ issuer: null, permitKind: null, judge: null, falseHold: null, purpose: "answer" });
    const neu = sampleLedgerDecisionWithAdmission();
    expect(validate(Ledger, neu).ok).toBe(true);
    if (neu.kind !== "decision") throw new Error("sample");
    expect(decisionFields(neu.payload)).toMatchObject({ issuer: "admissionSeam", permitKind: "slowOrdinary", judge: "O", falseHold: false });
  });

  it("refuses a half-written new shape", () => {
    const d = sampleLedgerDecision();
    expect(validate(Ledger, { ...d, payload: { ...d.payload, issuer: "admissionSeam" } }).ok).toBe(false);
  });
});
