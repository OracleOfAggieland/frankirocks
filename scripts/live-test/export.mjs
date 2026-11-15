#!/usr/bin/env node
// Brief 050 part C: writes the test user's stored records into <run folder>/firestore/<collection>.json.
//
//   node scripts/live-test/export.mjs <run folder> [--uid <uid>]
//
// Read-only: it lists collections with the Admin SDK on local Application Default Credentials and never writes to
// Firestore. It prints counts, never content. The project ID comes from FRANKI_FIREBASE_PROJECT_ID, else from
// apps/web/.env.development.local (the plain file scripts/sync-local-env.mjs writes). It never reads .env.local.
// A run folder inside the repo is refused unless it is under .live-test/.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, fail, repoFolderProblem } from "./lib/cli.mjs";
import { collect, dotenvValue, isUid, userIds, writeFiles } from "./lib/export.mjs";
import { InputError, loadRun, metaStart } from "./lib/run.mjs";

/** Firestore values as plain JSON: Timestamps become ISO strings, other SDK types their string form. */
export function plain(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v.constructor && v.constructor !== Object) {
    if (typeof v.path === "string") return v.path;
    if (typeof v.latitude === "number") return { latitude: v.latitude, longitude: v.longitude };
    if (typeof v.toBase64 === "function") return "[bytes]";
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
}

function projectId() {
  if (process.env.FRANKI_FIREBASE_PROJECT_ID) return process.env.FRANKI_FIREBASE_PROJECT_ID;
  const file = join(REPO_ROOT, "apps", "web", ".env.development.local");
  return existsSync(file) ? dotenvValue(readFileSync(file, "utf8"), "FRANKI_FIREBASE_PROJECT_ID") : null;
}

/** The live seam: `get()` on a collection, nothing else. */
async function liveList(project) {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps()[0] ?? initializeApp({ projectId: project });
  const db = getFirestore(app);
  return async (path) => {
    const snap = await db.collection(path).get();
    return snap.docs.map((d) => ({ id: d.id, data: plain(d.data()), createTime: d.createTime ? d.createTime.toMillis() : null, updateTime: d.updateTime ? d.updateTime.toMillis() : null }));
  };
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { uid: { type: "string" } } });
  } catch (error) {
    fail(`bad arguments: ${error instanceof Error ? error.message : String(error)}`);
  }
  const dir = parsed.positionals[0];
  if (!dir) fail("usage: node scripts/live-test/export.mjs <run folder> [--uid <uid>]");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a folder: ${dir}`);
  const problem = repoFolderProblem(dir);
  if (problem) fail(problem);
  let run;
  try {
    run = loadRun(dir);
  } catch (error) {
    fail(error instanceof InputError ? error.message : `cannot read the run: ${String(error)}`);
  }
  let uid = parsed.values.uid;
  if (uid !== undefined && !isUid(uid)) fail("--uid is not a user ID");
  if (uid === undefined) {
    const seen = userIds(run.events);
    if (seen.length === 0) fail("no signed-in user in events.ndjson; pass --uid <uid>");
    if (seen.length > 1) fail(`${seen.length} users signed in during the run (${seen.join(", ")}); pass --uid <uid>`);
    uid = seen[0];
  }
  const project = projectId();
  if (!project) fail("no project ID: set FRANKI_FIREBASE_PROJECT_ID or run scripts/sync-local-env.mjs");
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;

  const list = await liveList(project);
  const result = await collect({ list, uid, since: metaStart(run.meta) });
  writeFiles(dir, uid, result, new Date().toISOString());
  const c = result.counts;
  const parts = Object.entries(c).filter(([k]) => k !== "evidenceOlder").map(([k, v]) => `${k} ${v}`);
  process.stdout.write(`exported to firestore/: ${parts.join(", ")} (evidence older than the window, not written: ${c.evidenceOlder})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => fail(`export failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
}
