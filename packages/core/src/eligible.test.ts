import { describe, expect, it } from "vitest";
import { type Dependent, eligible, parseDep } from "./eligible";
import type { Memory } from "./schema/records";
import { memRef, sampleCoreDocs, sampleEC, sampleEvidence, sampleJob, sampleMemory, sampleSession, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const MID = testId("m1");

function setup(memory: Partial<Memory> = {}) {
  const m = sampleMemory(memory);
  const evidence = sampleEvidence();
  const x: Dependent = { ref: memRef(MID), row: m };
  const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, evidence]] });
  return { x, s, c: sampleEC() };
}

describe("eligible", () => {
  it("allows a clean, current, U-rooted Memory with reason ok", () => {
    const { x, c, s } = setup();
    expect(eligible(x, c, s)).toEqual({ allow: true, reason: "ok" });
  });

  it("is deterministic for identical inputs", () => {
    const { x, c, s } = setup();
    expect(eligible(x, c, s)).toEqual(eligible(structuredClone(x), structuredClone(c), structuredClone(s)));
  });

  describe("tenant", () => {
    it("denies a row of another uid", () => {
      const { c, s } = setup();
      const other = sampleMemory({ uid: "owner-2" });
      expect(eligible({ ref: memRef(MID), row: other }, c, s)).toEqual({ allow: false, reason: "tenant" });
    });
    it("denies a Snapshot of another uid", () => {
      const { x, c, s } = setup();
      expect(eligible(x, c, { ...s, uid: "owner-2" }).reason).toBe("tenant");
    });
  });

  it("freshness: denies an incomplete Snapshot", () => {
    const { x, c, s } = setup();
    expect(eligible(x, c, { ...s, complete: false })).toEqual({ allow: false, reason: "freshness" });
  });

  describe("barrier", () => {
    const barrier = { opId: testId("op"), phase: "fence" as const, startedAt: "2026-11-03T12:00:00.000Z", deadline: "2026-11-03T12:01:00.000Z", queuedOps: [] };
    it("denies every non-maintenance read", () => {
      const { x, c, s } = setup();
      expect(eligible(x, c, { ...s, epoch: { ...s.epoch, barrier } })).toEqual({ allow: false, reason: "barrier" });
    });
    it.each(["speech", "toolReturn", "read"] as const)("denies a matching maintenance read at stage %s", (stage) => {
      const { x, c, s } = setup();
      const maintenance = { ...c, stage, serviceAuthorized: true, maintenanceOpId: barrier.opId, maintenanceTask: "resolve" as const };
      expect(eligible(x, maintenance, { ...s, epoch: { ...s.epoch, barrier } }).reason).toBe("barrier");
    });
  });

  describe("freshness (epoch, policyRev, generation)", () => {
    it("denies when c is not at the current epoch", () => {
      const { x, c, s } = setup();
      expect(eligible(x, { ...c, epoch: 2 }, s).reason).toBe("freshness");
    });
    it("allows a row from an older policyRev when the context is current", () => {
      const { x, c, s } = setup();
      const docs = sampleCoreDocs();
      expect(eligible(x, { ...c, policyRev: 2 }, { ...s, epoch: { ...docs.epoch, policyRev: 2 } })).toEqual({ allow: true, reason: "ok" });
    });
    it("browser: denies when generation differs from localGeneration", () => {
      const { x, c, s } = setup();
      expect(eligible(x, { ...c, execution: "browser", generation: 2 }, s).reason).toBe("freshness");
      expect(eligible(x, { ...c, execution: "browser", generation: 1 }, s).allow).toBe(true);
    });
    it("serverForeground: denies a generation below the Session's", () => {
      const { x, c, s } = setup();
      const session = sampleSession({ generation: 3 });
      expect(eligible(x, { ...c, generation: 2 }, { ...s, session }).reason).toBe("freshness");
      expect(eligible(x, { ...c, generation: 3 }, { ...s, session }).allow).toBe(true);
    });
    it("worker: denies a stale lease token or job generation", () => {
      const { x, c, s } = setup();
      const job = sampleJob({ status: "leased", leaseToken: testId("lease"), generation: 4 });
      const worker = { ...c, execution: "worker" as const, leaseToken: testId("lease"), jobGeneration: 4 };
      expect(eligible(x, worker, { ...s, job }).allow).toBe(true);
      expect(eligible(x, { ...worker, leaseToken: testId("other") }, { ...s, job }).reason).toBe("freshness");
      expect(eligible(x, { ...worker, jobGeneration: 3 }, { ...s, job }).reason).toBe("freshness");
      expect(eligible(x, worker, s).reason).toBe("freshness");
    });
  });

  describe("dirty", () => {
    it("denies a dirty row", () => {
      const { x, c, s } = setup();
      expect(eligible({ ...x, row: { ...x.row, dirty: true } }, c, s)).toEqual({ allow: false, reason: "dirty" });
    });
    it("denies a row with incomplete dependencies", () => {
      const { x, c, s } = setup();
      expect(eligible({ ...x, row: { ...x.row, dependenciesComplete: false } }, c, s).reason).toBe("dirty");
    });
    it("denies a row whose dependency is dirty", () => {
      const m = sampleMemory();
      const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, sampleEvidence({ dirty: true })]] });
      expect(eligible({ ref: memRef(MID), row: m }, sampleEC(), s).reason).toBe("dirty");
    });
  });

  describe("blocked", () => {
    it("denies a blocked row", () => {
      const { x, c, s } = setup({ status: "blocked" });
      expect(eligible(x, c, s)).toEqual({ allow: false, reason: "blocked" });
    });
    it("denies a row whose dependency is missing from the Snapshot", () => {
      const m = sampleMemory();
      const s = sampleSnapshot({ memories: [[MID, m]] });
      expect(eligible({ ref: memRef(MID), row: m }, sampleEC(), s).reason).toBe("blocked");
    });
    it.each(["blocked", "purged"] as const)("denies a row whose Evidence dependency is %s", (status) => {
      const m = sampleMemory();
      const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, sampleEvidence({ status })]] });
      expect(eligible({ ref: memRef(MID), row: m }, sampleEC(), s).reason).toBe("blocked");
    });
    it.each(["wrong", "retracted", "blocked"] as const)("denies a row whose Memory dependency is %s", (status) => {
      const dep = testId("m2");
      const m = sampleMemory({ dependsOn: [`e:${EID}`, `m:${dep}`] });
      const s = sampleSnapshot({ memories: [[MID, m], [dep, sampleMemory({ status })]], evidence: [[EID, sampleEvidence()]] });
      expect(eligible({ ref: memRef(MID), row: m }, sampleEC(), s).reason).toBe("blocked");
    });
    it("allows a dependency whose stored rev is newer than the referenced @rev", () => {
      const m = sampleMemory({ dependsOn: [`e:${EID}@1`] });
      const s = sampleSnapshot({ memories: [[MID, m]], evidence: [[EID, sampleEvidence({ rev: 5 })]] });
      expect(eligible({ ref: memRef(MID), row: m }, sampleEC(), s)).toEqual({ allow: true, reason: "ok" });
    });
  });

  describe("time", () => {
    it("denies a Memory not yet valid", () => {
      const { x, c, s } = setup({ validFrom: "2026-11-04T00:00:00.000Z" });
      expect(eligible(x, c, s)).toEqual({ allow: false, reason: "time" });
    });
    it("denies a Memory whose validTo has passed (end-exclusive)", () => {
      const { x, c, s } = setup({ validTo: "2026-11-03T12:00:00.000Z" });
      expect(eligible(x, c, s).reason).toBe("time");
    });
  });

  describe("authority", () => {
    it.each(["T", "M"] as const)("denies class %s at stages project and speech", (sourceClass) => {
      const { x, c, s } = setup({ sourceClass, status: "alleged" });
      expect(eligible(x, c, s).reason).toBe("authority");
      expect(eligible(x, { ...c, stage: "speech" }, s).reason).toBe("authority");
      expect(eligible(x, { ...c, stage: "read" }, s).allow).toBe(true);
    });
  });

  describe("ineligible (invalid input never throws)", () => {
    it.each([
      ["a row failing its schema", (d: ReturnType<typeof setup>) => eligible({ ...d.x, row: { ...d.x.row, extra: 1 } as unknown as Memory }, d.c, d.s)],
      ["a missing EC field", (d: ReturnType<typeof setup>) => eligible(d.x, { ...d.c, uid: undefined } as never, d.s)],
      ["a Snapshot with unequal refs and rows", (d: ReturnType<typeof setup>) => eligible(d.x, d.c, { ...d.s, refs: [] })],
      ["null inputs", () => eligible(null as never, null as never, null as never)],
    ])("returns ineligible for %s", (_label, run) => {
      expect(run(setup())).toEqual({ allow: false, reason: "ineligible" });
    });
  });

  it("parses dependsOn entries", () => {
    expect(parseDep(`e:${EID}`)).toEqual({ collection: "evidence", id: EID, rev: null });
    expect(parseDep(`e:${EID}@3`)).toEqual({ collection: "evidence", id: EID, rev: 3 });
    expect(parseDep("x:abc")).toBeNull();
  });
});
