// Post-build proof that three.js ships only in an async chunk (brief 013 rule 4, design note §6). Runs in the
// `postbuild` script of apps/web after specimens-absent.mjs, so a failure makes `npm run build` exit non-zero.
//   1. At least one client chunk under .next/static/chunks holds the three-only marker MARKER (three r187's
//      `begin_vertex` shader chunk). None means three is missing from the client build, or the marker moved.
//   2. The first load of each checked route, `/` (the front door) and `/lab` (the lab), holds no file with the
//      marker. The first load of a route is the union of
//      - every client JS file the route's client reference manifest lists for its page entry (for `/`,
//        .next/server/app/page_client-reference-manifest.js under `/page`; for `/lab`,
//        .next/server/app/lab/page_client-reference-manifest.js under `/lab/page`: `entryJSFiles` of every
//        segment, the page and its layouts, and the `chunks` of every client module), and
//      - every client JS path named anywhere in the route's prerendered HTML (.next/server/app/index.html for `/`,
//        .next/server/app/lab.html for `/lab`: script tags, preloads and the inline flight data), and
//      - `rootMainFiles` and `polyfillFiles` from .next/build-manifest.json, which load on every app page.
//      Finding neither of the first two sources for a route is a failure: the check never passes on a list it could
//      not read. A listed file that is missing on disk is a failure too, since it could not be scanned.
//   3. It prints each three chunk with raw and gzip sizes, and the first-load total of each route. The total follows
//      `next build`'s own First Load JS (route-bundle-stats.js in next 16.4.3): polyfills are scanned but not
//      counted. Sizes: bytes on disk, and gzip at zlib's default level.
// File names follow next 16.4.3 with Turbopack. Read against a real 16.4.3 build of `/` (before three was added):
// both sources parsed, and the counted total equalled that build's route-bundle-stats.json First Load JS exactly.
// A nested route's names follow the same build's `/_not-found` (server/app/_not-found/page_client-reference-
// manifest.js, key `/_not-found/page`, server/app/_not-found.html); see routeFiles.
// Usage: node scripts/three-chunk-check.mjs [path/to/.next]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { gzipSync } from "node:zlib";
import { REPO_ROOT } from "./clock-check.mjs";

/** Text that only three's renderer carries: the start of three r187's `begin_vertex` shader chunk. */
export const MARKER = "vec3 transformed = vec3( position );";

/** Relative to .next. */
export const CHUNKS_DIR = "static/chunks";
export const BUILD_MANIFEST = "build-manifest.json";
/** The routes whose first load must never hold three. */
export const ROUTES = ["/", "/lab"];

/**
 * Where a route's first-load sources live, relative to .next: its client reference manifest, the manifest's key for
 * the route's page, and the prerendered HTML. `/` is the app root's page; `/a/b` is server/app/a/b/page_... under
 * `/a/b/page`, prerendered as server/app/a/b.html.
 */
export function routeFiles(route) {
  if (!/^\/(?:[a-z0-9_-]+(?:\/[a-z0-9_-]+)*)?$/.test(route)) throw new Error(`not a static route: ${route}`);
  if (route === "/") return { manifest: "server/app/page_client-reference-manifest.js", key: "/page", html: "server/app/index.html" };
  return { manifest: `server/app${route}/page_client-reference-manifest.js`, key: `${route}/page`, html: `server/app${route}.html` };
}

/** The sources of `/`. */
export const CLIENT_REFERENCE_MANIFEST = routeFiles("/").manifest;
export const PRERENDERED_HTML = routeFiles("/").html;

/** A client JS path as it appears in a URL or a manifest, e.g. `/_next/static/chunks/a.js?dpl=1`. */
const STATIC_JS_IN_TEXT = /(?:\/_next\/)?static\/[^"'\s\\<>?#()]+?\.js(?=["'\s\\<>?#()]|$)/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Every string anywhere in a JSON-like value, keys excluded. */
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** `/_next/static/chunks/a.js?x` or `static/chunks/a.js` → `static/chunks/a.js`; anything else → null. */
export function toDistPath(text) {
  let s = text.split(/[?#]/)[0];
  const at = s.lastIndexOf("/_next/");
  if (at !== -1) s = s.slice(at + "/_next/".length);
  s = s.replace(/^\/+/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  if (!s.startsWith("static/") || !s.endsWith(".js") || s.split("/").includes("..")) return null;
  return s;
}

/** A page's entry in a client reference manifest, which is a script that sets `globalThis.__RSC_MANIFEST`. */
function readClientReferenceManifest(file, key) {
  const context = createContext({});
  runInContext(readFileSync(file, "utf8"), context, { filename: file, timeout: 5000 });
  const manifest = context.__RSC_MANIFEST;
  if (manifest === null || typeof manifest !== "object") throw new Error("it sets no __RSC_MANIFEST");
  const entry = manifest[key];
  if (entry === null || typeof entry !== "object") throw new Error(`__RSC_MANIFEST has no ${key} entry`);
  const clientChunks = Object.values(entry.clientModules ?? {}).map((m) => (m !== null && typeof m === "object" ? m.chunks ?? [] : []));
  return [...strings(entry.entryJSFiles ?? {}), ...strings(clientChunks)];
}

function sizes(file) {
  const bytes = readFileSync(file);
  return { raw: bytes.length, gzip: gzipSync(bytes).length };
}

const posix = (path) => path.split(sep).join("/");

/**
 * Reads a build. Returns { problems, threeChunks, routes }: `problems` empty means three is in at least one client
 * chunk and in none of the first load of any route in `routes`. `routes` holds one { route, sources, firstLoad } per
 * checked route. `threeChunks` and each `firstLoad.files` hold paths relative to .next with `/` separators.
 */
export function checkThreeChunks(nextDir, routes = ROUTES) {
  const problems = [];
  const result = { problems, threeChunks: [], routes: [] };
  if (!existsSync(nextDir) || !statSync(nextDir).isDirectory()) {
    problems.push(`no build output at ${nextDir}`);
    return result;
  }

  // 1. The chunks that carry three.
  const chunksDir = join(nextDir, CHUNKS_DIR);
  const withMarker = new Set();
  for (const file of walk(chunksDir)) {
    if (!file.endsWith(".js")) continue;
    if (!readFileSync(file, "latin1").includes(MARKER)) continue;
    const rel = posix(relative(nextDir, file));
    withMarker.add(rel);
    result.threeChunks.push({ file: rel, ...sizes(file) });
  }
  result.threeChunks.sort((a, b) => a.file.localeCompare(b.file));
  if (withMarker.size === 0) problems.push(`no client chunk under ${CHUNKS_DIR} holds the three marker: three is missing from the client build`);

  // The files every app page loads.
  const shared = { counted: [], polyfills: [] };
  const buildManifestFile = join(nextDir, BUILD_MANIFEST);
  if (existsSync(buildManifestFile)) {
    try {
      const buildManifest = JSON.parse(readFileSync(buildManifestFile, "utf8"));
      shared.counted = strings(buildManifest.rootMainFiles ?? []);
      // Polyfills load only in browsers without modules (a `noModule` script in the prerendered page); scanned,
      // not counted, as `next build` counts it.
      shared.polyfills = strings(buildManifest.polyfillFiles ?? []);
    } catch (error) {
      problems.push(`${BUILD_MANIFEST}: could not read it (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  // 2. The first load of each route.
  for (const route of routes) {
    const files = routeFiles(route);
    const entry = { route, sources: [], firstLoad: { files: [], raw: 0, gzip: 0 } };
    result.routes.push(entry);
    const listed = new Set();
    const counted = new Set();
    const polyfills = new Set();
    const add = (paths, count) => {
      for (const text of paths) {
        const path = toDistPath(text);
        if (path === null) continue;
        listed.add(path);
        (count ? counted : polyfills).add(path);
      }
    };
    let manifestFailed = false;
    const manifestFile = join(nextDir, files.manifest);
    if (existsSync(manifestFile)) {
      try {
        add(readClientReferenceManifest(manifestFile, files.key), true);
        entry.sources.push(files.manifest);
      } catch (error) {
        manifestFailed = true;
        problems.push(`${files.manifest}: could not read it (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    const htmlFile = join(nextDir, files.html);
    if (existsSync(htmlFile)) {
      add(readFileSync(htmlFile, "utf8").match(STATIC_JS_IN_TEXT) ?? [], true);
      entry.sources.push(files.html);
    }
    if (entry.sources.length === 0 && !manifestFailed) {
      problems.push(`found neither ${files.manifest} nor ${files.html}: cannot tell what the first load of ${route} holds`);
    }
    add(shared.counted, true);
    add(shared.polyfills, false);

    for (const path of [...listed].sort()) {
      const file = join(nextDir, ...path.split("/"));
      if (!existsSync(file)) {
        problems.push(`first load of ${route} lists ${path}, which is not in the build`);
        continue;
      }
      if (withMarker.has(path) || readFileSync(file, "latin1").includes(MARKER)) {
        problems.push(`first load of ${route} holds three: ${path}`);
      }
      if (counted.has(path) && !polyfills.has(path)) {
        const size = sizes(file);
        entry.firstLoad.files.push(path);
        entry.firstLoad.raw += size.raw;
        entry.firstLoad.gzip += size.gzip;
      }
    }
  }
  return result;
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/** The lines the CLI prints on success. */
export function formatReport(result) {
  const names = result.routes.map((r) => r.route).join(" or ");
  const lines = [`three-chunk-check: three is in ${result.threeChunks.length} async chunk(s) and not in the first load of ${names}.`];
  for (const chunk of result.threeChunks) lines.push(`  ${chunk.file}  ${kB(chunk.raw)} raw  ${kB(chunk.gzip)} gzip`);
  const three = result.threeChunks.reduce((sum, c) => ({ raw: sum.raw + c.raw, gzip: sum.gzip + c.gzip }), { raw: 0, gzip: 0 });
  lines.push(`  three chunks total: ${kB(three.raw)} raw, ${kB(three.gzip)} gzip`);
  for (const r of result.routes) {
    lines.push(
      `  first load of ${r.route}: ${r.firstLoad.files.length} file(s), ${kB(r.firstLoad.raw)} raw, ${kB(r.firstLoad.gzip)} gzip` +
        ` (from ${r.sources.join(" and ")}, plus ${BUILD_MANIFEST} rootMainFiles)`,
    );
  }
  return lines;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const nextDir = process.argv[2] ? resolve(process.argv[2]) : join(REPO_ROOT, "apps/web/.next");
  const result = checkThreeChunks(nextDir);
  if (result.problems.length > 0) {
    process.stderr.write(`three-chunk-check: three must load only in an async chunk, never in the first load of ${ROUTES.join(" or ")}:\n${result.problems.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${formatReport(result).join("\n")}\n`);
}
