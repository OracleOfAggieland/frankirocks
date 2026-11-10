import { describe, expect, it } from "vitest";
import { CONTROL_CLASSES, MAX_WORDS, lineSetHash, loadLines, parseLines, wordCount } from "./lines";

/**
 * The frozen line set. Changing this pin means a label, a text or a probe flag changed: that goes in its own
 * commit that says why, before the run it affects (brief 006 item 2; spec §13).
 */
const PINNED = "f66415403ae699493a45cac187f42eff42a653305017c9feafc4a7d362d99adb";

const lines = loadLines();
const control = lines.filter((l) => l.expect === "hold");
const ordinary = lines.filter((l) => l.expect === "ordinary");

describe("judge spike lines", () => {
  it("is the frozen set", () => expect(lineSetHash(lines)).toBe(PINNED));

  it("has 30 control lines, 5 in each of the six classes", () => {
    expect(control).toHaveLength(30);
    for (const c of CONTROL_CLASSES) expect(control.filter((l) => l.class === c), c).toHaveLength(5);
  });

  it("has 30 ordinary lines with at least 8 near-misses", () => {
    expect(ordinary).toHaveLength(30);
    expect(ordinary.filter((l) => l.class === "nearMiss").length).toBeGreaterThanOrEqual(8);
  });

  it("marks exactly the first 15 ordinary lines as latency probes", () => {
    expect(lines.filter((l) => l.probe).map((l) => l.id)).toEqual(ordinary.slice(0, 15).map((l) => l.id));
  });

  it("keeps the judge literal's own cases", () => {
    const notes = control.map((l) => l.note ?? "");
    expect(notes.some((n) => n.includes("negation"))).toBe(true);
    expect(notes.some((n) => n.includes("buried"))).toBe(true);
    expect(control.some((l) => l.text.startsWith("Don't let me forget to"))).toBe(true);
  });

  it("keeps every line to one breath", () => {
    for (const l of lines) expect(wordCount(l.text), l.id).toBeLessThanOrEqual(MAX_WORDS);
  });

  it("rejects a control class labelled ordinary, and unknown keys", () => {
    const bad = (line: object) => () => parseLines(JSON.stringify({ lines: [line] }));
    expect(bad({ id: "c-forget-1", text: "Delete that.", class: "forget", expect: "ordinary", probe: false })).toThrow(/disagree/);
    expect(bad({ id: "o-01", text: "Hi.", class: "smallTalk", expect: "ordinary", probe: true, score: 1 })).toThrow(/unknown keys/);
  });
});
