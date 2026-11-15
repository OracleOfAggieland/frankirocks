#!/usr/bin/env node
// The live test launcher (brief 050 part A). Starts `next dev` in apps/web with the recorder on, in a new run folder:
//   node scripts/live-test/dev.mjs --out <folder> [--script <file>] [--port 3000]
// It makes <out>/<YYYY-MM-DD_HHmmss>/, writes meta.json, copies the script to script.json, runs
// scripts/sync-local-env.mjs, then starts `next dev` with FRANKI_LIVE_TEST_DIR and NEXT_PUBLIC_FRANKI_LIVE_TEST=1.
// The server's output goes to this terminal as usual and also to server.log, each line prefixed with epoch ms.
// Ctrl+C is passed on to the server, and the launcher exits with the server's code. `--out` defaults to .live-test/
// at the repo root (gitignored). This folder is outside the clock scan, so it reads the wall clock directly.
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlainEnv } from "../sync-local-env.mjs";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const WEB_DIR = join(REPO_ROOT, "apps", "web");
export const DEFAULT_OUT = join(REPO_ROOT, ".live-test");
const MODEL_VAR = /^FRANKI_[A-Z0-9_]*MODEL$/;

export const USAGE = "usage: node scripts/live-test/dev.mjs [--out <folder>] [--script <file>] [--port 3000]";

/** Pure: the launcher's options. Throws with a short message on a bad argument. */
export function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, script: null, port: 3000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new Error(`${name} needs a value`);
      return v;
    };
    if (name === "--out") opts.out = resolve(value());
    else if (name === "--script") opts.script = resolve(value());
    else if (name === "--port") {
      const v = value();
      if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 65535) throw new Error(`--port must be a port number, not ${v}`);
      opts.port = Number(v);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Pure: the run folder's name, in local time: YYYY-MM-DD_HHmmss. */
export function runFolderName(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Pure: prefixes each complete line of `chunk` with `at` (epoch ms). A partial last line is carried to the next
 * chunk. Returns the text for server.log and the new carry.
 */
export function prefixLines(carry, chunk, at) {
  const text = carry + chunk;
  const cut = text.lastIndexOf("\n");
  if (cut === -1) return { text: "", carry: text };
  const lines = text.slice(0, cut).split("\n").map((l) => `${at} ${l.replace(/\r$/, "")}\n`);
  return { text: lines.join(""), carry: text.slice(cut + 1) };
}

/** Pure: checks a script file's text has the shape the runner reads. Returns the parsed script or throws. */
export function checkScript(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("the script is not JSON");
  }
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.steps)) throw new Error("the script needs a steps list");
  doc.steps.forEach((s, i) => {
    if (typeof s?.id !== "string" || typeof s?.title !== "string") throw new Error(`step ${i + 1} needs a string id and title`);
  });
  return doc;
}

/** Pure: the FRANKI_*_MODEL values, from apphosting.yaml's plain entries, then the launcher's own environment. */
export function modelValues(apphostingText, env) {
  const models = {};
  for (const { name, value } of apphostingText === null ? [] : parsePlainEnv(apphostingText)) if (MODEL_VAR.test(name)) models[name] = value;
  for (const [name, value] of Object.entries(env)) if (MODEL_VAR.test(name) && typeof value === "string" && value !== "") models[name] = value;
  return models;
}

/** Makes <out>/<name>/, adding -2, -3 … when two runs start in the same second. */
export function makeRunDir(out, name) {
  mkdirSync(out, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = join(out, n === 1 ? name : `${name}-${n}`);
    if (existsSync(dir)) continue;
    mkdirSync(dir);
    return dir;
  }
}

/** Read-only git facts for meta.json; null where git does not answer. */
export function gitFacts(run = (args) => spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" })) {
  const out = (args) => {
    const r = run(args);
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const status = out(["status", "--porcelain"]);
  return { commit: out(["rev-parse", "HEAD"]), branch: out(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: status === null ? null : status !== "" };
}

/** The `next` binary's script, resolved from apps/web, so no shell and no npx are needed (Windows too). */
export function resolveNextBin(webDir = WEB_DIR) {
  return createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
}

/**
 * Runs the launcher. Every side effect outside the run folder comes through `io`, so a test can drive it without a
 * server. Resolves with the exit code.
 */
export function launch(argv, io = {}) {
  const {
    spawn = nodeSpawn,
    now = () => new Date(),
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
    onSignal = (sig, fn) => process.on(sig, fn),
    git = gitFacts,
    sync = () => spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "sync-local-env.mjs")], { stdio: "inherit" }).status ?? 1,
    nextBin = resolveNextBin,
    apphosting = () => (existsSync(join(WEB_DIR, "apphosting.yaml")) ? readFileSync(join(WEB_DIR, "apphosting.yaml"), "utf8") : null),
  } = io;
  let opts;
  let script = null;
  try {
    opts = parseArgs(argv);
    if (opts.script !== null) {
      const text = readFileSync(opts.script, "utf8");
      checkScript(text);
      script = { text };
    }
  } catch (error) {
    stderr.write(`live-test: ${error.message}\n${USAGE}\n`);
    return Promise.resolve(2);
  }
  const started = now();
  const dir = makeRunDir(opts.out, runFolderName(started));
  if (script !== null) writeFileSync(join(dir, "script.json"), script.text);
  if (sync() !== 0) {
    stderr.write("live-test: scripts/sync-local-env.mjs failed\n");
    return Promise.resolve(1);
  }
  const meta = {
    startedAt: started.getTime(),
    started: started.toISOString(),
    ...git(),
    node: process.version,
    port: opts.port,
    script: script !== null,
    models: modelValues(apphosting(), env),
  };
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  stdout.write(`live-test: recording to ${dir}\n`);

  const log = join(dir, "server.log");
  const child = spawn(process.execPath, [nextBin(), "dev", "--port", String(opts.port)], {
    cwd: WEB_DIR,
    env: { ...env, FRANKI_LIVE_TEST_DIR: dir, NEXT_PUBLIC_FRANKI_LIVE_TEST: "1" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  const carry = { out: "", err: "" };
  const tee = (key, sink) => (chunk) => {
    const s = chunk.toString("utf8");
    sink.write(s);
    const r = prefixLines(carry[key], s, now().getTime());
    carry[key] = r.carry;
    if (r.text !== "") appendFileSync(log, r.text);
  };
  child.stdout?.on("data", tee("out", stdout));
  child.stderr?.on("data", tee("err", stderr));

  let stops = 0;
  const forward = (sig) => () => {
    stops++;
    if (child.exitCode === null && child.signalCode === null) child.kill(stops > 1 ? "SIGKILL" : sig);
  };
  onSignal("SIGINT", forward("SIGINT"));
  onSignal("SIGTERM", forward("SIGTERM"));

  return new Promise((done) => {
    child.on("error", (error) => {
      stderr.write(`live-test: could not start next dev: ${error.message}\n`);
      done(1);
    });
    child.on("close", (code, signal) => {
      const at = now().getTime();
      const rest = [carry.out, carry.err].filter((c) => c !== "").map((c) => `${at} ${c}\n`).join("");
      if (rest !== "") appendFileSync(log, rest);
      stdout.write(`live-test: the run is in ${dir}\n`);
      done(code ?? (signal === null ? 1 : 130));
    });
  });
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) launch(process.argv.slice(2)).then((code) => process.exit(code));
