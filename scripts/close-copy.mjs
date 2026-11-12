// Close-copy check (voice-control R10.3, R16.2; design "The close-copy test"). A judge instruction or a regex
// table may name general cue words, but no probe sentence from scripts/judge-spike/lines.json, nor a close copy of
// one, may appear in it: the probes measure the judge, and a probe copied into its instructions measures nothing.
//
// Both sides are rendered the same way: lower case, every run of non-letters becomes one space. A copy is any
// 4-word window of a probe line, or a whole probe line under 4 words, found in the rendered text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./clock-check.mjs";

export const WINDOW_WORDS = 4;

/** Lower case, and every run of characters that are not letters becomes one space. */
export function render(text) {
  return ` ${text.toLowerCase().replace(/[^\p{L}]+/gu, " ").trim()} `;
}

/** Every 4-word window of a line, or the whole line when it has fewer words. */
export function windows(line, n = WINDOW_WORDS) {
  const words = render(line).trim().split(" ").filter((w) => w !== "");
  if (words.length <= n) return words.length === 0 ? [] : [words.join(" ")];
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

/** The probe lines' texts, from scripts/judge-spike/lines.json. */
export function probeTexts(root = REPO_ROOT) {
  const parsed = JSON.parse(readFileSync(join(root, "scripts", "judge-spike", "lines.json"), "utf8"));
  return parsed.lines.map((l) => l.text);
}

/** The windows of `lines` that appear, as whole words, in `text`. Empty means no close copy. */
export function closeCopies(text, lines) {
  const hay = render(text);
  const found = [];
  for (const line of lines) for (const w of windows(line)) if (hay.includes(` ${w} `)) found.push({ line, window: w });
  return found;
}
