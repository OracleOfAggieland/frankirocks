// Brief 043: the reviewer's sequences for findings 6, 4 and 5, at validation (the route-level runs are in
// `server/src/routes/turn.review043.test.ts`).
import { describe, expect, it } from "vitest";
import { SELF_LIFE_FORMS, selfIsLifeSubject } from "./self-life";
import { KNOWN, TURN_AT, TURN_EID, buildEvidence, spanAt, validateContext } from "./testing/arb-writes";
import type { FastItem, ItemVerdict } from "./types";
import { validateItems } from "./validate";

const SELF = { entityId: null, mention: null, isSelf: true };
const whole = (text: string) => spanAt(TURN_EID, text, 0, text.length - 1);
const run = (text: string, item: FastItem): ItemVerdict => validateItems({ items: [item], need: "none" }, validateContext(buildEvidence(TURN_EID, text, [], ["U"], TURN_AT)))[0]!;
const life = (text: string, transition: "illness" | "recovery"): FastItem => ({ kind: "transition", transition, subject: SELF, counterpart: null, whenSpoken: null, polarity: "affirmed", act: "direct", span: whole(text) });

describe("finding 6: isSelf for a life change needs the owner to be its subject", () => {
  it("\"I just found out my brother was diagnosed with cancer.\" with isSelf is not the owner ill", () => {
    const t = "I just found out my brother was diagnosed with cancer.";
    expect(run(t, life(t, "illness"))).not.toMatchObject({ v: { kind: "change", subject: "self" } });
  });
  it("the owner's own illness still changes", () => {
    for (const t of ["I was diagnosed with cancer last week.", "I'm sick.", "I have the flu.", "I've been diagnosed with diabetes."]) expect(run(t, life(t, "illness")), t).toMatchObject({ v: { kind: "change", subject: "self" } });
    const r = "I'm feeling better now.";
    expect(run(r, life(r, "recovery"))).toMatchObject({ v: { kind: "change", subject: "self" } });
  });
  it("the closed forms, and a relation word or a known name defers", () => {
    expect(SELF_LIFE_FORMS.length).toBeGreaterThan(3);
    const others = new Set(["maya", "dad"]);
    expect(selfIsLifeSubject("I was diagnosed with the flu.", others)).toBe(true);
    expect(selfIsLifeSubject("I just found out my brother was diagnosed.", others)).toBe(false);
    expect(selfIsLifeSubject("I have to look after my sick mom.", others)).toBe(false);
    expect(selfIsLifeSubject("I'm sick, and Maya is too.", others)).toBe(false);
    expect(selfIsLifeSubject("I heard it was serious.", others)).toBe(false);
    void KNOWN;
  });
});
