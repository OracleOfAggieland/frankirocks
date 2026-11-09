import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
