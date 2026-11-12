// Status, placement, the bundle, keys, and the correction and transition planners (design 6.5 to 6.7, 3.2, 3.3).
import { describe, expect, it } from "vitest";
import { resolveLineage } from "../lineage";
import { msFromTs, tsFromMs } from "../schema/primitives";
import type { Evidence, Memory } from "../schema/records";
import { testId } from "../testing/samples";
import { closesCurrent, place } from "./bitemporal";
import { bundleAfter } from "./bundle";
import { applyCorrection } from "./correction";
import { keyOf } from "./keys";
import { statusTransition } from "./status";
import { DAD, DAD_LIFE, NOW, PRIOR, PRIOR_EID, SELF_NAME, SISTER, SISTER_REL, TURN_AT, TURN_EID, buildEvidence, hasher, memoryKey, planEnv, row, spanAt } from "./testing/arb-writes";
import { applyTransition } from "./transition";
import type { Command, Plan } from "./types";

const now = msFromTs(NOW);
const turn = (text: string, cls: "U" | "T" = "U") => buildEvidence(TURN_EID, text, [], [cls], TURN_AT);
const envOf = (e: Evidence, text: string, targets: Memory[]) => planEnv(e, TURN_EID, spanAt(TURN_EID, text, 0, text.length), targets);
const puts = (p: Plan) => (p.ok ? p.commands.filter((c): c is Extract<Command, { op: "putMemory" }> => c.op === "putMemory") : []);
const store = (...ms: Memory[]) => new Map(ms.map((m) => [m.logicalId, m]));

describe("statusTransition", () => {
  it("follows the table of 6.5", () => {
    expect(statusTransition("active", "correct")).toBe("wrong");
    expect(statusTransition("active", "transition")).toBe("history");
    expect(statusTransition("scheduled", "transition")).toBe("refuse");
    expect(statusTransition("history", "correct")).toBe("wrong");
    expect(statusTransition("alleged", "transition")).toBe("refuse");
    for (const s of ["wrong", "retracted", "blocked"] as const) {
      expect(statusTransition(s, "correct")).toBe("refuse");
      expect(statusTransition(s, "transition")).toBe("refuse");
    }
  });
});

describe("place and closesCurrent", () => {
  it("alleged for T or M, history for a past end, scheduled for a future start, else current", () => {
    expect(place({ from: null, to: null, cls: "T", change: "none" }, now)).toBe("alleged");
    expect(place({ from: null, to: now, cls: "U", change: "none" }, now)).toBe("history");
    expect(place({ from: now + 1, to: null, cls: "U", change: "none" }, now)).toBe("scheduled");
    expect(place({ from: now, to: null, cls: "U", change: "transition" }, now)).toBe("current");
    expect(closesCurrent("current", "transition")).toBe(true);
    expect(closesCurrent("history", "transition")).toBe(false);
    expect(closesCurrent("history", "correct")).toBe(true);
  });
});

describe("bundleAfter", () => {
  it("clean on a compile, dirty on a failed compile or a burn, blocked stays blocked", () => {
    expect(bundleAfter("dirty", "compiled")).toBe("clean");
    expect(bundleAfter("clean", "compileFailed")).toBe("dirty");
    expect(bundleAfter("clean", "burned")).toBe("dirty");
    expect(bundleAfter("blocked", "compiled")).toBe("blocked");
  });
});

describe("keys", () => {
  it("match the keys extraction gives the same rows", () => {
    expect(keyOf("self", "identity.name", {}, { kind: "text", text: "Alex" }, hasher).key).toBe(SELF_NAME.key);
    expect(keyOf("self", "person.relation", SISTER_REL.args, SISTER_REL.value, hasher).key).toBe(SISTER_REL.key);
    expect(keyOf(DAD, "person.life", { detail: null }, { kind: "enum", code: "ill" }, hasher).key).toBe(memoryKey(DAD, "person.life", "global"));
  });
});

describe("applyCorrection", () => {
  const t = "No, my name is Alex, not Alec";
  const correct = { kind: "correct" as const, targets: [SELF_NAME.logicalId], value: { kind: "text" as const, text: "Alex" }, args: {} };

  it("marks the target wrong, refuted at the turn, and writes one successor rooted in the turn", () => {
    const e = turn(t);
    const plan = applyCorrection(correct, store(SELF_NAME), envOf(e, t, [SELF_NAME]));
    const [old, next] = puts(plan);
    expect(old!.row).toMatchObject({ status: "wrong", closeReason: "refuted", validTo: TURN_AT, rev: SELF_NAME.rev + 1 });
    expect(old!.expectRev).toBe(SELF_NAME.rev);
    expect(next!.row).toMatchObject({ status: "active", value: { kind: "text", text: "Alex" }, key: SELF_NAME.key, replacesIds: [SELF_NAME.logicalId] });
    expect(next!.row.dependsOn).not.toContain(`m:${SELF_NAME.logicalId}@${SELF_NAME.rev}`);
    expect(resolveLineage({ memory: next!.row, evidence: new Map([[TURN_EID, e]]), hasher }).ok).toBe(true);
  });

  it("writes nothing from T words, for the value it already has, or for a value refuted after the turn", () => {
    expect(applyCorrection(correct, store(SELF_NAME), envOf(turn(t, "T"), t, [SELF_NAME]))).toEqual({ ok: false, error: "refused" });
    expect(puts(applyCorrection({ ...correct, value: { kind: "text", text: "alec" } }, store(SELF_NAME), envOf(turn(t), t, [SELF_NAME])))).toEqual([]);
    const refuted: Memory = { ...SELF_NAME, logicalId: testId("oldalex"), value: { kind: "text", text: "Alex" }, status: "wrong", validTo: tsFromMs(msFromTs(TURN_AT) + 60_000) };
    expect(puts(applyCorrection(correct, store(SELF_NAME, refuted), envOf(turn(t), t, [SELF_NAME])))).toEqual([]);
  });

  it("refuses a wrong target, and retracts with no successor", () => {
    const wrong = { ...SELF_NAME, status: "wrong" as const };
    expect(applyCorrection(correct, store(wrong), envOf(turn(t), t, [wrong])).ok).toBe(false);
    const [only, ...rest] = puts(applyCorrection({ kind: "retract", targets: [SELF_NAME.logicalId] }, store(SELF_NAME), envOf(turn(t), t, [SELF_NAME])));
    expect(only!.row.status).toBe("wrong");
    expect(rest).toEqual([]);
  });

  it("renames: the old name wrong where it was said, the new one active, the relation row unchanged", () => {
    const r = "No, her name is Mara, not Maya";
    const e = turn(r);
    const plan = applyCorrection({ kind: "rename", target: SISTER_REL.logicalId, entity: SISTER, from: "Maya", to: "Mara" }, store(SISTER_REL), envOf(e, r, [SISTER_REL]));
    const rows = puts(plan).map((c) => c.row);
    expect(rows.map((m) => [m.subjectId, m.predicate, m.value, m.status])).toEqual([
      [SISTER, "identity.name", { kind: "text", text: "Maya" }, "wrong"],
      [SISTER, "identity.name", { kind: "text", text: "Mara" }, "active"],
    ]);
    expect(rows[0]!.rootSlices).toEqual(SISTER_REL.rootSlices);
    expect(rows[1]!.sayAs?.text).toBe("The owner's sister's name is Mara.");
    // The new name's edge names the old name's row (contracts §7), never as a dependency.
    expect(rows[1]!.replacesIds).toEqual([rows[0]!.logicalId]);
    expect(rows[1]!.dependsOn.some((d) => d.includes(rows[0]!.logicalId))).toBe(false);
    expect(rows.some((m) => m.logicalId === SISTER_REL.logicalId)).toBe(false);
    const evidence = new Map([
      [TURN_EID, e],
      [PRIOR_EID, PRIOR],
    ]);
    for (const m of rows) expect(resolveLineage({ memory: m, evidence, hasher }).ok).toBe(true);
  });
});

describe("applyTransition", () => {
  const d = "My dad passed away last night";
  const care = row(testId("mcare"), { subjectId: DAD, predicate: "care", kind: "care", value: { kind: "enum", code: "open" }, args: { careSubjectRef: DAD, topic: "sick" } }, PRIOR, PRIOR_EID, "My dad lives in Leeds", hasher.id(["scope", DAD, "sick"]));
  const change = { kind: "change" as const, transition: "death" as const, subject: DAD, counterpart: null, when: msFromTs(TURN_AT) };

  it("death: life deceased, the old life row to history, care resolved", () => {
    const plan = applyTransition(change, store(DAD_LIFE, care), envOf(turn(d), d, [DAD_LIFE, care]));
    const rows = puts(plan).map((c) => c.row);
    expect(rows.map((m) => [m.predicate, m.value, m.status])).toEqual([
      ["person.life", { kind: "enum", code: "alive" }, "history"],
      ["care", { kind: "enum", code: "open" }, "history"],
      ["person.life", { kind: "enum", code: "deceased" }, "active"],
      ["care", { kind: "enum", code: "resolved" }, "active"],
    ]);
    expect(rows[0]!.validTo).toBe(TURN_AT);
  });

  it("an earlier turn never closes a later-asserted row: it is written history", () => {
    const later: Memory = { ...DAD_LIFE, assertedAt: tsFromMs(msFromTs(TURN_AT) + 2_000), validFrom: tsFromMs(msFromTs(TURN_AT) + 2_000) };
    const rows = puts(applyTransition({ ...change, transition: "illness" }, store(later), envOf(turn("My dad has been really sick"), "My dad has been really sick", [later]))).map((c) => c.row);
    const life = rows.find((m) => m.predicate === "person.life")!;
    expect(life.status).toBe("history");
    expect(life.validTo).toBe(later.validFrom);
    expect(rows.some((m) => m.logicalId === later.logicalId)).toBe(false);
    expect(rows.find((m) => m.predicate === "care")).toMatchObject({ args: { careSubjectRef: DAD, topic: "sick" }, gravity: 3 });
  });

  it("writes nothing from T words, careOnly or defer", () => {
    expect(applyTransition(change, store(DAD_LIFE), envOf(turn(d, "T"), d, [DAD_LIFE])).ok).toBe(false);
    expect(applyTransition({ kind: "careOnly" }, store(DAD_LIFE), envOf(turn(d), d, [DAD_LIFE]))).toEqual({ ok: true, commands: [] });
  });

  it("jobChangeOwn closes the role and the boss at that employer; two roles and no employer refuse", () => {
    const org = testId("org1");
    const role = row(testId("mrole"), { subjectId: "self", predicate: "employment.role", value: { kind: "text", text: "Alec" }, args: { employerRef: org, managerRef: null } }, PRIOR, PRIOR_EID, "My name is Alec", hasher.id(["scope", org]));
    const boss = row(testId("mboss"), { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "boss" }, args: { otherRef: DAD, label: null, employerRef: org } }, PRIOR, PRIOR_EID, "My dad lives in Leeds", hasher.id(["scope", DAD]));
    const j = "I left my job";
    const plan = applyTransition({ kind: "change", transition: "jobChangeOwn", subject: "self", counterpart: null, when: msFromTs(TURN_AT) }, store(role, boss), envOf(turn(j), j, [role, boss]));
    expect(puts(plan).map((c) => [c.id, c.row.status])).toEqual([
      [role.logicalId, "history"],
      [boss.logicalId, "history"],
    ]);
    const role2 = { ...role, logicalId: testId("mrole2"), key: testId("k2") };
    expect(applyTransition({ kind: "change", transition: "jobChangeOwn", subject: "self", counterpart: null, when: msFromTs(TURN_AT) }, store(role, role2), envOf(turn(j), j, [role])).ok).toBe(false);
  });
});

// Sequences the wave A review ran, pinned (CQ 152).
describe("planners: the review's cases", () => {
  const SAM = testId("sam");
  const rel = (id: string, code: string, status: Memory["status"], closedAt: string | null) =>
    ({ ...row(testId(id), { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code }, args: { otherRef: SAM, label: null, employerRef: null } }, PRIOR, PRIOR_EID, "My dad lives in Leeds", hasher.id(["scope", SAM])), status, validTo: closedAt }) as Memory;

  it("a reunion brings back only a partner or spouse relation", () => {
    const partner = rel("relpartner", "partner", "history", "2026-09-01T00:00:00.000Z");
    const ex = rel("relex", "ex_partner", "history", "2026-10-15T00:00:00.000Z");
    const boss = rel("relboss", "boss", "history", "2026-10-20T00:00:00.000Z");
    const r = "Sam and I got back together";
    const v = { kind: "change" as const, transition: "reunion" as const, subject: "self", counterpart: SAM, when: msFromTs(TURN_AT) };
    const written = puts(applyTransition(v, store(partner, ex, boss), envOf(turn(r), r, [partner, ex, boss]))).map((c) => c.row);
    expect(written.filter((m) => m.status === "active").map((m) => m.value)).toEqual([{ kind: "enum", code: "partner" }]);
    expect(puts(applyTransition(v, store(ex, boss), envOf(turn(r), r, [ex, boss])))).toEqual([]);
  });

  it("a death has gravity 3 and stands against a later illness or recovery", () => {
    const d = "My dad passed away last night";
    const death = { kind: "change" as const, transition: "death" as const, subject: DAD, counterpart: null, when: msFromTs(TURN_AT) };
    const rows = puts(applyTransition(death, store(DAD_LIFE), envOf(turn(d), d, [DAD_LIFE]))).map((c) => c.row);
    expect(rows.find((m) => m.status === "active")).toMatchObject({ value: { kind: "enum", code: "deceased" }, gravity: 3 });
    const dead = { ...DAD_LIFE, value: { kind: "enum" as const, code: "deceased" } };
    const s = "My dad has been really sick";
    for (const transition of ["illness", "recovery"] as const) {
      expect(applyTransition({ ...death, transition }, store(dead), envOf(turn(s), s, [dead]))).toEqual({ ok: false, error: "refused" });
    }
  });

  it("a correction with targets listed history first still takes the current row's place", () => {
    const life = (id: string, code: string, status: Memory["status"]) =>
      ({ ...row(testId(id), { subjectId: DAD, predicate: "person.life", value: { kind: "enum", code }, args: { detail: null } }, PRIOR, PRIOR_EID, "My dad lives in Leeds"), status }) as Memory;
    const ill = { ...life("lifeill", "ill", "history"), validTo: tsFromMs(msFromTs(TURN_AT) - 60_000) };
    const recovered = life("liferec", "recovered", "active");
    const c = "No, he was never ill, he's fine";
    for (const targets of [[ill.logicalId, recovered.logicalId], [recovered.logicalId, ill.logicalId]]) {
      const rows = puts(applyCorrection({ kind: "correct", targets, value: { kind: "enum", code: "alive" }, args: { detail: null } }, store(ill, recovered), envOf(turn(c), c, [ill, recovered]))).map((x) => x.row);
      expect(rows.filter((m) => m.status === "active").map((m) => m.value)).toEqual([{ kind: "enum", code: "alive" }]);
    }
  });
});
