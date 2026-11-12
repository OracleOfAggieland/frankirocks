import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTENT_NAMES, MAX_QUESTIONS, OPENS_INSTRUCTION, PREDICATE_INSTRUCTIONS, TURN_INTENTS_PREFIX } from "./classes";
import { buildTurnIntents, turnIntentsQuestions } from "./request";

const CONTRACTS = readFileSync(new URL("../../../../docs/design/memory-contracts-v2.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SECTION = CONTRACTS.slice(CONTRACTS.indexOf("### TurnIntents"), CONTRACTS.indexOf("### FastSlotsV1"));

describe("TurnIntents literals", () => {
  it("the prefix is the contracts §5 literal", () => {
    const fence = /Developer prefix once:\n```\n([\s\S]*?)\n```/.exec(SECTION);
    expect(TURN_INTENTS_PREFIX).toBe(fence![1]);
  });

  it("every predicate instruction is the contracts §5 row, in row order", () => {
    const rows = [...SECTION.matchAll(/^\|(\w+(?:_\{topicId\})?)\|(.+)\|$/gm)].map((m) => [m[1], m[2]]).filter(([n]) => n !== "Name" && n !== "---");
    const fixed = rows.filter(([n]) => !n!.startsWith("opens_"));
    expect(fixed.map(([n]) => n)).toEqual([...INTENT_NAMES]);
    for (const [n, text] of fixed) expect(PREDICATE_INSTRUCTIONS[n as (typeof INTENT_NAMES)[number]]).toBe(text);
    expect(rows.find(([n]) => n!.startsWith("opens_"))![1]).toBe(OPENS_INSTRUCTION);
  });
});

describe("buildTurnIntents", () => {
  it("sends the prefix once as a developer message and the owner's words as data", () => {
    const r = buildTurnIntents({ utterance: "My dog Pip loves the park.", lastQuestion: null, doors: [] }, "model-x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.model).toBe("model-x");
    expect(r.body.input).toEqual([
      { role: "developer", content: TURN_INTENTS_PREFIX },
      { role: "user", content: "Last question (data): none\nOwner said (data): My dog Pip loves the park." },
    ]);
    expect(r.body.questions).toHaveLength(14);
    expect(r.body.questions.every((q) => q.type === "predicate")).toBe(true);
    expect(r.body.questions.map((q) => q.name)).toEqual([...INTENT_NAMES]);
  });

  it("adds one opens row per door, at most 22 questions", () => {
    const doors = Array.from({ length: 8 }, (_, i) => ({ topicId: `t${i}`, label: "x", terms: [] }));
    expect(turnIntentsQuestions(doors)).toHaveLength(MAX_QUESTIONS);
    expect(turnIntentsQuestions(doors)[14]).toEqual({ type: "predicate", name: "opens_t0", instructions: OPENS_INSTRUCTION });
    expect(buildTurnIntents({ utterance: "hi", lastQuestion: null, doors: [...doors, doors[0]!] }, "m")).toEqual({ ok: false, why: "invalidInput" });
  });

  it("refuses rather than truncates over 2,400 code units", () => {
    const room = 2_400 - TURN_INTENTS_PREFIX.length;
    expect(buildTurnIntents({ utterance: "a".repeat(room), lastQuestion: null, doors: [] }, "m").ok).toBe(true);
    expect(buildTurnIntents({ utterance: "a".repeat(room + 1), lastQuestion: null, doors: [] }, "m")).toEqual({ ok: false, why: "oversize" });
    expect(buildTurnIntents({ utterance: "a".repeat(room - 2), lastQuestion: "abc", doors: [] }, "m")).toEqual({ ok: false, why: "oversize" });
  });

  it("refuses an empty utterance or model", () => {
    expect(buildTurnIntents({ utterance: "  ", lastQuestion: null, doors: [] }, "m").ok).toBe(false);
    expect(buildTurnIntents({ utterance: "hi", lastQuestion: null, doors: [] }, "").ok).toBe(false);
  });
});
