import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { SENTINEL, checkBuild } from "./specimens-absent.mjs";

let root: string | null = null;
afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});

const CLEAN_ROUTES = { "/page": "/", "/api/health/route": "/api/health" };

function fakeNext(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "specimens-absent-"));
  const next = join(root, ".next");
  const all: Record<string, string> = {
    "app-path-routes-manifest.json": JSON.stringify(CLEAN_ROUTES),
    "server/app-paths-manifest.json": JSON.stringify({ "/page": "app/page.js" }),
    "server/chunks/a.js": "console.log('franki')",
    "static/chunks/b.js": "export {}",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(next, path)), { recursive: true });
    writeFileSync(join(next, path), text);
  }
  return next;
}

describe("specimens-absent", () => {
  it("passes a clean build", () => {
    expect(checkBuild(fakeNext({}))).toEqual([]);
  });

  it("fails a manifest with /specimens/page", () => {
    const next = fakeNext({ "app-path-routes-manifest.json": JSON.stringify({ ...CLEAN_ROUTES, "/specimens/page": "/specimens" }) });
    expect(checkBuild(next)).toEqual(["app-path-routes-manifest.json: route /specimens/page"]);
  });

  it("fails a server manifest entry and a routes-manifest entry", () => {
    const next = fakeNext({
      "server/app-paths-manifest.json": JSON.stringify({ "/specimens/page": "app/specimens/page.js" }),
      "routes-manifest.json": JSON.stringify({ staticRoutes: [{ page: "/specimens" }] }),
    });
    expect(checkBuild(next)).toEqual(["server/app-paths-manifest.json: route /specimens/page", "routes-manifest.json: /specimens"]);
  });

  it("fails a file with the Fixture sentinel", () => {
    const next = fakeNext({ "static/chunks/c.js": `const s = "${SENTINEL}";` });
    const problems = checkBuild(next);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/static\/chunks\/c\.js: Fixture sentinel$/);
  });

  it("fails when there is no build output", () => {
    root = mkdtempSync(join(tmpdir(), "specimens-absent-"));
    expect(checkBuild(join(root, ".next"))[0]).toMatch(/^no build output/);
  });

  it("CLI exits 1 on a bad build and 0 on a clean one", () => {
    const bad = fakeNext({ "server/chunks/x.js": SENTINEL });
    const run = (dir: string) => spawnSync(process.execPath, [join(REPO_ROOT, "scripts/specimens-absent.mjs"), dir], { encoding: "utf8" });
    expect(run(bad).status).toBe(1);
    rmSync(root!, { recursive: true, force: true });
    expect(run(fakeNext({})).status).toBe(0);
  });
});
