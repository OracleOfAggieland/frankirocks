/**
 * The golden corpus of the voice reducer (brief 014, A3). Plain module, test-only.
 *
 * A corpus is a fixed list of generated calls, each played through `step` by a driver and reduced to one digest
 * of every step it took: the event, the time, the commands in order and the outward views other code reads
 * (`phase`, `avatarState`, `callButton`, `muteVisible`, `micMuted`, `error`, `retryVisible`, `stateRetryVisible`).
 * A refactor of the reducer or of a generator leaves every digest equal. A change that moves a digest is a fix or a
 * generator change, and re-records the corpus in the same commit, saying how many calls moved and why.
 *
 * Determinism: the calls come from fixed seeds; the driver takes its time from the steps and its IDs from a
 * counter; the serialiser sorts object keys and drops `undefined` (as JSON does), so neither key insertion order nor
 * object identity reaches a digest. The fixture records the fast-check version, since a fast-check bump may change
 * what a seed generates.
 */
import fc from "fast-check";
import { avatarState, callButton, muteVisible, type VoiceState } from "../machine";
import type { Trace } from "./arb-call";

/** JSON with object keys sorted by UTF-16 code units and `undefined` members dropped; arrays keep their order. */
export function stableJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (value === undefined || typeof value === "function") return "null";
    if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableJSON(v))).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJSON(o[k])}`).join(",")}}`;
}

/** The outward views of a state: what the screen, the avatar and the call controls read. */
export function outwardView(st: VoiceState) {
  return {
    phase: st.phase,
    avatarState: avatarState(st),
    callButton: callButton(st),
    muteVisible: muteVisible(st),
    micMuted: st.micMuted,
    error: st.error,
    retryVisible: st.retryVisible,
    stateRetryVisible: st.stateRetryVisible,
  };
}

/** Two 32-bit FNV-1a passes over the UTF-16 code units, as 16 hex digits. */
class Digest {
  private a = 0x811c9dc5;
  private b = 0x811c9dc5 ^ 0x5bd1e995;
  add(text: string): void {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x01000193) >>> 0;
    }
    // A separator, so the step boundaries are part of what is hashed.
    this.a = Math.imul(a ^ 0x1e, 0x01000193) >>> 0;
    this.b = Math.imul(b ^ 0x1f, 0x01000193) >>> 0;
  }
  hex(): string {
    return this.a.toString(16).padStart(8, "0") + this.b.toString(16).padStart(8, "0");
  }
}

/** One call's digest: every step's event, time, commands and outward views, in order. */
export function traceDigest(trace: Trace): string {
  const d = new Digest();
  for (const s of trace.steps) d.add(stableJSON({ event: s.event, now: s.now, commands: s.commands, view: outwardView(s.after) }));
  return d.hex();
}

export interface CorpusSpec<T> {
  /** The generator's name, as the fixture records it. */
  generator: string;
  arbitrary: fc.Arbitrary<T>;
  seeds: readonly number[];
  perSeed: number;
  /** Plays one generated call and returns its trace. */
  play: (call: T) => Trace;
}

export interface Corpus {
  generator: string;
  seeds: number[];
  perSeed: number;
  /** One entry per call, seed by seed: the digest and the number of steps the call took. */
  calls: [string, number][];
}

export function recordCorpus<T>(spec: CorpusSpec<T>): Corpus {
  const calls: [string, number][] = [];
  for (const seed of spec.seeds) {
    for (const call of fc.sample(spec.arbitrary, { seed, numRuns: spec.perSeed })) {
      const trace = spec.play(call);
      calls.push([traceDigest(trace), trace.steps.length]);
    }
  }
  return { generator: spec.generator, seeds: [...spec.seeds], perSeed: spec.perSeed, calls };
}

/** The indexes of the calls whose digest or step count differs from the recorded corpus. */
export function corpusDiff(recorded: Corpus, now: Corpus): number[] {
  const out: number[] = [];
  const n = Math.max(recorded.calls.length, now.calls.length);
  for (let i = 0; i < n; i++) {
    const a = recorded.calls[i];
    const b = now.calls[i];
    if (a === undefined || b === undefined || a[0] !== b[0] || a[1] !== b[1]) out.push(i);
  }
  return out;
}

export interface GoldenFile {
  /** The fast-check version the corpora were recorded with. */
  fastCheck: string;
  corpora: Record<string, Corpus>;
}

/** The fixture text: one call per line, so a re-record shows as a readable diff. */
export function goldenFileText(file: GoldenFile): string {
  const lines: string[] = ["{", `  "fastCheck": ${JSON.stringify(file.fastCheck)},`, `  "corpora": {`];
  const names = Object.keys(file.corpora).sort();
  names.forEach((name, n) => {
    const c = file.corpora[name]!;
    lines.push(`    ${JSON.stringify(name)}: {`);
    lines.push(`      "generator": ${JSON.stringify(c.generator)},`);
    lines.push(`      "seeds": ${JSON.stringify(c.seeds)},`);
    lines.push(`      "perSeed": ${c.perSeed},`);
    lines.push(`      "calls": [`);
    c.calls.forEach((call, i) => lines.push(`        ${JSON.stringify(call)}${i === c.calls.length - 1 ? "" : ","}`));
    lines.push("      ]");
    lines.push(`    }${n === names.length - 1 ? "" : ","}`);
  });
  lines.push("  }", "}", "");
  return lines.join("\n");
}
