import { describe, expect, it } from "vitest";
import { HEAD_SECTIONS, validate, Head } from "./index";
import { KNOW_HEADING, KNOW_TOKEN_CAP, type HeadMemory, compileHead } from "./head";
import type { Memory } from "./schema/records";
import { sampleCoreDocs, sampleEC, sampleEvidence, sampleMemory, sampleSnapshot, testId } from "./testing";

const EID = testId("ev");
const DAY = Date.UTC(2026, 10, 3, 12);

function input(memories: HeadMemory[], zone = "America/Chicago") {
  const snapshot = sampleSnapshot({ memories: memories.map((m) => [m.id, m.memory]), evidence: [[EID, sampleEvidence()]] });
  return {
    memories,
    ec: sampleEC(),
    snapshot,
    rules: sampleCoreDocs().rules,
    clock: { worldClock: { now: DAY, zone }, opsClock: { now: DAY } },
  };
}

const mem = (n: number, overrides: Partial<Memory> = {}): HeadMemory => ({
  id: testId(`m${n}`),
  memory: sampleMemory({ key: testId(`k${n}`), value: { kind: "text", text: `fact number ${n}` }, ...overrides }),
});

function compiled(memories: HeadMemory[], zone?: string) {
  const r = compileHead(input(memories, zone));
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("compileHead", () => {
  it("returns exactly the ten sections in contract order, valid against the Head schema", () => {
    const { head } = compiled([mem(1)]);
    expect(head.sections.map((s) => s.id)).toEqual([...HEAD_SECTIONS]);
    expect(validate(Head, head).ok).toBe(true);
    expect(head.tokenCount).toBe(head.sections.reduce((n, s) => n + s.tokens, 0));
  });

  it("with no eligible Memory: all ten sections, empty know, empty selectedRefs (R26.8)", () => {
    const { head } = compiled([mem(1, { sens: "S2" }), mem(2, { status: "history" })]);
    expect(head.sections).toHaveLength(10);
    expect(head.sections.find((s) => s.id === "know")?.tokens).toBe(0);
    expect(head.selectedRefs).toEqual([]);
    expect(head.text).not.toContain("fact number");
    expect(head.text).toContain("Hard rules: none recorded. Allergies unknown: ask before suggesting food.");
  });

  it("puts an eligible fact under the know heading and lists its ref", () => {
    const { head } = compiled([mem(1)]);
    expect(head.text).toContain(KNOW_HEADING);
    expect(head.text).toContain("- fact: fact number 1");
    expect(head.selectedRefs).toEqual([{ type: "memory", id: testId("m1"), rev: 1 }]);
  });

  it("writes the absolute date, weekday and IANA zone from worldClock, with no relative words (R26.7)", () => {
    const { lines } = compiled([], "America/Chicago");
    const now = lines.filter((l) => l.section === "now").map((l) => l.text).join("\n");
    expect(now).toContain("2026-11-03");
    expect(now).toContain("Tuesday");
    expect(now).toContain("America/Chicago");
    expect(now).not.toMatch(/\b(today|tomorrow|yesterday|tonight)\b/i);
    expect(compiled([], "Pacific/Kiritimati").lines.find((l) => l.section === "now")?.text).toContain("2026-11-04");
  });

  it("excludes S2 everywhere and keeps apply to S0–S1 preferences (R26.3)", () => {
    const pref = (n: number, sens: "S0" | "S1" | "S2"): HeadMemory => ({
      id: testId(`p${n}`),
      memory: sampleMemory({
        key: testId(`pk${n}`),
        kind: "preference",
        predicate: "preference.food",
        value: { kind: "enum", code: "like" },
        args: { dimension: "cuisine", targetRef: null },
        sens,
      }),
    });
    const { head, lines } = compiled([pref(1, "S0"), pref(2, "S1"), pref(3, "S2"), mem(4, { sens: "S2", value: { kind: "text", text: "secret diagnosis" } })]);
    expect(lines.filter((l) => l.section === "apply" && l.ref !== null).map((l) => l.ref!.id)).toEqual([testId("p1"), testId("p2")]);
    expect(head.text).not.toContain("secret diagnosis");
    expect(head.selectedRefs.map((r) => r.id)).not.toContain(testId("p3"));
  });

  it("caps know at 450 tokens", () => {
    const many = Array.from({ length: 200 }, (_, n) => mem(n, { value: { kind: "text", text: `a long remembered fact ${n} `.repeat(4) } }));
    const { head } = compiled(many);
    expect(head.sections.find((s) => s.id === "know")!.tokens).toBeLessThanOrEqual(KNOW_TOKEN_CAP);
  });

  describe("drop order (R26.4), on a reduced token cap", () => {
    const person = (n: number): HeadMemory => ({
      id: testId(`pe${n}`),
      memory: sampleMemory({ key: testId(`pek${n}`), predicate: "person.life", value: { kind: "enum", code: "alive" }, args: { detail: null } }),
    });
    const pref = (n: number): HeadMemory => ({
      id: testId(`pr${n}`),
      memory: sampleMemory({
        key: testId(`prk${n}`),
        kind: "preference",
        predicate: "preference.food",
        value: { kind: "enum", code: "like" },
        args: { dimension: "dish", targetRef: null },
      }),
    });
    const all = [...Array.from({ length: 5 }, (_, n) => person(n)), ...Array.from({ length: 5 }, (_, n) => pref(n)), ...Array.from({ length: 5 }, (_, n) => mem(n))];
    const full = compiled(all);
    const tokens = (r: { head: { sections: { id: string; tokens: number }[] } }) => Object.fromEntries(r.head.sections.map((s) => [s.id, s.tokens]));
    const fixed = ["persona", "policy", "rules", "now", "style"].reduce((n, id) => n + tokens(full)[id]!, 0);
    const at = (cap: number) => {
      const r = compileHead({ ...input(all), tokenCap: cap });
      if (!r.ok) throw new Error(r.error);
      return tokens(r);
    };

    it("drops know lines first, emptying know before apply loses a line", () => {
      const t = at(full.head.tokenCount - 1);
      expect(t.know).toBeLessThan(tokens(full).know!);
      expect(t.apply).toBe(tokens(full).apply);
      expect(t.people).toBe(tokens(full).people);
      const t2 = at(full.head.tokenCount - tokens(full).know! - 1);
      expect(t2.know).toBe(0);
      expect(t2.apply).toBeLessThan(tokens(full).apply!);
      expect(t2.people).toBe(tokens(full).people);
    });

    it("drops people last, and never persona, policy, rules or now", () => {
      const t = at(fixed + 1);
      expect([t.know, t.apply, t.next72, t.openers]).toEqual([0, 0, 0, 0]);
      expect(t.people).toBe(0);
      for (const id of ["persona", "policy", "rules", "now"]) expect(t[id]).toBe(tokens(full)[id]);
    });

    it("returns budgetExceeded, and no Head, when persona, policy, rules and now alone exceed the cap (R26.6)", () => {
      const r = compileHead({ ...input(all), tokenCap: tokens(full).persona! + tokens(full).policy! });
      expect(r).toEqual({ ok: false, error: "budgetExceeded" });
    });
  });

  it("the 128-ref cap drops know lines before apply lines", () => {
    // 450 know + apply lines large enough to overflow only with know present.
    const longPref = (n: number): HeadMemory => ({
      id: testId(`lp${n}`),
      memory: sampleMemory({
        key: testId(`lpk${n}`),
        kind: "preference",
        predicate: "preference.style",
        value: { kind: "enum", code: "concise" },
        args: { context: "global", dimension: "detail" },
      }),
    });
    const prefs = Array.from({ length: 128 }, (_, n) => longPref(n));
    const know = Array.from({ length: 40 }, (_, n) => mem(n));
    const r = compiled([...prefs, ...know]);
    const knowRefs = r.lines.filter((l) => l.section === "know" && l.ref !== null).length;
    const applyRefs = r.lines.filter((l) => l.section === "apply" && l.ref !== null).length;
    // 168 candidate refs exceed the 128-ref cap, so lines drop in order: know goes first, apply keeps 128.
    expect(knowRefs).toBe(0);
    expect(applyRefs).toBe(128);
    expect(r.head.selectedRefs).toHaveLength(128);
  });

  it("caps people at 40 lines", () => {
    const people = Array.from({ length: 60 }, (_, n): HeadMemory => ({
      id: testId(`pe${n}`),
      memory: sampleMemory({ key: testId(`pek${n}`), predicate: "person.life", value: { kind: "enum", code: "alive" }, args: { detail: null } }),
    }));
    const { lines } = compiled(people);
    expect(lines.filter((l) => l.section === "people" && l.ref !== null)).toHaveLength(40);
  });

  it("keeps Head.text at or below 14,000 characters", () => {
    const many = Array.from({ length: 300 }, (_, n) => mem(n, { value: { kind: "text", text: "z".repeat(500) } }));
    expect(compiled(many).head.text.length).toBeLessThanOrEqual(14_000);
  });
});

// voice-control task 45 (brief 026): the Head compiles by audience (R14.2; design "Open with inheritance").
describe("compileHead by audience (task 45)", () => {
  const shellfish = { id: testId("rule"), subjectId: "self", code: "shellfish", state: "active" as const, anonymous: false, proof: null, proofRev: null, rootKeys: [], dependsOn: [] };
  const withRules = (memories: HeadMemory[], audience?: "private" | "company" | "unknown") => {
    const base = input(memories);
    const r = compileHead({ ...base, rules: { ...base.rules, allergies: [shellfish] }, ...(audience === undefined ? {} : { audience }) });
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const mix = () => [
    mem(1, { sens: "S0", value: { kind: "text", text: "plain fact" } }),
    mem(2, { sens: "S1", value: { kind: "text", text: "personal fact" } }),
    mem(3, { sens: "S2", value: { kind: "text", text: "secret fact" } }),
  ];

  it("with company: no line above S0, the rules section unchanged, and the Now line says the audience", () => {
    const company = withRules(mix(), "company");
    const memoryLines = company.lines.filter((l) => l.ref !== null);
    expect(memoryLines.map((l) => l.ref!.id)).toEqual([testId("m1")]);
    expect(company.head.text).toContain("plain fact");
    expect(company.head.text).not.toContain("personal fact");
    expect(company.head.text).not.toContain("secret fact");
    expect(company.head.selectedRefs.map((r) => r.id)).toEqual([testId("m1")]);
    // The rules section is what the rules renderer gives for the audience, every hard rule still in it.
    const rulesOf = (r: typeof company) => r.lines.filter((l) => l.section === "rules").map((l) => l.text);
    const noMemories = withRules([], "company");
    expect(rulesOf(company)).toEqual(rulesOf(noMemories));
    expect(rulesOf(company).join("\n")).toContain("shellfish");
    expect(company.lines.find((l) => l.section === "now")!.text).toMatch(/ Audience: company\.$/);
  });

  it("with unknown: no line above S0 either (fails closed)", () => {
    const unknown = withRules(mix(), "unknown");
    expect(unknown.lines.filter((l) => l.ref !== null).map((l) => l.ref!.id)).toEqual([testId("m1")]);
  });

  it("private is byte-identical to a compile with no audience, S1 lines included", () => {
    const priv = withRules(mix(), "private");
    const none = withRules(mix());
    expect(priv).toEqual(none);
    expect(priv.head.text).toContain("personal fact");
    expect(priv.lines.find((l) => l.section === "now")!.text).toMatch(/ Audience: private\.$/);
  });
});

describe("the deceased join (brief 025 task D3, G15)", async () => {
  const { hasher } = await import("./writes/testing/arb-writes");
  const { mentionEid, mentionName } = await import("./writes/subject");
  const eid = (words: string) => mentionEid("person", mentionName(words), hasher);
  const say = (text: string, ents: string[]) => ({ entityIds: ents, sayAs: { text, entityRefs: [], timeFields: [] } });
  const rel = (n: number, words: string, text: string): HeadMemory =>
    mem(n, { subjectId: "self", predicate: "person.relation", value: { kind: "enum", code: "parent" }, args: { otherRef: eid(words), label: null, employerRef: null }, ...say(text, [eid(words)]) });

  it("keeps lines naming dad out of people, by the EID: \"Dad\" and \"my dad\" are reached, \"my father\" is not", () => {
    const lines = [rel(1, "Dad", "Dad is the owner's parent."), rel(2, "my dad", "The owner's dad lives in Leeds."), rel(3, "my father", "The owner's father loves fishing.")];
    const death = mem(4, { subjectId: eid("dad"), predicate: "person.life", value: { kind: "enum", code: "deceased" }, args: { detail: null }, sens: "S2", ...say("The owner's dad died.", [eid("dad")]) });
    const before = compileHead(input(lines));
    const after = compileHead(input([...lines, death]));
    if (!before.ok || !after.ok) throw new Error("compile failed");
    const where = (r: typeof after, n: number) => r.lines.find((l) => l.ref?.id === testId(`m${n}`))?.section;
    expect([where(before, 1), where(before, 2), where(before, 3)]).toEqual(["people", "people", "people"]);
    expect([where(after, 1), where(after, 2), where(after, 3)]).toEqual(["know", "know", "people"]);
    // The S2 death line itself never renders, and the join adds no text.
    expect(after.head.text).not.toContain("died");
  });

  it("reads only a current life row: a death in history or marked wrong keeps dad in people", () => {
    for (const status of ["history", "wrong"] as const) {
      const death = mem(4, { subjectId: eid("dad"), predicate: "person.life", value: { kind: "enum", code: "deceased" }, args: { detail: null }, status, ...say("The owner's dad died.", [eid("dad")]) });
      const r = compileHead(input([rel(1, "Dad", "Dad is the owner's parent."), death]));
      if (!r.ok) throw new Error("compile failed");
      expect(r.lines.find((l) => l.ref?.id === testId("m1"))?.section).toBe("people");
    }
  });
});
