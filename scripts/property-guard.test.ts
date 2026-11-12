import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { decide, gitTracks, isPropertyFile } from "./property-guard.mjs";

const HOOK = join(REPO_ROOT, "scripts", "property-guard.mjs");
// A property file committed before this guard; the end-to-end case needs one git really tracks.
const TRACKED = "packages/core/src/head.property.test.ts";

function event(toolName: string, toolInput: Record<string, unknown>) {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput });
}

const tracked = (files: string[]) => (file: string) => files.includes(file);

describe("property guard, decide", () => {
  it("exits 2 for a tracked property file and says what to do instead", () => {
    const r = decide(event("str_replace", { path: "packages/core/src/voice/p1.property.test.ts", oldStr: "a", newStr: "b" }), tracked(["packages/core/src/voice/p1.property.test.ts"]));
    expect(r.code).toBe(2);
    expect(r.message).toContain("packages/core/src/voice/p1.property.test.ts");
    expect(r.message).toContain("new *.property.test.ts file");
    expect(r.message).toContain("stop and report");
  });

  it("blocks every tool that names a tracked property file, by any path key and absolute path", () => {
    const file = "packages/server/src/parse-gap.property.test.ts";
    const abs = join(REPO_ROOT, "packages", "server", "src", "parse-gap.property.test.ts");
    const isTracked = tracked([file]);
    expect(decide(event("fs_write", { path: abs, text: "x" }), isTracked).code).toBe(2);
    expect(decide(event("fs_append", { path: file, text: "x" }), isTracked).code).toBe(2);
    expect(decide(event("delete_file", { targetFile: file }), isTracked).code).toBe(2);
    expect(decide(JSON.stringify({ toolInput: JSON.stringify({ file_path: file }) }), isTracked).code).toBe(2);
  });

  it("allows a property file git does not track yet", () => {
    expect(decide(event("fs_write", { path: "packages/core/src/voice/new.property.test.ts", text: "x" }), tracked([])).code).toBe(0);
  });

  it("allows every other path without asking git", () => {
    const never = () => {
      throw new Error("git was asked");
    };
    for (const path of ["packages/core/src/voice/machine.ts", "packages/core/src/voice/machine.test.ts", "packages/core/src/voice/testing/arb-call.ts", "docs/property.test.ts.md"]) {
      expect(decide(event("fs_write", { path, text: "x" }), never)).toEqual({ code: 0, message: "" });
    }
  });

  it("exits 2 on bad input or no target path", () => {
    const none = tracked([]);
    expect(decide("{not json", none).code).toBe(2);
    expect(decide("[]", none).code).toBe(2);
    expect(decide(event("fs_write", { text: "x" }), none).code).toBe(2);
    expect(decide(event("fs_write", { path: "  ", text: "x" }), none).message).toContain("could not be checked");
  });

  it("matches property files by name only", () => {
    expect(isPropertyFile("a/b.property.test.ts")).toBe(true);
    expect(isPropertyFile("a/b.test.ts")).toBe(false);
    expect(isPropertyFile("a/b.property.ts")).toBe(false);
  });
});

describe("property guard, end to end", () => {
  function runHook(stdin: string) {
    const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", cwd: REPO_ROOT });
    return { code: r.status, stderr: r.stderr };
  }

  it("git tracks the reference property file", () => {
    expect(gitTracks(TRACKED)).toBe(true);
    expect(gitTracks("packages/core/src/voice/not-a-file.property.test.ts")).toBe(false);
  });

  it("blocks an edit to a tracked property file and allows a new one", () => {
    const blocked = runHook(event("str_replace", { path: TRACKED, oldStr: "a", newStr: "b" }));
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain(TRACKED);
    expect(runHook(event("fs_write", { path: "packages/core/src/voice/not-a-file.property.test.ts", text: "x" })).code).toBe(0);
    expect(runHook(event("fs_write", { path: "packages/core/src/voice/machine.ts", text: "x" })).code).toBe(0);
  });

  it("exits 2 on bad stdin", () => {
    expect(runHook("{not json").code).toBe(2);
  });
});

describe("property guard, path spellings and the staged state", () => {
  // The checkout's own folder name: `../<it>/...` from the repo root names a file inside this repo.
  const REPO_DIR = basename(resolve(REPO_ROOT));
  const temps: string[] = [];
  afterEach(() => {
    for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function runHook(stdin: string) {
    const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", cwd: REPO_ROOT });
    return { code: r.status, stderr: r.stderr };
  }

  it("blocks a tracked property file named through ../<repo folder>/, either slash", () => {
    const file = "packages/server/src/parse-gap.property.test.ts";
    const isTracked = tracked([file]);
    expect(decide(event("fs_write", { path: `../${REPO_DIR}/${file}`, text: "x" }), isTracked).code).toBe(2);
    expect(decide(event("str_replace", { path: `..\\${REPO_DIR}\\packages\\server\\src\\parse-gap.property.test.ts` }), isTracked).code).toBe(2);
  });

  it("still allows a property file in a different folder beside the repo, without asking git", () => {
    const never = () => {
      throw new Error("git was asked");
    };
    expect(decide(event("fs_write", { path: `../${REPO_DIR}-elsewhere/packages/core/src/head.property.test.ts`, text: "x" }), never)).toEqual({ code: 0, message: "" });
  });

  it("says the blocked file is tracked (staged or committed)", () => {
    const file = "packages/core/src/voice/p1.property.test.ts";
    expect(decide(event("str_replace", { path: file }), tracked([file])).message).toContain("tracked (staged or committed)");
  });

  it("counts a tracked property file named with different letter case as tracked", () => {
    expect(gitTracks("packages/core/src/HEAD.property.test.ts")).toBe(true);
    expect(gitTracks("Packages/Core/src/head.property.test.ts")).toBe(true);
    expect(gitTracks("packages/core/src/voice/NOT-A-FILE.property.test.ts")).toBe(false);
  });

  it("counts a staged, never-committed file as tracked, and an unstaged one as not", () => {
    const root = mkdtempSync(join(tmpdir(), "property-guard-"));
    temps.push(root);
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(git("init", "-q").status).toBe(0);
    writeFileSync(join(root, "draft.property.test.ts"), "x");
    expect(gitTracks("draft.property.test.ts", root)).toBe(false);
    expect(git("add", "draft.property.test.ts").status).toBe(0);
    expect(gitTracks("draft.property.test.ts", root)).toBe(true);
    expect(git("rm", "-q", "--cached", "draft.property.test.ts").status).toBe(0);
    expect(gitTracks("draft.property.test.ts", root)).toBe(false);
  });

  it("blocks the hook for a case variant and a ../<repo folder>/ spelling of a tracked property file", () => {
    const paths = [
      "packages/core/src/HEAD.property.test.ts",
      "Packages/core/src/head.property.test.ts",
      join(REPO_ROOT, "packages", "core", "src", "Head.property.test.ts"),
      `../${REPO_DIR}/${TRACKED}`,
    ];
    const codes = paths.map((path) => [path, runHook(event("str_replace", { path, oldStr: "a", newStr: "b" })).code]);
    expect(codes).toEqual(paths.map((path) => [path, 2]));
  });
});

describe("property guard, the suffix, the pathspec and the working folder", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function runHookFrom(cwd: string, stdin: string, env: NodeJS.ProcessEnv = process.env) {
    const r = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", cwd, env });
    return { code: r.status, stderr: r.stderr };
  }

  it("counts the suffix in any letter case as a property file", () => {
    expect(isPropertyFile("a/b.PROPERTY.TEST.TS")).toBe(true);
    expect(isPropertyFile("a/b.Property.Test.Ts")).toBe(true);
  });

  it("blocks the hook for a tracked property file whose suffix is spelled in another letter case", () => {
    const paths = ["packages/core/src/head.Property.Test.TS", "packages/core/src/HEAD.PROPERTY.TEST.TS"];
    const codes = paths.map((path) => [path, runHookFrom(REPO_ROOT, event("str_replace", { path, oldStr: "a", newStr: "b" })).code]);
    expect(codes).toEqual(paths.map((path) => [path, 2]));
  });

  it("matches a tracked name with capitals in any letter case", () => {
    const root = mkdtempSync(join(tmpdir(), "property-guard-"));
    temps.push(root);
    const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    expect(git("init", "-q").status).toBe(0);
    writeFileSync(join(root, "Draft.property.test.ts"), "x");
    expect(git("add", "Draft.property.test.ts").status).toBe(0);
    expect(gitTracks("Draft.property.test.ts", root)).toBe(true);
    expect(gitTracks("draft.property.test.ts", root)).toBe(true);
    expect(gitTracks("DRAFT.PROPERTY.TEST.TS", root)).toBe(true);
  });

  it("reads the name literally, so glob characters match no tracked file", () => {
    expect(gitTracks("packages/core/src/hea?.property.test.ts")).toBe(false);
    expect(gitTracks("packages/core/src/[h]ead.property.test.ts")).toBe(false);
    expect(gitTracks("packages/core/src/*.property.test.ts")).toBe(false);
  });

  it("resolves a relative path from the repository root, not the folder the hook was started in", () => {
    expect(runHookFrom(join(REPO_ROOT, "scripts"), event("str_replace", { path: TRACKED, oldStr: "a", newStr: "b" })).code).toBe(2);
  });
});
