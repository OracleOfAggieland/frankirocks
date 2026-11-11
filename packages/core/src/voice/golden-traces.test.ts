// The golden corpus of the voice reducer (brief 014, A3): fixed-seed calls, one digest per call of every step's
// event, time, commands and outward views (testing/golden.ts). A refactor leaves every digest equal. A fix or a
// generator change re-records in the same commit and says how many calls moved and why:
//   VOICE_GOLDEN=record npx vitest run packages/core/src/voice/golden-traces.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbCall, runCall } from "./testing/arb-call";
import { arbWideCall, runWideCall } from "./testing/arb-call-wide";
import { type Corpus, type CorpusSpec, type GoldenFile, corpusDiff, goldenFileText, recordCorpus } from "./testing/golden";

const FIXTURE = fileURLToPath(new URL("./testing/golden-traces.json", import.meta.url));
const RECORD = process.env.VOICE_GOLDEN === "record";

/** The corpora, by name. Seeds and sizes are part of the corpus: changing them is a re-record. */
const SPECS: Record<string, CorpusSpec<any>> = {
  arbCall: { generator: "arbCall", arbitrary: arbCall, seeds: [101, 202, 303, 404, 505], perSeed: 120, play: (steps) => runCall(steps).trace },
  arbCallWide: { generator: "arbWideCall", arbitrary: arbWideCall, seeds: [11, 22, 33, 44, 55], perSeed: 100, play: (steps) => runWideCall(steps).trace },
};

const now: Record<string, Corpus> = {};
const corpus = (name: string): Corpus => (now[name] ??= recordCorpus(SPECS[name]!));

if (RECORD) {
  const file: GoldenFile = { fastCheck: fc.__version, corpora: Object.fromEntries(Object.keys(SPECS).map((name) => [name, corpus(name)])) };
  writeFileSync(FIXTURE, goldenFileText(file));
}
const recorded: GoldenFile = JSON.parse(readFileSync(FIXTURE, "utf8")) as GoldenFile;

describe("golden corpus of the voice reducer", () => {
  it("was recorded with this fast-check version (a bump may change what a seed generates: re-record alone)", () => {
    expect(recorded.fastCheck).toBe(fc.__version);
  });

  it("holds every corpus and only those", () => {
    expect(Object.keys(recorded.corpora).sort()).toEqual(Object.keys(SPECS).sort());
  });

  for (const name of Object.keys(SPECS)) {
    it(`${name}: at least 500 calls, each equal to its recorded digest`, () => {
      const was = recorded.corpora[name];
      expect(was, `no recorded corpus ${name}`).toBeDefined();
      const spec = SPECS[name]!;
      expect({ seeds: was!.seeds, perSeed: was!.perSeed, generator: was!.generator }).toEqual({ seeds: [...spec.seeds], perSeed: spec.perSeed, generator: spec.generator });
      const c = corpus(name);
      expect(c.calls.length).toBeGreaterThanOrEqual(500);
      const moved = corpusDiff(was!, c);
      expect(moved.length, `${moved.length} of ${c.calls.length} calls moved; first: ${moved.slice(0, 10).join(", ")}`).toBe(0);
    });
  }
});
