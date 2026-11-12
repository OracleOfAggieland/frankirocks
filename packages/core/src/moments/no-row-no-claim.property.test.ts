// Feature: one-shot time (brief 023), property "No row, no claim" (contracts §6 "saidAt=admitted+(idTagged|
// exactTemplate|candidateAndReason), else null"; spec §6 "No row, no claim"). For any stored moment and any receipt,
// `saidUpdate` sets saidAt only when the moment was admitted on that very response and the receipt's transcript
// matches it, and the match it names really holds: the transcript carries the tagged tokens, the template, or the
// candidate and its reason. Every other receipt leaves saidAt null.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tsFromMs } from "../schema/primitives";
import { testId } from "../testing/samples";
import { deriveOccasion } from "./derive";
import { momentRow } from "./merge";
import { normalizeSaid, type SaidReceipt, type SaidTarget, saidUpdate } from "./said";
import { memId, momentHasher, occasionMemory } from "./testing/arb-moments";

const START = Date.UTC(2026, 10, 13, 20);
const memory = occasionMemory(memId(1), { zone: "America/Chicago", startMs: START, precision: "instant", endMinutes: null, extraDays: 0 });
const plan = deriveOccasion(memory, new Map([[memory.logicalId, memory]]), momentHasher).plans[0]!;
const CTX = { uid: "owner-1", opsNow: START - 86_400_000, epoch: 1, policyRev: 1, clockMode: "fixture" as const };
const base = momentRow(plan, CTX, momentHasher);
const template = plan.payload.kind === "cue" ? (plan.payload.template?.text ?? "") : "";
const RESPONSE = "resp_said_1";

const textArb = fc.oneof(
  fc.constant(template),
  fc.constant(`Hey! ${template.toUpperCase()} Talk soon.`),
  fc.constant("Good luck today."),
  fc.constant("Thai Basil has the noodles you like."),
  fc.constant("Thai Basil, because it's quick"),
  fc.string({ maxLength: 60 }),
);

const caseArb = fc.record({
  status: fc.constantFrom("pending", "leased", "admitted", "delivered", "expired", "cancelled"),
  admittedOn: fc.constantFrom(RESPONSE, "resp_other", null),
  receipt: fc.record({
    kind: fc.constantFrom<SaidReceipt["kind"]>("admitted", "playbackStarted", "playbackEnded", "cancelled", "transcript", "pendingRendered"),
    responseId: fc.constantFrom(RESPONSE, "resp_other"),
    tagged: fc.boolean(),
    text: fc.option(textArb, { nil: null }),
  }),
  target: fc.record({
    tokens: fc.subarray(["good", "luck", "interview", "thai"]),
    withTemplate: fc.boolean(),
    candidate: fc.option(fc.record({ name: fc.constantFrom("Thai Basil", ""), reason: fc.constantFrom("quick", "") }), { nil: null }),
  }),
});

describe("one-shot time: no row, no claim", () => {
  it("saidAt is set only from an admitted receipt that matches", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const admitted = c.admittedOn !== null;
        const m = {
          ...base,
          status: c.status,
          admittedAt: admitted ? tsFromMs(CTX.opsNow) : null,
          responseId: c.admittedOn,
          leaseToken: c.status === "leased" ? testId("lease") : null,
          leaseUntil: c.status === "leased" ? tsFromMs(CTX.opsNow + 60_000) : null,
          cancelReason: c.status === "cancelled" ? ("policy" as const) : null,
        };
        const r: SaidReceipt = { kind: c.receipt.kind, responseId: c.receipt.responseId, momentIds: c.receipt.tagged ? [plan.momentId] : [], noteIds: [], text: c.receipt.text };
        const t: SaidTarget = { momentId: plan.momentId, noteId: null, tokens: c.target.tokens, template: c.target.withTemplate ? template : null, candidate: c.target.candidate };
        const out = saidUpdate(m, r, t, CTX.opsNow + 5_000);
        if (out === null) return;
        expect(["admitted", "delivered"]).toContain(m.status);
        expect(m.admittedAt).not.toBeNull();
        expect(m.responseId).toBe(r.responseId);
        expect(r.kind).toBe("transcript");
        const said = normalizeSaid(r.text ?? "");
        expect(said.length).toBeGreaterThan(0);
        if (out.saidMatch === "idTagged") {
          expect(r.momentIds).toContain(plan.momentId);
          expect(t.tokens.length).toBeGreaterThan(0);
          for (const tok of t.tokens) expect(said.split(" ")).toContain(normalizeSaid(tok));
        } else if (out.saidMatch === "exactTemplate") {
          expect(t.template).not.toBeNull();
          expect(said.includes(normalizeSaid(t.template!))).toBe(true);
        } else if (out.saidMatch === "candidateAndReason") {
          expect(t.candidate).not.toBeNull();
          expect(t.candidate!.name.length * t.candidate!.reason.length).toBeGreaterThan(0);
          expect(said.includes(normalizeSaid(t.candidate!.name)) && said.includes(normalizeSaid(t.candidate!.reason))).toBe(true);
        } else {
          expect.unreachable(`saidAt set with match ${out.saidMatch}`);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
