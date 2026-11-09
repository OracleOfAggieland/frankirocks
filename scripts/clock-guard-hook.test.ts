import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";

const HOOK = join(REPO_ROOT, "scripts", "clock-guard.mjs");
const NOW_CALL = "Date" + ".now()";

function runHook(stdin: string) {
  const result = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", cwd: REPO_ROOT });
  return { code: result.status, stderr: result.stderr };
}

function event(toolName: string, toolInput: Record<string, unknown>) {
  return JSON.stringify({ hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput });
}

describe("clock Guard_Hook", () => {
  it("exits 2 outside the allow-list and names the file and the allow-list", () => {
    const { code, stderr } = runHook(
      event("fs_write", { path: "packages/core/src/bad.ts", text: `export const t = ${NOW_CALL};` }),
    );
    expect(code).toBe(2);
    expect(stderr).toContain("packages/core/src/bad.ts");
    expect(stderr).toContain("packages/server/src/clock/live-clock.ts");
    expect(stderr).toContain("functions/src/clock.ts");
  });

  it("exits 2 for str_replace and fs_append content, and absolute paths", () => {
    const abs = join(REPO_ROOT, "packages", "server", "src", "x.ts");
    expect(runHook(event("str_replace", { path: abs, oldStr: "a", newStr: NOW_CALL })).code).toBe(2);
    expect(runHook(event("fs_append", { path: "apps/web/src/y.tsx", text: NOW_CALL })).code).toBe(2);
  });

  it("exits 0 inside the allow-list", () => {
    const abs = join(REPO_ROOT, "packages", "server", "src", "clock", "live-clock.ts");
    expect(runHook(event("fs_write", { path: abs, text: NOW_CALL })).code).toBe(0);
    expect(runHook(event("str_replace", { path: "functions/src/clock.ts", oldStr: "x", newStr: NOW_CALL })).code).toBe(0);
  });

  it("exits 0 without Date.now( in the new content", () => {
    expect(runHook(event("fs_write", { path: "packages/core/src/ok.ts", text: "new Date(ms)" })).code).toBe(0);
    // Removing a wall-clock read is allowed: only the new content counts.
    expect(runHook(event("str_replace", { path: "packages/core/src/ok.ts", oldStr: NOW_CALL, newStr: "now" })).code).toBe(0);
  });

  it("exits 2 on bad stdin", () => {
    const bad = runHook("{not json");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("could not be checked");
    expect(runHook("[]").code).toBe(2);
    expect(runHook(event("fs_write", { text: NOW_CALL })).code).toBe(2);
  });
});
