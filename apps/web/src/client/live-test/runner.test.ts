import { describe, expect, it } from "vitest";
import { BUILT_IN_SCRIPT, type Script, ago, initialRunner, keyAction, parseScript, restoreRunner, applyRunnerAction, tally } from "./runner";

const SCRIPT: Script = {
  title: "T",
  steps: [
    { id: "A1", title: "One" },
    { id: "A2", title: "Two" },
    { id: "A3", title: "Three" },
  ],
};

describe("the runner's script", () => {
  it("reads a script and drops steps without an ID or title, and repeats", () => {
    const s = parseScript({
      title: "Session",
      steps: [{ id: "B2", group: "Voice", title: "Interrupt", do: ["a", 3, ""], say: ["b"], watch: [], account: "test" }, { id: "B2", title: "again" }, { title: "no id" }, null],
    });
    expect(s).toEqual({ title: "Session", steps: [{ id: "B2", group: "Voice", title: "Interrupt", do: ["a"], say: ["b"], account: "test" }] });
    expect(parseScript(null)).toBeNull();
    expect(parseScript({ steps: [] })).toBeNull();
    expect(parseScript({ steps: [{ id: "X", title: "Y" }] })!.title).toBe("Live test");
  });

  it("has a built-in script that parses", () => {
    expect(parseScript(BUILT_IN_SCRIPT)).toEqual(BUILT_IN_SCRIPT);
  });
});

describe("the runner's steps", () => {
  it("starts, passes and moves on, posting step.start and step.end", () => {
    let s = initialRunner(SCRIPT);
    let r = applyRunnerAction(SCRIPT, s, { type: "start" });
    expect(r.posts).toEqual([{ kind: "step.start", step: "A1", title: "One" }]);
    s = r.state;
    expect(s.running).toBe("A1");
    // A second start of a running step posts nothing.
    expect(applyRunnerAction(SCRIPT, s, { type: "start" }).posts).toEqual([]);
    r = applyRunnerAction(SCRIPT, s, { type: "end", result: "pass" });
    expect(r.posts).toEqual([{ kind: "step.end", step: "A1", result: "pass" }]);
    s = r.state;
    expect(s).toMatchObject({ index: 1, running: null, results: { A1: "pass" } });
  });

  it("skips past steps that have a result, stays on the last, and goes back", () => {
    let s = initialRunner(SCRIPT);
    s = applyRunnerAction(SCRIPT, s, { type: "go", index: 1 }).state;
    s = applyRunnerAction(SCRIPT, s, { type: "end", result: "fail" }).state;
    expect(s.index).toBe(2);
    s = applyRunnerAction(SCRIPT, s, { type: "end", result: "skip" }).state;
    expect(s.index).toBe(2);
    s = applyRunnerAction(SCRIPT, s, { type: "go", index: 0 }).state;
    s = applyRunnerAction(SCRIPT, s, { type: "end", result: "pass" }).state;
    expect(s.index).toBe(1);
    s = applyRunnerAction(SCRIPT, s, { type: "back" }).state;
    s = applyRunnerAction(SCRIPT, s, { type: "back" }).state;
    expect(s.index).toBe(0);
    expect(tally(SCRIPT, s)).toEqual({ pass: 1, fail: 1, skip: 1, open: 0 });
    expect(applyRunnerAction(SCRIPT, s, { type: "go", index: 9 }).state).toBe(s);
  });

  it("counts notes per step", () => {
    let s = initialRunner(SCRIPT);
    s = applyRunnerAction(SCRIPT, s, { type: "noted" }).state;
    s = applyRunnerAction(SCRIPT, s, { type: "noted" }).state;
    expect(s.notes).toEqual({ A1: 2 });
  });

  it("restores results for the same script only", () => {
    let s = initialRunner(SCRIPT);
    s = applyRunnerAction(SCRIPT, s, { type: "start" }).state;
    s = applyRunnerAction(SCRIPT, s, { type: "end", result: "pass" }).state;
    const stored = JSON.parse(JSON.stringify(s));
    expect(restoreRunner(SCRIPT, stored)).toEqual(s);
    const other: Script = { title: "T", steps: [{ id: "Z1", title: "Z" }] };
    expect(restoreRunner(other, stored)).toEqual(initialRunner(other));
    expect(restoreRunner(SCRIPT, { ...stored, index: 99, results: { A1: "maybe", A2: "fail" }, running: "nope" })).toMatchObject({ index: 0, results: { A2: "fail" }, running: null });
    expect(restoreRunner(SCRIPT, "junk")).toEqual(initialRunner(SCRIPT));
  });
});

describe("the runner's keys", () => {
  it("maps Enter, F, S, N, B and M outside text fields", () => {
    const k = (key: string) => keyAction(key, { inText: false, modifier: false });
    expect([k("Enter"), k("f"), k("F"), k("s"), k("n"), k("b"), k("Backspace"), k("m"), k("x")]).toEqual(["startOrPass", "fail", "fail", "skip", "note", "back", "back", "mark", null]);
  });

  it("leaves typing and shortcuts to the browser", () => {
    expect(keyAction("f", { inText: true, modifier: false })).toBeNull();
    expect(keyAction("Enter", { inText: true, modifier: false })).toBeNull();
    expect(keyAction("s", { inText: false, modifier: true })).toBeNull();
  });

  it("says how long ago", () => {
    expect([ago(null), ago(400), ago(12_000), ago(5 * 60_000), ago(3 * 3_600_000)]).toEqual(["never", "just now", "12 s ago", "5 min ago", "3 h ago"]);
  });
});
