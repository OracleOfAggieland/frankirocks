import { MemoryResponse, validate } from "@franki/core";
import { describe, expect, it } from "vitest";
import { FIXTURE_MEMORY, FIXTURE_SNAPSHOT } from "../app/specimens/_fixtures/memory";
import { COPY } from "./copy";
import { NO_SURFACES, goneAskCard, jarMotes, labProps, memorySurfaces, readoutCard, receiptProps, stripProps } from "./memory-screen";

const noop = () => {};

describe("memory screen view-model (brief 020)", () => {
  it("the specimen's fixture answers are valid MemoryResponses", () => {
    for (const r of Object.values(FIXTURE_MEMORY)) expect(validate(MemoryResponse, r).ok).toBe(true);
  });

  it("nothing read: every surface renders nothing", () => {
    expect(memorySurfaces({ overview: null, lab: null, strip: null, receipt: null })).toEqual(NO_SURFACES);
    expect(jarMotes(null)).toEqual([]);
    expect(labProps(null)).toBeNull();
    expect(stripProps(null)).toBeNull();
    expect(receiptProps([])).toBeNull();
  });

  it("jar: one told mote per card, one per guess, one per private thing", () => {
    const motes = jarMotes(FIXTURE_SNAPSHOT);
    expect(motes.filter((m) => m.kind === "told")).toHaveLength(4);
    expect(motes.filter((m) => m.kind === "guessed")).toHaveLength(3);
    expect(motes.filter((m) => m.kind === "private")).toHaveLength(1);
    expect(motes.filter((m) => m.kind === "rule")).toHaveLength(0);
    expect(jarMotes(FIXTURE_SNAPSHOT, 2).filter((m) => m.kind === "rule").map((m) => m.id)).toEqual(["rule-0", "rule-1"]);
    expect(new Set(motes.map((m) => m.id)).size).toBe(motes.length);
  });

  it("Lab: the three counters of spec §15, an uncounted number as not counted, known limits in words", () => {
    const lab = labProps(FIXTURE_MEMORY.lab.lab)!;
    expect(lab.counters).toEqual([
      { id: "read", label: COPY.memory.lab.read, value: 128 },
      { id: "guessed", label: COPY.memory.lab.guessed, value: 3 },
      { id: "said", label: COPY.memory.lab.said, value: 0 },
    ]);
    expect(lab.limits).toEqual([COPY.memory.lab.floorRecall]);
    const uncounted = labProps({ ...FIXTURE_MEMORY.lab.lab!, limits: ["uncounted:readEmails"] })!;
    expect(uncounted.counters[0]!.value).toBeNull();
  });

  it("strip: open while a loop has steps, filled to the first pending step", () => {
    expect(stripProps(FIXTURE_MEMORY.strip.strip)).toEqual({ open: true, filled: 4, resultLabel: COPY.memory.stripResult });
    expect(stripProps({ loopId: null, steps: [] })).toBeNull();
  });

  it("strip: a compared loop shows its fall as the last step's label (brief 030 P1-4)", () => {
    const steps = FIXTURE_MEMORY.strip.strip!.steps.map((x) => ({ ...x, state: "complete" as const }));
    const compared = { ...FIXTURE_MEMORY.strip.strip!, steps: steps.map((x) => (x.kind === "comparison" ? { ...x, label: "$115 less on takeout." } : x)) };
    expect(stripProps(compared)).toEqual({ open: true, filled: 5, resultLabel: "$115 less on takeout." });
    expect(stripProps({ ...compared, steps })).toMatchObject({ filled: 5, resultLabel: COPY.memory.stripResult });
  });

  it("receipt: kinds and counts only, and only once blocked or cleaned", () => {
    expect(receiptProps(FIXTURE_MEMORY.receipt.items)).toEqual({
      blocked: true,
      cleaned: true,
      kept: [{ kind: "safety rule", count: 1 }],
      touched: [
        { kind: "conversation turns", count: 1 },
        { kind: "memories", count: 1 },
      ],
    });
    const item = FIXTURE_MEMORY.receipt.items[0]!;
    expect(receiptProps([{ ...item, status: "pending" }])).toBeNull();
    expect(receiptProps([{ ...item, body: "not json" }])).toBeNull();
    expect(receiptProps([{ ...item, body: JSON.stringify({ retainedRules: -1, scopePending: false, touched: [] }) }])).toBeNull();
  });

  it("readout card: recent told lines first, each line once", () => {
    const c = readoutCard([FIXTURE_SNAPSHOT], noop);
    expect(c.kind).toBe("read");
    if (c.kind !== "read") return;
    expect(c.lines).toEqual(["fact: Biscuit has surgery Thursday", "fact: I work at the bakery", "fact: My dog is called Pip", "fact: I took a gap year after school"]);
    const empty = readoutCard([], noop);
    expect(empty.kind === "read" && empty.lines).toEqual([COPY.memory.readout.empty]);
  });

  it("readout card: carries Close only when the host gives one", () => {
    expect(readoutCard([FIXTURE_SNAPSHOT], noop)).not.toHaveProperty("onClose");
    const onClose = () => {};
    expect(readoutCard([FIXTURE_SNAPSHOT], noop, onClose)).toHaveProperty("onClose", onClose);
  });

  it("gone ask: Yes and No, neither chosen for the owner", () => {
    const answers: string[] = [];
    const c = goneAskCard((a) => answers.push(a), noop);
    expect(c.kind).toBe("ask");
    if (c.kind !== "ask") return;
    expect(c.question).toBe("Did you want that deleted?");
    expect(c.options.map((o) => o.label)).toEqual(["Yes", "No"]);
    c.onAnswer("yes");
    c.onAnswer("no");
    expect(answers).toEqual(["yes", "no"]);
  });
});
