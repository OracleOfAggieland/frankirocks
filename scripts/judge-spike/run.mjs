#!/usr/bin/env node
// Judge spike runner (brief 006). Bundles cli.ts with esbuild into scripts/judge-spike/dist/ (gitignored),
// then runs it in this process, so `node --env-file=...` flags reach it. Nothing goes to the network
// unless the command is given --live.
//
//   node --env-file=apps/web/.env.development.local --env-file=apps/web/.env.local scripts/judge-spike/run.mjs synth
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const spikeDir = fileURLToPath(new URL("./", import.meta.url));
const outfile = fileURLToPath(new URL("./dist/cli.mjs", import.meta.url));

await build({
  entryPoints: [fileURLToPath(new URL("./cli.ts", import.meta.url))],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "warning",
});

const { main } = await import(pathToFileURL(outfile).href);
const code = await main(process.argv.slice(2), { spikeDir, env: process.env, log: (line) => console.log(line) });
process.exitCode = code;
