// The extraction check (brief 012 task A10b): the frozen lines stay frozen, copy no probe line, and a fake run
// exits 0. The judging runs on the extractor's own planItem, so these cases use answers that plan for real.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { closeCopies, probeTexts } from "../close-copy.mjs";
import { type CheckLine, LINES_SHA256, type CheckRun, judgeLine, lineSetup, linesHash, main, parseLines } from "./check";

const LINES_URL = new URL("./lines.json", import.meta.url);
const text = readFileSync(LINES_URL, "utf8");
const lines = parseLines(text);
const line = (id: string): CheckLine => lines.find((l) => l.id === id)!;

const whenNone = { kind: "none", spoken: null, appliesTo: "occurrence", anchorHint: null };
const spanOf = (l: CheckLine, words: string) => {
  const { packet } = lineSetup(l);
  const start = l.text.indexOf(words);
  return { eid: packet.fields[0]!.eid, fieldPath: "text", start, end: start + words.length, quote: words };
};
/** An ExtractV1 Item, flat as parseExtractOutput returns it. */
function item(l: CheckLine, over: Record<string, unknown>, quote: string) {
  return {
    act: "statement",
    target: "new",
    memoryId: null,
    kind: "fact",
    predicate: "fact",
    subject: "self",
    scope: null,
    value: { kind: "text", text: "x" },
    args: {},
    mentions: [],
    bindings: [],
    contextIds: [],
    when: whenNone,
    endHint: null,
    changes: [],
    texture: [],
    spans: [spanOf(l, quote)],
    sens: "S0",
    gravity: 0,
    authorize: null,
    flow: "open",
    deliveryRequest: null,
    ...over,
  };
}
const answered = (items: unknown[]) => ({ ok: true as const, items, ms: 10 });

describe("extraction check, frozen lines (brief 012 task A10b)", () => {
  it("lines.json is the pinned file, so a relabel fails here", () => {
    expect(linesHash(text)).toBe(LINES_SHA256);
    expect(linesHash(text.replace(/\n/g, "\r\n"))).toBe(LINES_SHA256);
    expect(linesHash(text.replace('"status": "held"', '"status": "active"'))).not.toBe(LINES_SHA256);
  });

  it("holds 30 well-formed lines: 8 allergy, 6 correction, 8 life change, 8 ordinary or near miss", () => {
    const count = (...c: string[]) => lines.filter((l) => c.includes(l.class)).length;
    expect([lines.length, count("allergy"), count("correction"), count("lifeChange"), count("ordinary", "nearMiss")]).toEqual([30, 8, 6, 8, 8]);
    expect(() => parseLines(text.replace('"names": null', '"names": null, "extra": 1'))).toThrow(/unknown extra/);
  });

  it("no line copies a judge-spike probe line", () => {
    const probes = probeTexts();
    for (const l of lines) expect(closeCopies(l.text, probes)).toEqual([]);
  });
});

describe("extraction check, judging an answer", () => {
  it("an allergy the extractor holds meets the allergy line", () => {
    const l = line("x-allergy-1");
    const r = judgeLine(l, answered([item(l, { act: "hard_rule", predicate: "allergy", kind: "rule", value: { kind: "text", text: "sesame" } }, "allergic to sesame")]));
    expect(r).toMatchObject({ pass: true, plans: ["hold"], missing: [], forbidden: [] });
    expect(judgeLine(l, answered([])).missing).toEqual([0]);
  });

  it("an allergy put on the wrong person breaks the neverWrites", () => {
    const l = line("x-allergy-2");
    const r = judgeLine(l, answered([item(l, { act: "hard_rule", predicate: "allergy", kind: "rule", value: { kind: "text", text: "eggs" } }, "can't eat eggs")]));
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual([0]);
    expect(r.forbidden).toEqual([0]);
  });

  it("a correction writes the new row and marks the prior wrong; a change on the same line breaks it", () => {
    const l = line("x-correct-1");
    const target = lineSetup(l).packet.open[0]!.id;
    const said = (verb: "correct" | "transition", act: string) =>
      item(
        l,
        {
          act,
          predicate: "person.relation",
          kind: "fact",
          value: { kind: "enum", code: "sister" },
          args: { otherRef: "m1", label: "sister", employerRef: null },
          mentions: [{ localId: "m1", type: "person", observedName: "Mara", span: spanOf(l, "Mara"), existingId: null }],
          changes: [{ verb, targetMid: target }],
        },
        "my sister is called Mara",
      );
    expect(judgeLine(l, answered([said("correct", "correction")]))).toMatchObject({ pass: true, plans: ["memory"] });
    const changed = judgeLine(l, answered([said("transition", "transition")]));
    expect(changed).toMatchObject({ pass: false, missing: [1], forbidden: [0] });
  });

  it("a failed call writes nothing: it passes only a line that expects no write", () => {
    expect(judgeLine(line("x-plain-1"), { ok: false, error: "refusal", ms: 5 })).toMatchObject({ pass: true, result: "failed", error: "refusal" });
    expect(judgeLine(line("x-change-1"), { ok: false, error: "refusal", ms: 5 }).pass).toBe(false);
  });
});

describe("extraction check, the run", () => {
  it("a fake run reaches no network, writes its file under dist, and exits 0", async () => {
    const d = mkdtempSync(join(tmpdir(), "extract-check-"));
    try {
      copyFileSync(LINES_URL, join(d, "lines.json"));
      const logs: string[] = [];
      expect(await main([], { dir: d, env: {}, log: (s) => logs.push(s) })).toBe(0);
      expect(logs).toContain("extract-check: 9 of 30 lines pass (fake port: this counts the lines that expect no write, nothing more)");
      const out = join(d, "dist", "dry-run");
      const run = JSON.parse(readFileSync(join(out, readdirSync(out)[0]!), "utf8")) as CheckRun;
      expect(run).toMatchObject({ port: "fake", linesSha256: LINES_SHA256, passed: 9 });
      expect(run.rows).toHaveLength(30);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("refuses a changed lines file, an unknown flag, and a live run with no settings", async () => {
    const d = mkdtempSync(join(tmpdir(), "extract-check-"));
    try {
      const logs: string[] = [];
      const log = (s: string) => logs.push(s);
      writeFileSync(join(d, "lines.json"), text.replace('"status": "held"', '"status": "active"'));
      expect(await main([], { dir: d, env: {}, log })).toBe(2);
      expect(logs.at(-1)).toMatch(/refusing: lines.json is not the frozen file/);
      copyFileSync(LINES_URL, join(d, "lines.json"));
      expect(await main(["--fast"], { dir: d, env: {}, log })).toBe(2);
      expect(await main(["--live"], { dir: d, env: {}, log })).toBe(2);
      expect(logs.at(-1)).toMatch(/can't start a live run/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
