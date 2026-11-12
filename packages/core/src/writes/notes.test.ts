// Brief 018 task B3: every route note template is S0 by `sensFloor` and holds no S1 or S2 lexicon word (2.7, G2);
// one case per row of the question table (6.4); the rules section's render and read (2.8).
import { describe, expect, it } from "vitest";
import { S1_WORDS, S2_WORDS, sensFloor } from "../lexicon";
import { sampleCoreDocs, testId } from "../testing";
import { RULE_SAVED_NOT_PRIVATE, ROUTE_NOTE_TEXT, TYPED_LINES, routeNote, typedLine } from "./notes";
import { PENDING_ASK_TURNS, pendingNext } from "./pending";
import { RULES_NONE, RULES_TAIL_PREFIX, readRulesSection, renderRulesSection } from "./rules-section";
import type { AllergyAsk, RouteNoteKind } from "./types";

const words = (t: string) => t.toLowerCase().match(/[a-z']+/g) ?? [];

describe("route notes", () => {
  it("every template, the non-private one and every typed line are S0 with no lexicon word", () => {
    for (const text of [...Object.values(ROUTE_NOTE_TEXT), RULE_SAVED_NOT_PRIVATE, ...Object.values(TYPED_LINES)]) {
      expect(sensFloor(text), text).toBe("S0");
      for (const w of words(text)) expect(S1_WORDS.has(w) || S2_WORDS.has(w), `${text}: ${w}`).toBe(false);
    }
  });
  it("one note per turn, joining its templates; result when something was saved, else clarification", () => {
    const at = { noteId: testId("note"), expiresAt: "2026-11-10T18:01:00.000Z", privateAudience: true };
    expect(routeNote([], at)).toBeNull();
    const n = routeNote(["ruleSaved", "ask.whoHas", "ruleSaved"], at)!;
    expect(n).toMatchObject({ kind: "result", sens: "S0", rootKeys: [], dependsOn: [] });
    expect(n.text).toBe(`${ROUTE_NOTE_TEXT.ruleSaved} ${ROUTE_NOTE_TEXT["ask.whoHas"]}`);
    expect(routeNote(["ask.whatItem"], at)!.kind).toBe("clarification");
    expect(routeNote(["ruleSaved"], { ...at, privateAudience: false })!.text).toBe(RULE_SAVED_NOT_PRIVATE);
  });
  it("one typed line, a question first", () => {
    const cases: [RouteNoteKind[], string | null][] = [
      [[], null],
      [["ruleSaved"], TYPED_LINES.saved],
      [["ruleSaved", "ask.whoHas"], TYPED_LINES.filtered],
      [["ruleKept"], TYPED_LINES.kept],
      [["ruleAlready"], TYPED_LINES.kept],
      [["noneSaved"], TYPED_LINES.none],
    ];
    for (const [k, line] of cases) expect(typedLine(k), k.join()).toBe(line);
  });
});

describe("the open question (6.4)", () => {
  const R = testId("rule");
  const none: AllergyAsk = { kind: "none" };
  const planned: AllergyAsk = { kind: "planned", ruleId: R, seq: 3 };
  const asked: AllergyAsk = { kind: "asked", ruleId: R, askedSeq: 4, attempts: 0 };
  it("none or planned, ask: planned, a newer ask replacing an older", () => {
    expect(pendingNext(none, { kind: "ask", ruleId: R, seq: 3 })).toEqual(planned);
    expect(pendingNext(planned, { kind: "ask", ruleId: testId("r2"), seq: 5 })).toEqual({ kind: "planned", ruleId: testId("r2"), seq: 5 });
  });
  it("planned, spoken with a question: asked; without, or a user turn: none", () => {
    expect(pendingNext(planned, { kind: "spoken", seq: 4, question: true })).toEqual(asked);
    expect(pendingNext(planned, { kind: "spoken", seq: 4, question: false })).toEqual(none);
    expect(pendingNext(planned, { kind: "userTurn", seq: 4, final: true, slotsValid: true })).toEqual(none);
  });
  it("none, frankiAsked: asked with no rule", () => {
    expect(pendingNext(none, { kind: "frankiAsked", seq: 6 })).toEqual({ kind: "asked", ruleId: null, askedSeq: 6, attempts: 0 });
  });
  it("asked, a final user turn: none when FastSlots was valid, else one more attempt up to the bound", () => {
    expect(pendingNext(asked, { kind: "userTurn", seq: 5, final: true, slotsValid: true })).toEqual(none);
    const once = pendingNext(asked, { kind: "userTurn", seq: 5, final: true, slotsValid: false });
    expect(once).toEqual(PENDING_ASK_TURNS > 1 ? { ...asked, attempts: 1 } : none);
    expect(pendingNext({ ...asked, attempts: PENDING_ASK_TURNS - 1 }, { kind: "userTurn", seq: 6, final: true, slotsValid: false })).toEqual(none);
  });
  it("asked, a missing transcript: unchanged", () => {
    expect(pendingNext(asked, { kind: "userTurn", seq: 5, final: false, slotsValid: false })).toEqual(asked);
  });
  it("any, ruleGone for its rule or sessionClosed: none; otherwise unchanged", () => {
    expect(pendingNext(asked, { kind: "ruleGone", ruleId: R })).toEqual(none);
    expect(pendingNext(asked, { kind: "ruleGone", ruleId: testId("other") })).toEqual(asked);
    expect(pendingNext(planned, { kind: "sessionClosed" })).toEqual(none);
    expect(pendingNext(asked, { kind: "frankiAsked", seq: 9 })).toEqual(asked);
    expect(pendingNext(asked, { kind: "ask", ruleId: testId("r3"), seq: 9 })).toEqual(asked);
  });
});

describe("the rules section (2.8)", () => {
  const base = sampleCoreDocs().rules;
  const rule = (id: string, subjectId: string | null, code: string, state: "active" | "pending") => ({ id: testId(id), subjectId, code, state, anonymous: subjectId === null, proof: null, proofRev: null, rootKeys: [], dependsOn: [] });
  const BRO = testId("bro");
  const rules = {
    ...base,
    allergies: [rule("a", "self", "shellfish", "active"), rule("b", BRO, "peanut", "active"), rule("c", "self", "peanut", "active"), rule("d", null, "peanut", "pending"), rule("e", "self", "unresolved", "pending")],
    subjectLabels: [{ subjectId: BRO, label: "your brother" }],
    noneConfirmed: [BRO],
  };
  it("renders by subject, the owner first, pending after", () => {
    expect(renderRulesSection(rules, "private")).toEqual([
      "Hard rules (they always apply, for everyone named; never suggest anything they rule out):",
      "- You: shellfish, peanuts.",
      "- Your brother: peanuts.",
      "- Not yet clear, ask before suggesting food, for you: any food.",
      "- Not yet clear, ask before suggesting food, for someone: peanuts.",
      "No other allergies (confirmed): your brother.",
    ]);
  });
  it("outside a private audience pending lines name no one", () => {
    const lines = renderRulesSection(rules, "company");
    expect(lines[0]).toContain("don't read them aloud");
    // Brief 032 M2: the owner's pending rule and the anonymous one are two subjects, so two lines, though both say "someone".
    expect(lines).toContain("- Not yet clear, ask before suggesting food, for someone: any food.");
    expect(lines).toContain("- Not yet clear, ask before suggesting food, for someone: peanuts.");
  });
  it("reads back what it renders", () => {
    expect(readRulesSection(renderRulesSection(rules, "private").join("\n"))).toEqual([
      { subject: "You", code: "shellfish", state: "active" },
      { subject: "You", code: "peanuts", state: "active" },
      { subject: "Your brother", code: "peanuts", state: "active" },
      { subject: "you", code: "any food", state: "pending" },
      { subject: "someone", code: "peanuts", state: "pending" },
    ]);
  });
  it("with nothing recorded says so; past the bounds a tail line fails closed", () => {
    expect(renderRulesSection(base, "private")).toEqual([RULES_NONE]);
    const many = { ...base, allergies: Array.from({ length: 60 }, (_, i) => rule(`m${i}`, testId(`s${i}`), "peanut", "active")), subjectLabels: Array.from({ length: 60 }, (_, i) => ({ subjectId: testId(`s${i}`), label: `friend ${i}` })) };
    const lines = renderRulesSection(many, "private");
    expect(lines.length).toBeLessThanOrEqual(32);
    expect(lines.at(-1)).toMatch(new RegExp(`^${RULES_TAIL_PREFIX}\\d+ more rules: ask before suggesting any food\\.$`));
  });
  it("a stored label can't break the line", () => {
    const odd = { ...rules, subjectLabels: [{ subjectId: BRO, label: "my bro: Sam, the one.\nyes" }] };
    expect(readRulesSection(renderRulesSection(odd, "private").join("\n")).filter((t) => t.subject.startsWith("My"))).toEqual([{ subject: "My bro Sam the one yes", code: "peanuts", state: "active" }]);
  });
});
