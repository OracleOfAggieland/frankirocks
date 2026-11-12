// Feature: voice-writes (brief 012 wave D, task D1), Property 13: truth orders only (design section 7, 3.3). For each
// transition kind, `applyTransition`'s Commands touch only that kind's predicates and subjects; `careOnly` and `defer`
// verdicts give none; self-scoped predicates (`person.relation`, the owner's own role) are touched only when the
// subject is self; no route write has a `validFrom` or `validTo` after worldNow, and none is `scheduled`.
// Rows come from a pool over three subjects and every predicate the routes write, in every status, said before or
// after the turn; verdicts are any kind, subject, counterpart and moment, including one after now.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type EID, type Value, msFromTs, tsFromMs } from "../schema/primitives";
import type { Memory } from "../schema/records";
import { testId } from "../testing/samples";
import { type RoutePred, keyOf } from "./keys";
import { DAD, NOW, PRIOR, PRIOR_EID, SISTER, TURN_AT, TURN_EID, buildEvidence, hasher, planEnv, row, spanAt } from "./testing/arb-writes";
import { applyTransition } from "./transition";
import type { TransitionVerdict } from "./types";

const now = msFromTs(NOW);
const HOUR = 3_600_000;
const EMPLOYER = hasher.id(["mention", "organization", "acme"]);
const HOME = hasher.id(["mention", "place", "leeds"]);
const SUBJECTS: readonly EID[] = ["self", DAD, SISTER];
const KINDS = ["death", "illness", "recovery", "breakup", "reunion", "move", "jobChangeOwn", "jobChangeOther"] as const;
type Kind = (typeof KINDS)[number];

/** The predicates each kind may touch (design 3.3). */
const ORDERS: Record<Kind, readonly RoutePred[]> = {
  death: ["person.life", "care"],
  illness: ["person.life", "care"],
  recovery: ["person.life", "care"],
  breakup: ["person.relation"],
  reunion: ["person.relation"],
  move: ["place.residence"],
  jobChangeOwn: ["employment.role", "person.relation"],
  jobChangeOther: ["employment.role"],
};

const enumV = (code: string): Value => ({ kind: "enum", code });
const rowSpec = fc.record({
  pred: fc.constantFrom<RoutePred>("person.life", "care", "person.relation", "place.residence", "employment.role"),
  subject: fc.constantFrom(...SUBJECTS),
  other: fc.constantFrom(DAD, SISTER),
  code: fc.constantFrom("alive", "ill", "deceased", "open", "resolved", "partner", "spouse", "boss", "sister"),
  status: fc.constantFrom<Memory["status"]>("active", "active", "history", "wrong"),
  later: fc.boolean(),
});

function build(i: number, s: { pred: RoutePred; subject: EID; other: EID; code: string; status: Memory["status"]; later: boolean }): Memory {
  const lifeCodes = ["alive", "ill", "deceased"];
  const careCodes = ["open", "resolved"];
  const relCodes = ["partner", "spouse", "boss", "sister"];
  const pick = (codes: string[]) => (codes.includes(s.code) ? s.code : codes[i % codes.length]!);
  let subjectId = s.subject;
  let value: Value;
  let args: Record<string, unknown>;
  switch (s.pred) {
    case "person.life":
      value = enumV(pick(lifeCodes));
      args = { detail: null };
      break;
    case "care":
      value = enumV(pick(careCodes));
      args = { careSubjectRef: s.other, topic: "sick" };
      break;
    case "person.relation":
      subjectId = "self";
      value = enumV(pick(relCodes));
      args = { otherRef: s.other, label: null, employerRef: pick(relCodes) === "boss" ? EMPLOYER : null };
      break;
    case "place.residence":
      value = { kind: "entity", ref: HOME };
      args = {};
      break;
    default:
      value = { kind: "text", text: "engineer" };
      args = { employerRef: EMPLOYER, managerRef: null };
  }
  const { scopeId, key } = keyOf(subjectId, s.pred, args, value, hasher);
  const at = s.later ? tsFromMs(msFromTs(TURN_AT) + HOUR) : PRIOR.assertedAt;
  return row(
    testId(`r${i}`),
    { subjectId, predicate: s.pred, value, args, scopeId, key, status: s.status, assertedAt: at, validFrom: at, validFromKey: at, validTo: s.status === "history" ? at : null, closeReason: s.status === "wrong" ? "refuted" : null },
    PRIOR,
    PRIOR_EID,
    "My dad lives in Leeds",
  );
}

const verdictArb: fc.Arbitrary<TransitionVerdict> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ kind: fc.constant<"change">("change"), transition: fc.constantFrom(...KINDS), subject: fc.constantFrom(...SUBJECTS), counterpart: fc.constantFrom<EID | null>(null, DAD, SISTER, HOME, EMPLOYER), when: fc.integer({ min: now - 48 * HOUR, max: now + 2 * HOUR }) }) },
  { weight: 1, arbitrary: fc.constant<TransitionVerdict>({ kind: "careOnly" }) },
  { weight: 1, arbitrary: fc.constantFrom<TransitionVerdict>({ kind: "defer", why: "need" }, { kind: "defer", why: "scheduled" }, { kind: "defer", why: "employer" }) },
);

const TEXT = "My dad passed away last night.";
const turn = buildEvidence(TURN_EID, TEXT, [], ["U"], TURN_AT);
const proof = spanAt(TURN_EID, TEXT, 0, TEXT.length - 1);

describe("Property 13: truth orders only", () => {
  it("each kind touches only its own predicates and subjects, never after now", () => {
    let wrote = 0;
    fc.assert(
      fc.property(fc.array(rowSpec, { maxLength: 10 }), verdictArb, (specs, v) => {
        const rows = specs.map((s, i) => build(i, s));
        const plan = applyTransition(v, new Map(rows.map((m) => [m.logicalId, m])), planEnv(turn, TURN_EID, proof, rows));
        const commands = plan.ok ? plan.commands : [];
        const what = `${JSON.stringify(v)} over ${JSON.stringify(specs)}`;
        if (v.kind !== "change") {
          expect(commands, `${what}: a ${v.kind} verdict wrote`).toEqual([]);
          return;
        }
        if (commands.length > 0) wrote++;
        const S = v.subject;
        for (const c of commands) {
          if (c.op !== "putMemory") continue;
          const m = c.row;
          expect(ORDERS[v.transition], `${what}: ${v.transition} touched ${m.predicate}`).toContain(m.predicate);
          if (m.predicate === "person.relation") expect(S, `${what}: a relation touched for subject ${S}`).toBe("self");
          if (m.predicate === "care") expect(m.args.careSubjectRef, `${what}: care for someone else`).toBe(S);
          else if (m.predicate !== "person.relation") expect(m.subjectId, `${what}: ${m.predicate} of another subject`).toBe(S);
          if (v.transition === "jobChangeOwn" || v.transition === "breakup" || v.transition === "reunion") expect(S).toBe("self");
          expect(m.status, `${what}: scheduled`).not.toBe("scheduled");
          if (m.validFrom !== null) expect(msFromTs(m.validFrom), `${what}: validFrom after now`).toBeLessThanOrEqual(now);
          if (m.validTo !== null) expect(msFromTs(m.validTo), `${what}: validTo after now`).toBeLessThanOrEqual(now);
        }
      }),
      { numRuns: 1000 },
    );
    // The generator reaches real writes, not only refusals.
    expect(wrote).toBeGreaterThan(50);
  });
});

