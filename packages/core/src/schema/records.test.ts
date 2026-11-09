import { describe, expect, it } from "vitest";
import {
  sampleCoreDocs,
  sampleEvidence,
  sampleHead,
  sampleJob,
  sampleLedgerDecision,
  sampleLedgerRequest,
  sampleMemory,
  sampleSession,
  sampleTurn,
  testId,
} from "../testing/samples";
import { EID, Ref, Slice, TS, Zone, tsFromMs } from "./primitives";
import { CORE_DOCS, Evidence, Job, Ledger, Memory, Session, Turn } from "./records";
import { type Schema, validate } from "./v";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function expectFail(s: Schema<unknown>, value: unknown, path: string) {
  const result = validate(s, value);
  expect(result.ok, `expected failure at ${path}`).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe("invalidInput");
    expect(result.path).toBe(path);
  }
}

const VALID: [string, Schema<unknown>, () => unknown][] = [
  ["Evidence", Evidence, sampleEvidence],
  ["Memory", Memory, sampleMemory],
  ["Session", Session, sampleSession],
  ["Turn", Turn, sampleTurn],
  ["Job", Job, sampleJob],
  ["Ledger decision", Ledger, sampleLedgerDecision],
  ["Ledger request", Ledger, sampleLedgerRequest],
  ["core/epoch", CORE_DOCS.epoch, () => sampleCoreDocs().epoch],
  ["core/state", CORE_DOCS.state, () => sampleCoreDocs().state],
  ["core/counters", CORE_DOCS.counters, () => sampleCoreDocs().counters],
  ["core/rules", CORE_DOCS.rules, () => sampleCoreDocs().rules],
  ["core/bundle", CORE_DOCS.bundle, () => sampleCoreDocs().bundle],
];

describe("valid record returns unchanged", () => {
  it.each(VALID)("%s", (_name, s, build) => {
    const input = deepFreeze(build());
    const copy = structuredClone(input);
    const result = validate(s, input);
    expect(result).toEqual({ ok: true, value: copy });
    if (result.ok) expect(result.value).toBe(input);
  });

  it("core/bundle with a compiled Head", () => {
    const bundle = { ...sampleCoreDocs().bundle, state: "clean", bundleRev: 1, head: sampleHead(), headHash: "a".repeat(64) };
    expect(validate(CORE_DOCS.bundle, bundle).ok).toBe(true);
  });
});

describe("unknown key", () => {
  it("at the top level", () => expectFail(Evidence, { ...sampleEvidence(), extra: 1 }, "$.extra"));
  it("in a nested object", () => {
    const e = sampleEvidence();
    expectFail(Evidence, { ...e, fieldSlices: [{ ...e.fieldSlices[0], note: "x" }] }, "$.fieldSlices[0].note");
  });
  it("in a tagged union variant", () =>
    expectFail(Evidence, { ...sampleEvidence(), text: { kind: "inline", text: "a", mime: "text/plain" } }, "$.text.mime"));
  it("in Memory args (closed per predicate)", () =>
    expectFail(Memory, { ...sampleMemory(), args: { topic: "home", label: null, extra: true } }, "$.args.extra"));
  it("in a Ledger payload (closed per kind)", () => {
    const e = sampleLedgerDecision();
    expectFail(Ledger, { ...e, payload: { ...e.payload, why: "x" } }, "$.payload.why");
  });
  it("does not modify the input", () => {
    const input = deepFreeze({ ...sampleTurn(), extra: 1 });
    const copy = structuredClone(input);
    validate(Turn, input);
    expect(input).toEqual(copy);
  });
});

describe("each bound", () => {
  it("sN: string longer than its bound", () => {
    expectFail(Turn, { ...sampleTurn(), text: "x".repeat(8193) }, "$.text");
    expect(validate(Turn, { ...sampleTurn(), text: "x".repeat(8192) }).ok).toBe(true);
  });
  it("sN counts UTF-16 code units", () => {
    // 4,097 astral characters are 8,194 code units.
    expectFail(Turn, { ...sampleTurn(), text: "😀".repeat(4097) }, "$.text");
  });
  it("A<T,n>: array above its upper bound", () =>
    expectFail(Session, { ...sampleSession(), registeredCallIds: ["a", "b", "c", "d", "e"] }, "$.registeredCallIds"));
  it("[1..n]: array below its lower bound", () => expectFail(Evidence, { ...sampleEvidence(), fieldSlices: [] }, "$.fieldSlices"));
  it("number NaN and Infinity", () => {
    expectFail(Turn, { ...sampleTurn(), uncertainSpeaker: Number.NaN }, "$.uncertainSpeaker");
    expectFail(Turn, { ...sampleTurn(), uncertainSpeaker: Number.POSITIVE_INFINITY }, "$.uncertainSpeaker");
    expectFail(Memory, { ...sampleMemory(), value: { kind: "number", num: Number.NEGATIVE_INFINITY, unit: "count" }, args: { topic: "home", label: null } }, "$.value.num");
  });
  it("i: negative, fractional, or above 2^53-1", () => {
    expectFail(Turn, { ...sampleTurn(), seq: -1 }, "$.seq");
    expectFail(Turn, { ...sampleTurn(), seq: 1.5 }, "$.seq");
    expectFail(Turn, { ...sampleTurn(), seq: Number.MAX_SAFE_INTEGER + 1 }, "$.seq");
    expect(validate(Turn, { ...sampleTurn(), seq: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });
  it("i>=1: rev 0 fails", () => expectFail(Turn, { ...sampleTurn(), rev: 0 }, "$.rev"));
  it("Signed: outside ±(2^53-1)", () => {
    const money = (amountMinor: number) => ({ ...sampleMemory(), value: { kind: "money", amountMinor, currency: "USD" } });
    expect(validate(Memory, money(-Number.MAX_SAFE_INTEGER)).ok).toBe(true);
    expectFail(Memory, money(-Number.MAX_SAFE_INTEGER - 2), "$.value.amountMinor");
  });
  it("int[a,b]: gravity 4 fails, 3 passes", () => {
    expectFail(Memory, { ...sampleMemory(), gravity: 4 }, "$.gravity");
    expect(validate(Memory, { ...sampleMemory(), gravity: 3 }).ok).toBe(true);
  });
  it("number[0,1]: uncertainSpeaker above 1", () => expectFail(Turn, { ...sampleTurn(), uncertainSpeaker: 1.01 }, "$.uncertainSpeaker"));
  it("negative zero has no JSON form and is rejected (found by the round-trip property)", () => {
    expectFail(Turn, { ...sampleTurn(), uncertainSpeaker: -0 }, "$.uncertainSpeaker");
    expectFail(Turn, { ...sampleTurn(), seq: -0 }, "$.seq");
    expect(validate(Turn, { ...sampleTurn(), uncertainSpeaker: 0 }).ok).toBe(true);
  });
  it("enum value not in the contract", () => expectFail(Memory, { ...sampleMemory(), status: "pending" }, "$.status"));
  it("union tag not in the contract", () => expectFail(Memory, { ...sampleMemory(), when: { kind: "later" } }, "$.when.kind"));
  it("wrong type", () => {
    expectFail(Turn, { ...sampleTurn(), final: "true" }, "$.final");
    expectFail(Turn, [], "$");
    expectFail(Turn, null, "$");
  });
  it("ID: wrong length or alphabet", () => {
    expectFail(Turn, { ...sampleTurn(), sessionId: "short" }, "$.sessionId");
    expectFail(Turn, { ...sampleTurn(), sessionId: `${"a".repeat(42)}=` }, "$.sessionId");
  });
  it("Hash: uppercase hex fails", () =>
    expectFail(Slice, { ...sampleEvidence().fieldSlices[0], contentHash: "A".repeat(64) }, "$.contentHash"));
  it("TS: not RFC3339 UTC, or not a real instant", () => {
    expect(validate(TS, "2026-11-03T12:00:00.000Z").ok).toBe(true);
    expectFail(TS, "2026-11-03T12:00:00Z", "$");
    expectFail(TS, "2026-02-30T00:00:00.000Z", "$");
    expect(tsFromMs(0)).toBe("1970-01-01T00:00:00.000Z");
  });
  it("Zone: unknown IANA name", () => {
    expect(validate(Zone, "America/Chicago").ok).toBe(true);
    expectFail(Zone, "Mars/Olympus", "$");
  });
  it("Ref: self only for entity", () => {
    expect(validate(Ref, { type: "entity", id: "self", rev: 0 }).ok).toBe(true);
    expectFail(Ref, { type: "memory", id: "self", rev: 0 }, "$.id");
    expect(validate(Ref, { type: "turn", id: testId("t"), parentId: testId("s"), rev: 1 }).ok).toBe(true);
    expect(validate(Ref, { type: "chunk", id: "000001", parentId: testId("e"), rev: 1 }).ok).toBe(true);
  });
  it("EID accepts self", () => expect(validate(EID, "self").ok).toBe(true));
  it("Slice: start after end, or only one of start/end null", () => {
    const s = sampleEvidence().fieldSlices[0]!;
    expectFail(Slice, { ...s, start: 6, end: 5 }, "$.end");
    expectFail(Slice, { ...s, start: null }, "$.end");
    expect(validate(Slice, { ...s, start: null, end: null }).ok).toBe(true);
  });
  it("Memory: value kind, enum code and kind map follow the predicate", () => {
    expectFail(Memory, { ...sampleMemory(), predicate: "identity.name", args: {} , value: { kind: "number", num: 1, unit: "none" } }, "$.value.kind");
    expectFail(Memory, { ...sampleMemory(), predicate: "person.life", args: { detail: null }, value: { kind: "enum", code: "asleep" } }, "$.value.code");
    expectFail(Memory, { ...sampleMemory(), predicate: "identity.name", args: {}, kind: "preference" }, "$.kind");
    expectFail(Memory, { ...sampleMemory(), predicate: "goal", kind: "goal", args: {} }, "$.args.domain");
  });
  it("core/state: worldClock is set exactly when clockMode is fixture", () => {
    const state = sampleCoreDocs().state;
    expectFail(CORE_DOCS.state, { ...state, worldClock: state.nextNightAt }, "$.worldClock");
    expect(validate(CORE_DOCS.state, { ...state, clockMode: "fixture", worldClock: state.nextNightAt }).ok).toBe(true);
  });
  it("Head: exactly ten sections, tokenCount at most 3500", () => {
    const bundle = sampleCoreDocs().bundle;
    const head = sampleHead();
    expectFail(CORE_DOCS.bundle, { ...bundle, head: { ...head, sections: head.sections.slice(1) } }, "$.head.sections");
    expectFail(CORE_DOCS.bundle, { ...bundle, head: { ...head, tokenCount: 3501 } }, "$.head.tokenCount");
  });
  it("Ledger payload follows the entry kind", () => {
    const e = sampleLedgerRequest();
    expectFail(Ledger, { ...e, kind: "usage" }, "$.payload.route");
  });
  it("Job payload: unknown variant", () => expectFail(Job, { ...sampleJob(), payload: { kind: "other" } }, "$.payload.kind"));
});

describe("T? null vs absent", () => {
  it("a T? key may hold null", () => expect(validate(Turn, { ...sampleTurn(), text: null }).ok).toBe(true));
  it("a T? key that is absent fails", () => {
    const { audibleEndAt: _drop, ...rest } = sampleTurn();
    expectFail(Turn, rest, "$.audibleEndAt");
  });
  it("a T? key set to undefined fails", () => expectFail(Turn, { ...sampleTurn(), audibleEndAt: undefined }, "$.audibleEndAt"));
  it("a non-nullable key set to null fails", () => expectFail(Turn, { ...sampleTurn(), committedAt: null }, "$.committedAt"));
  it("a non-nullable key that is absent fails", () => {
    const { seq: _drop, ...rest } = sampleTurn();
    expectFail(Turn, rest, "$.seq");
  });
  it("nullable Args keys are required too", () =>
    expectFail(Memory, { ...sampleMemory(), args: { topic: "home" } }, "$.args.label"));
});
