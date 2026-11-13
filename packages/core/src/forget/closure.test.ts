import { describe, expect, it } from "vitest";
import { sampleEvidence, testId } from "../testing/samples";
import { codeSurvivor } from "./closure";
import { planPurge, purgedValue } from "./purge";
import { forgetAck, resumeDecision } from "./resume";
import { sanitizeText } from "./sanitize";
import { evidenceOf, forgetHasher as hasher, memoryOn } from "./testing/arb-forget";

const OLD = testId("old");
const NEW = testId("new");
const TEXT = "Danny loves gumbo. I run 5 miles every day.";
const KEPT = "I run 5 miles every day.";
const stamps = { epoch: 3, policyRev: 2 };
const now = "2026-11-13T12:00:00.000Z";

function world() {
  const rs = TEXT.indexOf("Danny loves gumbo.");
  const out = sanitizeText(TEXT, [{ start: rs, end: rs + "Danny loves gumbo.".length }], []);
  const map = out.pieces.map((p) => ({ oldField: "text" as const, oldStart: p.oldStart, oldEnd: p.oldEnd, newField: "text" as const, newStart: p.newStart, newEnd: p.newEnd }));
  const original = { ...evidenceOf(OLD, TEXT, hasher), status: "blocked" as const };
  const sanitized = { ...evidenceOf(NEW, out.text, hasher), sanitizedFrom: OLD, sanitizeMap: map };
  return { original, sanitized };
}

describe("codeSurvivor (ruling 4)", () => {
  const { original, sanitized } = world();
  const ks = TEXT.indexOf(KEPT);
  const typed = (over: Partial<ReturnType<typeof memoryOn>>) => ({ ...memoryOn(OLD, TEXT, ks, ks + KEPT.length, "run", hasher), subjectId: "self", ...over });
  const sanitizedOf = new Map([[OLD, { eid: NEW, evidence: sanitized }]]);
  const originals = new Map([[OLD, original]]);

  it("keeps a typed self value whose quote survives whole, re-anchored on the sanitized Evidence at the barrier's epoch", () => {
    const m = typed({ value: { kind: "number", num: 5, unit: "mi" } as never });
    const kept = codeSurvivor(m, sanitizedOf, originals, { stamps, now, hasher });
    expect(kept).not.toBeNull();
    expect(kept!.rootSlices[0]!.eid).toBe(NEW);
    expect(kept!.dependsOn).toEqual([`e:${NEW}`]);
    expect(kept!.epoch).toBe(3);
    expect(kept!.dirty).toBe(false);
  });

  it("never keeps free text, another subject, or a value with another dependency", () => {
    expect(codeSurvivor(typed({ value: { kind: "text", text: "runs" } }), sanitizedOf, originals, { stamps, now, hasher })).toBeNull();
    expect(codeSurvivor(typed({ value: { kind: "boolean", bool: true }, subjectId: testId("danny") }), sanitizedOf, originals, { stamps, now, hasher })).toBeNull();
    expect(codeSurvivor(typed({ value: { kind: "boolean", bool: true }, dependsOn: [`e:${OLD}`, `m:${testId("other")}`] }), sanitizedOf, originals, { stamps, now, hasher })).toBeNull();
  });

  it("never keeps a quote that was cut", () => {
    const rs = TEXT.indexOf("Danny");
    const m = { ...memoryOn(OLD, TEXT, rs, rs + 18, "cut", hasher), subjectId: "self", value: { kind: "boolean" as const, bool: true } };
    expect(codeSurvivor(m, sanitizedOf, originals, { stamps, now, hasher })).toBeNull();
  });
});

describe("forgetAck (ruling 8)", () => {
  const base = { scopePending: false, pendingRuleIds: [], withdrawnCount: 0, noneCleared: false };
  it("asks when the scope is pending, before anything else", () => {
    expect(forgetAck({ ...base, scopePending: true, pendingRuleIds: [testId("r")], withdrawnCount: 2 })).toEqual({ kind: "ask", reason: "ambiguous" });
  });
  it("names a pending safety rule, then offers a retell, then says gone", () => {
    expect(forgetAck({ ...base, pendingRuleIds: [testId("r")], withdrawnCount: 2 }).kind).toBe("goneExceptRule");
    expect(forgetAck({ ...base, withdrawnCount: 2 })).toEqual({ kind: "offerRetell", withdrawnCount: 2, askAllergies: false });
    expect(forgetAck({ ...base, noneCleared: true })).toEqual({ kind: "gone", askAllergies: true });
  });
});

describe("resumeDecision (ruling 6)", () => {
  const all = { barrierIsThisOp: true, callsClosed: true, closureFinished: true, survivorsRestamped: true, queueEmpty: true };
  it("clears only when every condition holds, and promotes a queued op instead of clearing", () => {
    expect(resumeDecision(all)).toEqual({ kind: "clear" });
    expect(resumeDecision({ ...all, queueEmpty: false })).toEqual({ kind: "promote" });
  });
  it.each([
    ["barrierIsThisOp", "barrier"],
    ["callsClosed", "calls"],
    ["closureFinished", "closure"],
    ["survivorsRestamped", "closure"],
  ] as const)("waits when %s is false", (k, reason) => {
    expect(resumeDecision({ ...all, [k]: false })).toEqual({ kind: "wait", reason });
  });
});

describe("planPurge (ruling 9)", () => {
  const { original, sanitized } = world();
  const target = { ...memoryOn(OLD, TEXT, 0, 18, "t", hasher, "blocked"), value: { kind: "text" as const, text: "gumbo" } };
  const survivor = memoryOn(NEW, sanitized.text!.kind === "inline" ? sanitized.text!.text : "", 0, 4, "s", hasher);

  it("removes blocked Evidence text and a blocked Memory's value, and never touches retained rows or survivors", () => {
    const writes = planPurge({
      now,
      blockedEids: [OLD, NEW],
      memoryIds: [testId("t"), testId("s")],
      requestTurns: [],
      evidence: [
        { id: OLD, evidence: original },
        { id: NEW, evidence: sanitized },
      ],
      memories: [
        { id: testId("t"), memory: target },
        { id: testId("s"), memory: survivor },
      ],
      turns: [],
    });
    expect(writes.map((w) => `${w.collection}/${w.id}`)).toEqual([`evidence/${OLD}`, `memories/${testId("t")}`]);
    const e = writes[0]!.doc as typeof original;
    expect(e.text).toBeNull();
    expect(e.status).toBe("purged");
    expect(e.fieldSlices).toEqual(original.fieldSlices);
    expect((writes[1]!.doc as typeof target).value).toEqual({ kind: "text", text: "" });
  });

  it("is a no-op the second time", () => {
    const purged = { ...sampleEvidence(), text: null, status: "purged" as const };
    expect(planPurge({ now, blockedEids: [OLD], memoryIds: [], requestTurns: [], evidence: [{ id: OLD, evidence: purged }], memories: [], turns: [] })).toEqual([]);
  });

  it("keeps codes, booleans and entities, which are not prose", () => {
    expect(purgedValue({ kind: "enum", code: "x" })).toEqual({ kind: "enum", code: "x" });
    expect(purgedValue({ kind: "money", amountMinor: 1200, currency: "USD" })).toEqual({ kind: "money", amountMinor: 0, currency: "USD" });
  });
});
