import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_OUT, checkScript, launch, makeRunDir, modelValues, parseArgs, prefixLines, resolveNextBin, runFolderName } from "./dev.mjs";

let root: string | null = null;
afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});
const tmp = () => (root = mkdtempSync(join(tmpdir(), "live-test-dev-")));

describe("live-test launcher: pure parts", () => {
  it("parses its arguments", () => {
    expect(parseArgs([])).toEqual({ out: DEFAULT_OUT, script: null, port: 3000 });
    expect(parseArgs(["--out", "runs", "--script=s.json", "--port", "3100"])).toEqual({ out: resolve("runs"), script: resolve("s.json"), port: 3100 });
    expect(() => parseArgs(["--port", "x"])).toThrow(/port/);
    expect(() => parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown/);
  });

  it("names the run folder in local time", () => {
    expect(runFolderName(new Date(2026, 10, 4, 9, 5, 7))).toBe("2026-11-04_090507");
  });

  it("prefixes whole lines and carries a partial one", () => {
    const a = prefixLines("", "ready\r\nstarting", 5);
    expect(a).toEqual({ text: "5 ready\n", carry: "starting" });
    expect(prefixLines(a.carry, " up\n\n", 6)).toEqual({ text: "6 starting up\n6 \n", carry: "" });
    expect(prefixLines("", "no newline", 7)).toEqual({ text: "", carry: "no newline" });
  });

  it("checks the script's shape", () => {
    expect(checkScript('{"steps":[{"id":"B2","title":"Interrupt"}]}').steps).toHaveLength(1);
    expect(() => checkScript("{")).toThrow(/JSON/);
    expect(() => checkScript('{"steps":[{"id":"B2"}]}')).toThrow(/step 1/);
  });

  it("takes only the model values, never another variable", () => {
    const yaml = "env:\n  - variable: FRANKI_BG_MODEL\n    value: bg-1\n  - variable: OTHER\n    value: x\n  - variable: OPENAI_API_KEY\n    secret: k\n";
    expect(modelValues(yaml, { FRANKI_BRAIN_MODEL: "brain-2", OPENAI_API_KEY: "sk-nope" })).toEqual({ FRANKI_BG_MODEL: "bg-1", FRANKI_BRAIN_MODEL: "brain-2" });
    expect(modelValues(null, {})).toEqual({});
  });

  it("makes a fresh folder when two runs start in the same second", () => {
    const out = tmp();
    expect(makeRunDir(out, "r")).toBe(join(out, "r"));
    expect(makeRunDir(out, "r")).toBe(join(out, "r-2"));
  });

  it("resolves the next binary from apps/web", () => {
    expect(resolveNextBin()).toMatch(/next[\\/]dist[\\/]bin[\\/]next$/);
  });
});

/** A child process stand-in: no server starts. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null, killed: [] as string[] });
  (child as unknown as { kill: (s: string) => void }).kill = (s: string) => {
    child.killed.push(s);
  };
  return child;
}

const sink = () => {
  let text = "";
  return { write: (s: string) => ((text += s), true), text: () => text };
};

describe("live-test launcher: a run without a server", () => {
  it("writes meta.json, script.json and server.log, sets the recorder's variables, forwards Ctrl+C and exits with the child's code", async () => {
    const out = tmp();
    const scriptPath = join(out, "s.json");
    writeFileSync(scriptPath, JSON.stringify({ title: "t", steps: [{ id: "A1", title: "Open the lab" }] }));
    const child = fakeChild();
    const spawned: { args: string[]; env: Record<string, string> }[] = [];
    const signals = new Map<string, () => void>();
    const stdout = sink();
    let clock = 1_763_159_000_000;
    const done = launch(["--out", join(out, "runs"), "--script", scriptPath, "--port", "3100"], {
      spawn: (_cmd: string, args: string[], o: { env: Record<string, string> }) => (spawned.push({ args, env: o.env }), child),
      now: () => new Date(clock++),
      env: { PATH: "x", FRANKI_BG_MODEL: "bg-9" },
      stdout,
      stderr: sink(),
      onSignal: (sig: string, fn: () => void) => signals.set(sig, fn),
      git: () => ({ commit: "abc", branch: "lane/live-test", dirty: true }),
      sync: () => 0,
      nextBin: () => "next-bin",
      apphosting: () => null,
    });
    const [run] = readdirSync(join(out, "runs"));
    const dir = join(out, "runs", run!);
    expect(spawned[0]!.args).toEqual(["next-bin", "dev", "--port", "3100"]);
    expect(spawned[0]!.env).toMatchObject({ PATH: "x", FRANKI_LIVE_TEST_DIR: dir, NEXT_PUBLIC_FRANKI_LIVE_TEST: "1" });
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    expect(meta).toMatchObject({ startedAt: 1_763_159_000_000, commit: "abc", branch: "lane/live-test", dirty: true, port: 3100, script: true, models: { FRANKI_BG_MODEL: "bg-9" } });
    expect(JSON.parse(readFileSync(join(dir, "script.json"), "utf8")).steps[0].id).toBe("A1");

    child.stdout.write("▲ Next.js\nReady");
    child.stderr.write("warn x\n");
    signals.get("SIGINT")!();
    expect(child.killed).toEqual(["SIGINT"]);
    await new Promise((r) => setImmediate(r));
    child.emit("close", 3, null);
    expect(await done).toBe(3);
    const log = readFileSync(join(dir, "server.log"), "utf8").trim().split("\n");
    expect(log.map((l) => l.replace(/^\d+ /, ""))).toEqual(["▲ Next.js", "warn x", "Ready"]);
    expect(log.every((l) => /^\d{13} /.test(l))).toBe(true);
    expect(stdout.text()).toContain("▲ Next.js");
  });

  it("refuses a bad script before making a folder or starting anything", async () => {
    const out = tmp();
    writeFileSync(join(out, "bad.json"), "{");
    let started = false;
    const err = sink();
    const code = await launch(["--out", join(out, "runs"), "--script", join(out, "bad.json")], { spawn: () => ((started = true), fakeChild()), stderr: err, sync: () => 0 });
    expect(code).toBe(2);
    expect(started).toBe(false);
    expect(existsSync(join(out, "runs"))).toBe(false);
    expect(err.text()).toMatch(/not JSON/);
  });
});
