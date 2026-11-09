/**
 * The judge spike's command line (brief 006 items 3 and 4). Run through run.mjs, which bundles this file with
 * esbuild and calls `main`. Nothing here reaches the network without `--live`.
 *
 *   synth [--live] [--lines id,id]   synthetic audio through text-to-speech
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_VARS, requireModel } from "../../packages/server/src/config/models";
import { requireEnv } from "../../packages/server/src/config/env";
import { type ProbeLine, loadLines } from "./lines";
import { audioDir, linesFile, wavPath } from "./paths";
import { manifestText, synthPlan, synthesize } from "./synth";

export interface CliContext {
  spikeDir: string;
  env: Readonly<Record<string, string | undefined>>;
  log: (line: string) => void;
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

const COMMANDS: Record<string, (flags: Flags, ctx: CliContext) => Promise<number>> = { synth: synthCommand };

/** Runs one command and returns the exit code. */
export async function main(argv: readonly string[], ctx: CliContext): Promise<number> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS[name];
  if (command === undefined) {
    ctx.log(`usage: node scripts/judge-spike/run.mjs <${Object.keys(COMMANDS).join("|")}> [--live] [--lines id,id]`);
    return 2;
  }
  return command(parseFlags(rest), ctx);
}
