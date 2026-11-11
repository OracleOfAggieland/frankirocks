import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./clock-check.mjs";
import { BUILD_MANIFEST, CLIENT_REFERENCE_MANIFEST, MARKER, PRERENDERED_HTML, checkThreeChunks, formatReport, toDistPath } from "./three-chunk-check.mjs";

let root: string | null = null;
afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});

/** A minified-looking three chunk: the marker sits inside a string literal, as in three.module.js. */
const THREE_CHUNK = `var a="${MARKER}\\n#ifdef USE_ALPHAHASH\\n\\tvPosition = vec3( position );\\n#endif";export{a}`;
const ENTRY = { layout: "static/chunks/layout-1.js", page: "static/chunks/page-2.js", main: "static/chunks/main-3.js", poly: "static/chunks/polyfills-4.js" };

/** next 16.4.3 writes the client reference manifest as a script that sets a global. */
function manifestScript(entry: unknown): string {
  return `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/page"] = ${JSON.stringify(entry)};\n`;
}

const CLEAN_ENTRY = {
  moduleLoading: { prefix: "/_next/" },
  clientModules: { "[project]/apps/web/src/components/App.tsx <module evaluation>": { id: 1, name: "*", chunks: [ENTRY.page], async: false } },
  ssrModuleMapping: { "1": { "*": { id: 2, name: "*", chunks: ["server/chunks/ssr/app.js"], async: false } } },
  entryJSFiles: { "[project]/apps/web/src/app/layout": [ENTRY.layout], "[project]/apps/web/src/app/page": [ENTRY.layout, ENTRY.page] },
};

const CLEAN_HTML =
  `<!DOCTYPE html><html><head><link rel="preload" as="script" href="/_next/static/chunks/${"main-3.js"}"/>` +
  `<script src="/_next/static/chunks/layout-1.js" async=""></script><script src="/_next/static/chunks/page-2.js?dpl=x" async=""></script></head>` +
  `<body><script>self.__next_f.push([1,"1:I[1,[\\"/_next/static/chunks/page-2.js\\"],\\"default\\"]\\n"])</script></body></html>`;

function fakeNext(files: Record<string, string | null>): string {
  root = mkdtempSync(join(tmpdir(), "three-chunk-check-"));
  const next = join(root, ".next");
  const all: Record<string, string | null> = {
    [CLIENT_REFERENCE_MANIFEST]: manifestScript(CLEAN_ENTRY),
    [PRERENDERED_HTML]: CLEAN_HTML,
    [BUILD_MANIFEST]: JSON.stringify({ polyfillFiles: [ENTRY.poly], rootMainFiles: [ENTRY.main], pages: {} }),
    [ENTRY.layout]: "export const layout=1",
    [ENTRY.page]: "export const page=2;import('./engine-9.js')",
    [ENTRY.main]: "export const main=3",
    [ENTRY.poly]: "export const poly=4",
    "static/chunks/engine-9.js": THREE_CHUNK,
    "server/chunks/ssr/app.js": THREE_CHUNK, // the SSR copy is never evaluated and never checked
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(dirname(join(next, path)), { recursive: true });
    writeFileSync(join(next, path), text);
  }
  return next;
}

const leaked = (path: string) => `first load of / holds three: ${path}`;

describe("three-chunk-check", () => {
  it("passes a build with three only in an async chunk, and reports its sizes", () => {
    const result = checkThreeChunks(fakeNext({}));
    expect(result.problems).toEqual([]);
    expect(result.threeChunks).toEqual([{ file: "static/chunks/engine-9.js", raw: Buffer.byteLength(THREE_CHUNK), gzip: gzipSync(Buffer.from(THREE_CHUNK)).length }]);
    expect(result.sources).toEqual([CLIENT_REFERENCE_MANIFEST, PRERENDERED_HTML]);
    expect(result.firstLoad.files).toEqual([ENTRY.layout, ENTRY.main, ENTRY.page]);
    const counted = ["export const layout=1", "export const main=3", "export const page=2;import('./engine-9.js')"];
    expect(result.firstLoad.raw).toBe(counted.reduce((n, t) => n + Buffer.byteLength(t), 0));
    expect(result.firstLoad.gzip).toBe(counted.reduce((n, t) => n + gzipSync(Buffer.from(t)).length, 0));
  });

  it("passes with only the manifest, and with only the prerendered page", () => {
    expect(checkThreeChunks(fakeNext({ [PRERENDERED_HTML]: null })).problems).toEqual([]);
    rmSync(root!, { recursive: true, force: true });
    expect(checkThreeChunks(fakeNext({ [CLIENT_REFERENCE_MANIFEST]: null })).problems).toEqual([]);
  });

  it("fails when a page entry file holds three", () => {
    expect(checkThreeChunks(fakeNext({ [ENTRY.page]: THREE_CHUNK })).problems).toEqual([leaked(ENTRY.page)]);
  });

  it("fails when the manifest's entryJSFiles list the three chunk", () => {
    const entry = { ...CLEAN_ENTRY, entryJSFiles: { ...CLEAN_ENTRY.entryJSFiles, "[project]/apps/web/src/app/page": [ENTRY.page, "static/chunks/engine-9.js"] } };
    const next = fakeNext({ [CLIENT_REFERENCE_MANIFEST]: manifestScript(entry), [PRERENDERED_HTML]: null });
    expect(checkThreeChunks(next).problems).toEqual([leaked("static/chunks/engine-9.js")]);
  });

  it("fails when a client module's chunks hold the three chunk", () => {
    const entry = { ...CLEAN_ENTRY, clientModules: { x: { id: 3, name: "*", chunks: ["7", "static/chunks/engine-9.js"], async: false } } };
    const next = fakeNext({ [CLIENT_REFERENCE_MANIFEST]: manifestScript(entry), [PRERENDERED_HTML]: null });
    expect(checkThreeChunks(next).problems).toEqual([leaked("static/chunks/engine-9.js")]);
  });

  it("fails when the prerendered page loads the three chunk, by script tag or flight data", () => {
    const tag = CLEAN_HTML.replace("</head>", `<script src="/_next/static/chunks/engine-9.js" async=""></script></head>`);
    expect(checkThreeChunks(fakeNext({ [PRERENDERED_HTML]: tag })).problems).toEqual([leaked("static/chunks/engine-9.js")]);
    rmSync(root!, { recursive: true, force: true });
    const flight = CLEAN_HTML.replace(`[\\"/_next/static/chunks/page-2.js\\"]`, `[\\"/_next/static/chunks/page-2.js\\",\\"/_next/static/chunks/engine-9.js\\"]`);
    expect(checkThreeChunks(fakeNext({ [PRERENDERED_HTML]: flight })).problems).toEqual([leaked("static/chunks/engine-9.js")]);
  });

  it("fails when a root main file holds three", () => {
    expect(checkThreeChunks(fakeNext({ [ENTRY.main]: THREE_CHUNK })).problems).toEqual([leaked(ENTRY.main)]);
  });

  it("scans polyfills but leaves them out of the first-load total", () => {
    // next 16.4.3 also names the polyfill file in the prerendered page, as a noModule script.
    const html = CLEAN_HTML.replace("</head>", `<script src="/_next/static/chunks/polyfills-4.js" noModule=""></script></head>`);
    const clean = checkThreeChunks(fakeNext({ [PRERENDERED_HTML]: html }));
    expect(clean.problems).toEqual([]);
    expect(clean.firstLoad.files).not.toContain(ENTRY.poly);
    rmSync(root!, { recursive: true, force: true });
    expect(checkThreeChunks(fakeNext({ [ENTRY.poly]: THREE_CHUNK })).problems).toEqual([leaked(ENTRY.poly)]);
  });

  it("fails when no client chunk holds three", () => {
    const problems = checkThreeChunks(fakeNext({ "static/chunks/engine-9.js": "export const engine=9" })).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^no client chunk under static\/chunks holds the three marker/);
  });

  it("does not count a server copy as the three chunk", () => {
    const next = fakeNext({ "static/chunks/engine-9.js": "export const engine=9" });
    expect(checkThreeChunks(next).threeChunks).toEqual([]);
  });

  it("finds three chunks in nested folders under static/chunks", () => {
    const next = fakeNext({ "static/chunks/engine-9.js": null, "static/chunks/app/_async/three-a1.js": THREE_CHUNK });
    const result = checkThreeChunks(next);
    expect(result.problems).toEqual([]);
    expect(result.threeChunks.map((c) => c.file)).toEqual(["static/chunks/app/_async/three-a1.js"]);
  });

  it("fails loudly when it finds neither the manifest nor the prerendered page", () => {
    const problems = checkThreeChunks(fakeNext({ [CLIENT_REFERENCE_MANIFEST]: null, [PRERENDERED_HTML]: null })).problems;
    expect(problems).toEqual([`found neither ${CLIENT_REFERENCE_MANIFEST} nor ${PRERENDERED_HTML}: cannot tell what the first load of / holds`]);
  });

  it("fails when the manifest cannot be read or has no /page entry, even with the prerendered page", () => {
    const broken = checkThreeChunks(fakeNext({ [CLIENT_REFERENCE_MANIFEST]: "globalThis.__RSC_MANIFEST = {" })).problems;
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatch(/^server\/app\/page_client-reference-manifest\.js: could not read it/);
    rmSync(root!, { recursive: true, force: true });
    const other = `globalThis.__RSC_MANIFEST = {};globalThis.__RSC_MANIFEST["/about/page"] = ${JSON.stringify(CLEAN_ENTRY)};`;
    const missing = checkThreeChunks(fakeNext({ [CLIENT_REFERENCE_MANIFEST]: other })).problems;
    expect(missing).toEqual([`${CLIENT_REFERENCE_MANIFEST}: could not read it (__RSC_MANIFEST has no /page entry)`]);
  });

  it("fails when the first load lists a file the build does not have", () => {
    expect(checkThreeChunks(fakeNext({ [ENTRY.layout]: null })).problems).toEqual([`first load of / lists ${ENTRY.layout}, which is not in the build`]);
  });

  it("fails when there is no build output", () => {
    root = mkdtempSync(join(tmpdir(), "three-chunk-check-"));
    expect(checkThreeChunks(join(root, ".next")).problems[0]).toMatch(/^no build output/);
  });

  it("normalises chunk paths from URLs and manifests", () => {
    expect(toDistPath("/_next/static/chunks/a.js")).toBe("static/chunks/a.js");
    expect(toDistPath("https://cdn.test/_next/static/chunks/a%40b.js?dpl=1#x")).toBe("static/chunks/a@b.js");
    expect(toDistPath("static/chunks/app/page-1.js")).toBe("static/chunks/app/page-1.js");
    expect(toDistPath("7")).toBeNull();
    expect(toDistPath("static/css/a.css")).toBeNull();
    expect(toDistPath("server/chunks/ssr/a.js")).toBeNull();
    expect(toDistPath("static/../server/a.js")).toBeNull();
  });

  it("formats the sizes it prints", () => {
    const lines = formatReport({
      problems: [],
      threeChunks: [{ file: "static/chunks/t.js", raw: 612_345, gzip: 156_100 }],
      firstLoad: { files: ["static/chunks/a.js", "static/chunks/b.js"], raw: 200_000, gzip: 64_049 },
      sources: [CLIENT_REFERENCE_MANIFEST, PRERENDERED_HTML],
    });
    expect(lines).toEqual([
      "three-chunk-check: three is in 1 async chunk(s) and not in the first load of /.",
      "  static/chunks/t.js  612.3 kB raw  156.1 kB gzip",
      "  three chunks total: 612.3 kB raw, 156.1 kB gzip",
      `  first load of /: 2 file(s), 200.0 kB raw, 64.0 kB gzip (from ${CLIENT_REFERENCE_MANIFEST} and ${PRERENDERED_HTML}, plus ${BUILD_MANIFEST} rootMainFiles)`,
    ]);
  });

  it("the marker is in the pinned three build", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules/three/package.json"), "utf8"));
    expect(pkg.version).toBe("0.187.0");
    expect(readFileSync(join(REPO_ROOT, "node_modules/three/build/three.module.js"), "utf8")).toContain(MARKER);
  });

  it("CLI exits 1 on a leak and 0 on a clean build, printing the sizes", () => {
    const run = (dir: string) => spawnSync(process.execPath, [join(REPO_ROOT, "scripts/three-chunk-check.mjs"), dir], { encoding: "utf8" });
    const bad = run(fakeNext({ [ENTRY.page]: THREE_CHUNK }));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain(leaked(ENTRY.page));
    rmSync(root!, { recursive: true, force: true });
    const good = run(fakeNext({}));
    expect(good.status).toBe(0);
    expect(good.stdout).toMatch(/static\/chunks\/engine-9\.js {2}[\d.]+ kB raw {2}[\d.]+ kB gzip/);
    expect(good.stdout).toMatch(/first load of \/: 3 file\(s\)/);
  });
});
