import { describe, expect, it } from "vitest";
import { type DocRef, type SnapshotRow, eligible } from "../eligible";
import { memRef, sampleEC, sampleSnapshot } from "../testing/eligibility";
import { sampleBlock, sampleEvidence, sampleMemory, sampleOverlay, testId } from "../testing/samples";

const M = testId("m1");
const ROOT = testId("root");
const memory = sampleMemory({ topicIds: [testId("topic")] });
const c = sampleEC();

function withRows(blocks = [sampleBlock()], extra: [DocRef, SnapshotRow][] = []) {
  const s = sampleSnapshot({ memories: [[M, memory]], evidence: [[testId("ev"), sampleEvidence()]] });
  return { ...s, blocks, refs: [...s.refs, ...extra.map((e) => e[0])], rows: [...s.rows, ...extra.map((e) => e[1])] };
}

describe("forget blocks and overlays in eligible (brief 021)", () => {
  it("allows the row with no block", () => {
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([])).allow).toBe(true);
  });

  it.each(["active", "review"] as const)("a root block in state %s denies a row carrying its root", (state) => {
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([sampleBlock({ rootKey: ROOT, state })]))).toEqual({ allow: false, reason: "blocked" });
  });

  it("a root block on another root denies nothing", () => {
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([sampleBlock({ rootKey: testId("other") })])).allow).toBe(true);
  });

  it("a semantic block denies only the same subject, predicate and slot key", () => {
    const same = sampleBlock({ kind: "semantic", rootKey: null, entityId: memory.subjectId, predicate: memory.predicate, key: memory.key });
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([same])).reason).toBe("blocked");
    const otherKey = { ...same, key: testId("otherkey") };
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([otherKey])).allow).toBe(true);
  });

  it("a new U Memory written after a semantic block, on unblocked roots, passes it", () => {
    const block = sampleBlock({ kind: "semantic", rootKey: null, entityId: memory.subjectId, predicate: memory.predicate, key: memory.key, createdAt: "2026-11-03T11:00:00.000Z" });
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([block])).allow).toBe(true);
    const rooted = [block, sampleBlock({ rootKey: ROOT, key: testId("k2") })];
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows(rooted)).allow).toBe(false);
    const told = { ...memory, sourceClass: "O" as const };
    const base = withRows([block]);
    const s = { ...base, rows: [told, ...base.rows.slice(1)] };
    expect(eligible({ ref: memRef(M), row: told }, c, s).reason).toBe("blocked");
  });

  it("a topic block denies a Memory in its topic", () => {
    const block = sampleBlock({ kind: "topic", rootKey: null, topicId: testId("topic") });
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([block])).reason).toBe("blocked");
  });

  it("a negative assertion restrains and denies no read", () => {
    const block = sampleBlock({ kind: "negativeAssertion", rootKey: ROOT });
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([block])).allow).toBe(true);
  });

  it("a provider block denies Evidence with its key, except the revision it allows", () => {
    const E = testId("ev2");
    const ev = sampleEvidence({ providerKey: testId("prov") });
    const s = sampleSnapshot({ evidence: [[E, ev]] });
    const ref: DocRef = { collection: "evidence", id: E, parentId: null, rev: 1 };
    const block = sampleBlock({ kind: "provider", rootKey: null, providerKey: testId("prov") });
    expect(eligible({ ref, row: ev }, c, { ...s, blocks: [block] }).reason).toBe("blocked");
    expect(eligible({ ref, row: ev }, c, { ...s, blocks: [{ ...block, allowedEvidenceId: E }] }).allow).toBe(true);
  });

  it.each(["active", "materialized"] as const)("an overlay in state %s denies the row it names", (state) => {
    const O = testId("ov");
    const overlay = sampleOverlay({ targetRef: { type: "memory", id: M, rev: 1 }, state });
    const s = withRows([], [[{ collection: "overlays", id: O, parentId: null, rev: 1 }, overlay]]);
    expect(eligible({ ref: memRef(M), row: memory }, c, s)).toEqual({ allow: false, reason: "blocked" });
  });

  it("an overlay row is never itself an eligible row", () => {
    const O = testId("ov");
    const overlay = sampleOverlay();
    const ref: DocRef = { collection: "overlays", id: O, parentId: null, rev: 1 };
    const s = withRows([], [[ref, overlay]]);
    expect(eligible({ ref, row: overlay as never }, c, s).reason).toBe("ineligible");
  });

  it("a malformed block fails the whole snapshot closed", () => {
    const bad = { ...sampleBlock(), kind: "everything" } as never;
    expect(eligible({ ref: memRef(M), row: memory }, c, withRows([bad])).reason).toBe("ineligible");
  });
});
