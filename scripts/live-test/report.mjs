#!/usr/bin/env node
// Brief 050 part C: turns a live-test run folder into report.md and summary.json.
//
//   node scripts/live-test/report.mjs <run folder>
//
// Works with or without firestore/ (the export) and with or without script.json. Words go to report.md only.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyze } from "./lib/analyze.mjs";
import { fail } from "./lib/cli.mjs";
import { InputError, loadRun } from "./lib/run.mjs";
import { renderReport } from "./lib/render.mjs";

export function writeReport(dir) {
  const run = loadRun(dir);
  const result = analyze(run);
  writeFileSync(join(dir, "report.md"), renderReport(result));
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(result.summary, null, 2)}\n`);
  return result.summary;
}

function main(argv) {
  const dir = argv[0];
  if (!dir || dir.startsWith("--")) fail("usage: node scripts/live-test/report.mjs <run folder>");
  try {
    const s = writeReport(dir);
    process.stdout.write(
      `report.md and summary.json written: ${s.steps.total} steps (${s.steps.pass} pass, ${s.steps.fail} fail, ${s.steps.skip} skip), ${s.turns.total} turns, ${s.errors.total} errors\n`,
    );
  } catch (error) {
    if (error instanceof InputError) fail(error.message);
    fail(`report failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
