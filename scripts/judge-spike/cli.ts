/**
 * The judge spike's command line (brief 006 items 3 and 4). Run through run.mjs, which bundles this file with
 * esbuild and calls `main`. Nothing here reaches the network without `--live`.
 *
 *   synth [--live] [--lines id,id]    synthetic audio through text-to-speech
 *   harness [--source synthetic|owner] [--live] [--lines id,id] [--max-tokens n|inf] [--effort value] [--seed n]
 *                                     the judge measurement; without --live it runs the whole flow against the
 *                                     fake transport. The judge defaults to no output cap and effort minimal; the
 *                                     lines run in a fixed seeded order (default seed 7), up to 30 per session.
 *                                     Each take's trailing silence is trimmed before it is streamed (trim.ts);
 *                                     a take with no speech is refused before connecting.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JUDGE_EFFORTS, type JudgeOutputCap, type JudgeSettings, isJudgeEffort, isJudgeOutputCap, isSpikeFormat, parseWav } from "@franki/core";
import { MODEL_VARS, requireModel } from "../../packages/server/src/config/models";
import { requireEnv } from "../../packages/server/src/config/env";
import { type HarnessClock, liveClock, wallDateIso } from "./clock";
import { fakeConnect, placeholderPcm } from "./fake-realtime";
import { DEFAULT_SEED, MAX_RUN_LINES, NO_SPEECH, SPIKE_JUDGE_SETTINGS, runHarness, silentTakes } from "./harness";
import { type ProbeLine, lineSetHash, loadLines } from "./lines";
import { AUDIO_SOURCES, type AudioSource, audioDir, linesFile, resultsDir, wavPath } from "./paths";
import { type Connect, liveConnect } from "./realtime";
import { runFile, summaryMarkdown } from "./summary";
import { manifestText, synthPlan, synthesize } from "./synth";
import { KEEP_AFTER_MS, SPEECH_RMS_THRESHOLD, trimTail } from "./trim";
import { VirtualClock } from "./virtual-clock";

export interface CliContext {
  spikeDir: string;
  env: Readonly<Record<string, string | undefined>>;
  log: (line: string) => void;
  /** Tests replace the live WebSocket; the CLI uses it only with --live. */
  liveConnect?: Connect;
}

export interface Flags {
  live: boolean;
  lines: string[] | null;
  values: Record<string, string>;
}

/** `--live`, `--lines a,b` and `--name value` flags. Unknown positional words are an error. */
export function parseFlags(args: readonly string[]): Flags {
  const flags: Flags = { live: false, lines: null, values: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--live") flags.live = true;
    else if (a.startsWith("--") && i + 1 < args.length && !args[i + 1]!.startsWith("--")) {
      const name = a.slice(2);
      const value = args[++i]!;
      if (name === "lines") flags.lines = value.split(",").map((s) => s.trim()).filter((s) => s !== "");
      else flags.values[name] = value;
    } else throw new Error(`unknown argument ${a}`);
  }
  return flags;
}

/** The chosen lines, in file order. Throws on an unknown ID. */
export function selectLines(all: readonly ProbeLine[], ids: string[] | null): ProbeLine[] {
  if (ids === null) return [...all];
  const known = new Set(all.map((l) => l.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) throw new Error(`unknown line IDs: ${unknown.join(", ")}`);
  const wanted = new Set(ids);
  return all.filter((l) => wanted.has(l.id));
}

async function synthCommand(flags: Flags, ctx: CliContext): Promise<number> {
  const all = loadLines(linesFile(ctx.spikeDir));
  const lines = selectLines(all, flags.lines);
  const outDir = audioDir(ctx.spikeDir, "synthetic");
  // Voices are assigned over the whole set, so a line keeps its voice when only some lines are made.
  const chosen = new Set(lines.map((l) => l.id));
  const plan = synthPlan(all, (id) => wavPath(ctx.spikeDir, "synthetic", id)).filter((p) => chosen.has(p.id));
  const chars = lines.reduce((n, l) => n + l.text.length, 0);
  ctx.log(`synth: ${lines.length} lines, ${chars} characters, ${new Set(plan.map((p) => p.voice)).size} voices, into ${outDir}`);
  if (!flags.live) {
    for (const p of plan) ctx.log(`  ${p.id}: ${p.voice}`);
    ctx.log("synth: dry run, nothing sent. Add --live to call text-to-speech.");
    return 0;
  }
  const model = requireModel("tts", ctx.env);
  const apiKey = requireEnv("OPENAI_API_KEY", ctx.env);
  ctx.log(`synth: model from ${MODEL_VARS.tts}`);
  const result = await synthesize(lines, plan, { model, apiKey, outDir }, {
    fetch: (url, init) => fetch(url, init),
    writeFile: (path, bytes) => writeFileSync(path, bytes),
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    log: ctx.log,
  });
  const manifestPath = join(outDir, "manifest.json");
  const earlier = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { voices?: Record<string, string> }).voices ?? {} : {};
  const merged = [...Object.entries(earlier).filter(([id]) => !result.written.some((w) => w.id === id)).map(([id, voice]) => ({ id, voice, path: "" })), ...result.written];
  writeFileSync(manifestPath, manifestText(merged, model));
  ctx.log(`synth: wrote ${result.written.length}, failed ${result.failed.length}`);
  return result.failed.length === 0 ? 0 : 1;
}

/** The commit that last changed lines.json, and whether the file has uncommitted changes. Local git only. */
export function lineSetCommit(spikeDir: string): { commit: string; dirty: boolean } {
  const git = (args: string[]) => execFileSync("git", args, { cwd: spikeDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { commit: git(["log", "-1", "--format=%H", "--", "lines.json"]) || "uncommitted", dirty: git(["status", "--porcelain", "--", "lines.json"]) !== "" };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

/** Reads one take; returns its PCM or why it cannot be used. */
function readTake(path: string): Uint8Array | string {
  if (!existsSync(path)) return "missing";
  const w = parseWav(new Uint8Array(readFileSync(path)));
  if ("problem" in w) return w.problem;
  if (!isSpikeFormat(w)) return `not 24 kHz mono 16-bit (${w.sampleRate} Hz, ${w.channels} ch, ${w.bitsPerSample} bit)`;
  return w.pcm;
}

/** `--max-tokens <n|inf>` and `--effort <value>`; the spike's defaults are no cap and `minimal`. */
export function judgeSettings(values: Readonly<Record<string, string>>): JudgeSettings {
  const rawCap = values["max-tokens"];
  let maxOutputTokens: JudgeOutputCap = SPIKE_JUDGE_SETTINGS.maxOutputTokens;
  if (rawCap !== undefined) {
    if (rawCap === "inf") maxOutputTokens = "inf";
    else if (/^[1-9]\d*$/.test(rawCap) && isJudgeOutputCap(Number(rawCap))) maxOutputTokens = Number(rawCap);
    else throw new Error(`--max-tokens must be a positive integer or inf, not ${rawCap}`);
  }
  const effort = values.effort ?? SPIKE_JUDGE_SETTINGS.effort;
  if (!isJudgeEffort(effort)) throw new Error(`--effort must be one of ${JUDGE_EFFORTS.join(", ")}, not ${effort}`);
  return { maxOutputTokens, effort };
}

/** `--seed <n>` for the line order, an integer from 0 to 2^32 - 1; DEFAULT_SEED when absent. */
export function seedOf(values: Readonly<Record<string, string>>): number {
  const raw = values.seed;
  if (raw === undefined) return DEFAULT_SEED;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n > 0xffffffff) throw new Error(`--seed must be an integer from 0 to 4294967295, not ${raw}`);
  return n;
}

const DRY_RUN_TONE_MS = 1_500;

async function harnessCommand(flags: Flags, ctx: CliContext): Promise<number> {
  const source = (flags.values.source ?? "synthetic") as AudioSource;
  if (!AUDIO_SOURCES.includes(source)) throw new Error(`--source must be one of ${AUDIO_SOURCES.join(", ")}`);
  const judge = judgeSettings(flags.values);
  const seed = seedOf(flags.values);
  const all = loadLines(linesFile(ctx.spikeDir));
  let lines = selectLines(all, flags.lines);
  // The owner may record any subset: without --lines, the owner run takes the lines that have a take.
  if (source === "owner" && flags.lines === null) lines = lines.filter((l) => existsSync(wavPath(ctx.spikeDir, "owner", l.id)));

  const audio = new Map<string, Uint8Array>();
  const problems: string[] = [];
  let placeholders = 0;
  for (const l of lines) {
    const take = readTake(wavPath(ctx.spikeDir, source, l.id));
    if (typeof take !== "string") audio.set(l.id, take);
    else if (flags.live) problems.push(`${l.id}: ${take}`);
    else {
      audio.set(l.id, placeholderPcm(DRY_RUN_TONE_MS));
      placeholders++;
    }
  }

  // Cost guard: say what would be sent before connecting, and never more than MAX_RUN_LINES. What is sent is each
  // take with its trailing silence trimmed (brief 008).
  const trims = [...audio.values()].map((pcm) => trimTail(pcm));
  const seconds = trims.reduce((n, t) => n + (t === null ? 0 : t.pcm.byteLength / 48_000), 0);
  const trimmedSeconds = trims.reduce((n, t) => n + (t === null ? 0 : t.trimmedMs / 1000), 0);
  ctx.log(`harness: ${lines.length} lines, ${seconds.toFixed(1)} s of audio, source ${source}, ${flags.live ? "LIVE Realtime session" : "fake transport"}`);
  ctx.log(`harness: judge max_output_tokens ${judge.maxOutputTokens}, effort ${judge.effort}; line order seed ${seed}`);
  ctx.log(`harness: ${trimmedSeconds.toFixed(1)} s of trailing silence trimmed from the takes (speech threshold RMS ${SPEECH_RMS_THRESHOLD}, ${KEEP_AFTER_MS} ms kept)`);
  if (lines.length === 0) {
    ctx.log("harness: no lines to run.");
    return 1;
  }
  if (lines.length > MAX_RUN_LINES) {
    ctx.log(`harness: refusing ${lines.length} lines; at most ${MAX_RUN_LINES} in one run.`);
    return 1;
  }
  if (problems.length > 0) {
    ctx.log(`harness: refusing a live run with unusable audio:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  const silent = silentTakes(lines, audio);
  if (silent.length > 0) {
    ctx.log(`harness: refusing takes with no speech (${NO_SPEECH}):\n  ${silent.join("\n  ")}`);
    return 1;
  }

  const set = lineSetCommit(ctx.spikeDir);
  let connect: Connect;
  let clock: HarnessClock;
  let apiKey = "";
  let models: { voice: string; transcribe: string };
  let virtual: VirtualClock | null = null;
  if (flags.live) {
    if (set.dirty) {
      ctx.log("harness: refusing a live run: lines.json has uncommitted changes. Labels are frozen before a run.");
      return 1;
    }
    apiKey = requireEnv("OPENAI_API_KEY", ctx.env);
    models = { voice: requireModel("voice", ctx.env), transcribe: requireModel("transcribe", ctx.env) };
    ctx.log(`harness: models from ${MODEL_VARS.voice} and ${MODEL_VARS.transcribe}; connecting.`);
    connect = ctx.liveConnect ?? liveConnect;
    clock = liveClock;
  } else {
    ctx.log(`harness: dry run, no network. ${placeholders > 0 ? `${placeholders} line(s) use a placeholder tone. ` : ""}Add --live to measure.`);
    virtual = new VirtualClock();
    clock = virtual;
    models = { voice: ctx.env[MODEL_VARS.voice] ?? "unset", transcribe: ctx.env[MODEL_VARS.transcribe] ?? "unset" };
    const expectOf = new Map(lines.map((l) => [l.id, l.expect]));
    connect = fakeConnect({ clock, judge: (_i, turnId) => ({ texts: [expectOf.get(turnId) === "hold" ? "H" : "O"] }) }).connect;
  }

  const voices = new Map<string, string>();
  const manifest = join(audioDir(ctx.spikeDir, "synthetic"), "manifest.json");
  if (source === "synthetic" && existsSync(manifest)) {
    for (const [id, v] of Object.entries((JSON.parse(readFileSync(manifest, "utf8")) as { voices?: Record<string, string> }).voices ?? {})) voices.set(id, v);
  }
  if (source === "owner") for (const l of lines) voices.set(l.id, "owner");

  const work = runHarness({ lines, audio, voices, models, judge, seed, apiKey, connect, clock, log: ctx.log });
  const out = virtual === null ? await work : await virtual.run(work);
  const date = wallDateIso();
  const run = runFile({ date, source, transport: flags.live ? "live" : "fake", lineSetCommit: set.commit + (set.dirty ? " (dirty)" : ""), lineSetHash: lineSetHash(all), models, judge }, out);
  const dir = flags.live ? resultsDir(ctx.spikeDir) : join(ctx.spikeDir, "dist", "dry-run");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${date.replace(/[:.]/g, "-")}-${source}`);
  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2) + "\n");
  const md = summaryMarkdown(run);
  writeFileSync(`${base}.md`, md);
  ctx.log(md);
  ctx.log(`harness: wrote ${base}.json and ${base}.md`);
  return 0;
}

const COMMANDS: Record<string, (flags: Flags, ctx: CliContext) => Promise<number>> = { synth: synthCommand, harness: harnessCommand };

/** Runs one command and returns the exit code. */
export async function main(argv: readonly string[], ctx: CliContext): Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    ctx.log(`usage: node scripts/judge-spike/run.mjs <${Object.keys(COMMANDS).join("|")}> [--live] [--lines id,id] [--source synthetic|owner] [--max-tokens n|inf] [--effort value] [--seed n]`);
    return 2;
  }
  return command(parseFlags(rest), ctx);
}
