#!/usr/bin/env node
// Extraction check runner (brief 012 task A10b). Bundles check.ts with esbuild into scripts/extract-check/dist/
// (gitignored), then runs it in this process, so `node --env-file=...` flags reach it. Nothing goes to the network
// unless the command is given --live.
//
//   node scripts/extract-check/run.mjs
//   node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/extract-check/run.mjs --live
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = fileURLToPath(new URL("./", import.meta.url));
const outfile = fileURLToPath(new URL("./dist/check.mjs", import.meta.url));

await build({
  entryPoints: [fileURLToPath(new URL("./check.ts", import.meta.url))],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
});

const { main } = await import(pathToFileURL(outfile).href);
const code = await main(process.argv.slice(2), { dir, env: process.env, log: (line) => console.log(line) });
process.exitCode = code;
