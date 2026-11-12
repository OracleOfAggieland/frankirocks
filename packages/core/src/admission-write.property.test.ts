// Feature: voice-writes (brief 012 wave B, task B1), Property 10: `writeRule` never loosens (design section 4, G1,
// G27, G30). Over every enumerated RuleInput profile of voice-control property 8 and 10,000 generated ones, times ten
// TurnWrite values:
//   - a hold is unchanged;
//   - a permit keeps its `notes`, `scope`, `line` and `swap`;
//   - `permit` changes only to `postCommitControl`, and only from `slowOrdinary` or `postCommitControl`;
//   - `cut` is true after a committed write that raised the Deck or a kept write with `cut`; otherwise the outcome
//     is `serverRule`'s, unchanged;
//   - the seam's notes are at most 4, never drop the route note when it passes the level, and with a Fixed_Line are
//     the line's ack note alone.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type RuleInput, type RuleOutcome, admittedNotes, serverRule, writeRule } from "./admission";
import { allRuleInputs, arbRuleInput } from "./intents/testing/arb-rule-input";
import type { W } from "./schema/wire";
import type { TurnWrite } from "./writes/types";

const note = (id: string, sens: W["sens"], kind: W["kind"] = "truth"): W => ({
  noteId: id.padEnd(43, "x").slice(0, 43),
  rev: 1,
  kind,
  text: `note ${id}`,
  rootKeys: [],
  dependsOn: [],
  sens,
  expiresAt: "2026-11-10T18:00:15.000Z",
  unprompted: false,
  momentId: null,
  tokens: [],
});
const ROUTE_NOTE = note("routenote", "S0", "result");

const TURN_WRITES: readonly TurnWrite[] = [
  { kind: "none" },
  { kind: "committed", routes: ["hardRule"], note: null, deckRaised: true },
  { kind: "committed", routes: ["hardRule"], note: ROUTE_NOTE, deckRaised: true },
  { kind: "committed", routes: ["transition"], note: null, deckRaised: false },
  { kind: "committed", routes: ["transition"], note: ROUTE_NOTE, deckRaised: false },
  { kind: "kept", routes: ["hardRule"], note: null, cut: true },
  { kind: "kept", routes: ["hardRule"], note: ROUTE_NOTE, cut: true },
  { kind: "kept", routes: ["hardRule"], note: null, cut: false },
  { kind: "kept", routes: ["hardRule"], note: ROUTE_NOTE, cut: false },
  { kind: "committed", routes: ["hardRule", "correct", "transition"], note: ROUTE_NOTE, deckRaised: true },
];

const raises = (w: TurnWrite) => (w.kind === "committed" && w.deckRaised) || (w.kind === "kept" && w.cut);

function check(i: RuleInput, w: TurnWrite): void {
  const base: RuleOutcome = serverRule(i);
  const out = writeRule(i, base, w);
  if (base.kind === "hold" || !raises(w)) {
    expect(out).toEqual(base);
    return;
  }
  expect(out.kind).toBe("permit");
  if (out.kind !== "permit") return;
  expect({ notes: out.notes, scope: out.scope, line: out.line, swap: out.swap }).toEqual({ notes: base.notes, scope: base.scope, line: base.line, swap: base.swap });
  if (out.permit !== base.permit) {
    expect(out.permit).toBe("postCommitControl");
    expect(["slowOrdinary", "postCommitControl"]).toContain(base.permit);
  }
  expect(out.cut).toBe(true);
}

function checkNotes(candidates: W[], o: RuleOutcome, routeNote: W | null): void {
  if (o.kind !== "permit") return;
  const out = admittedNotes(candidates, o.notes, o.line === null ? null : note("ack", "S0", "ack"), routeNote);
  expect(out.length).toBeLessThanOrEqual(4);
  if (o.line !== null) {
    expect(out.map((n) => n.kind)).toEqual(["ack"]);
    return;
  }
  const passes = routeNote !== null && (o.notes === "all" || (o.notes === "S0" && routeNote.sens === "S0"));
  expect(out.some((n) => n.noteId === routeNote?.noteId)).toBe(passes);
}

const CANDIDATES: W[][] = [[], [note("a", "S0")], [note("a", "S1"), note("b", "S0"), note("c", "S2"), note("d", "S0")]];

describe("Property 10: writeRule never loosens", () => {
  it("holds for every enumerated profile and TurnWrite", { timeout: 120_000 }, () => {
    let n = 0;
    for (const i of allRuleInputs()) {
      for (const w of TURN_WRITES) check(i, w);
      // The notes half is independent of the TurnWrite: one candidate set per profile, rotated.
      checkNotes(CANDIDATES[n % CANDIDATES.length]!, writeRule(i, serverRule(i), TURN_WRITES[n % TURN_WRITES.length]!), n % 2 === 0 ? ROUTE_NOTE : null);
      n++;
    }
    expect(n).toBeGreaterThan(10_000);
  });

  it("holds for generated inputs", () => {
    fc.assert(
      fc.property(arbRuleInput, fc.constantFrom(...TURN_WRITES), fc.constantFrom(...CANDIDATES), fc.boolean(), (i, w, cands, withRoute) => {
        check(i, w);
        checkNotes(cands, writeRule(i, serverRule(i), w), withRoute ? ROUTE_NOTE : null);
      }),
      { numRuns: 10_000 },
    );
  });
});
